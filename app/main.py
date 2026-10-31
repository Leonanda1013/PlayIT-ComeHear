"""SIM ComeHear: FastAPI monolit (UI server-side + API + worker kirim SATUSEHAT)."""
import hashlib
import hmac
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import Base, SessionLocal, engine, get_db
from app.fhir.codes import DRUGS, VITALS
from app.models import (AuditLog, ClinicalNote, Consent, Location, Patient, Practitioner, ReviewEdit,
                        ScribeSession, Submission, User, Visit, as_utc, utcnow)
from app.satusehat.client import get_client
from app.scribe import pipeline
from app.scribe.icd import icd_table
from app.scribe.schemas import SUBJECTIVE_FIELDS
from app.security import verify_password
from app.seed import seed
from app.services.notes import ApprovalError, approve_and_queue, requeue
from app.sync.worker import OutboxWorker

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
settings = get_settings()
APP_DIR = Path(__file__).parent
WIB = timezone(timedelta(hours=7))
CONSENT_VERSION = "v1-2026-10"
worker: OutboxWorker | None = None


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global worker
    Base.metadata.create_all(engine)
    settings.audio_dir.mkdir(parents=True, exist_ok=True)
    with SessionLocal() as db:
        seed(db, settings.demo_password)
    worker = OutboxWorker(SessionLocal, get_client(settings), settings)
    worker.start()
    pipeline.warm_up(settings)
    yield
    worker.stop()


app = FastAPI(title="ComeHear SIM", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=APP_DIR / "static"), name="static")
templates = Jinja2Templates(directory=APP_DIR / "templates")


def wib(dt) -> str:
    return as_utc(dt).astimezone(WIB).strftime("%d %b %Y %H:%M") if dt else "-"


templates.env.filters["wib"] = wib


# ---------------- autentikasi sederhana (cookie bertanda tangan HMAC) ----------------
def _sign(uid: int) -> str:
    sig = hmac.new(settings.secret_key.encode(), str(uid).encode(), hashlib.sha256).hexdigest()
    return f"{uid}.{sig}"


def current_user(request: Request, db: Session = Depends(get_db)) -> User:
    raw = request.cookies.get("session", "")
    uid, _, sig = raw.partition(".")
    if uid.isdigit() and hmac.compare_digest(_sign(int(uid)), raw):
        user = db.get(User, int(uid))
        if user:
            return user
    raise HTTPException(status_code=303, headers={"Location": "/login"})


def require(*roles: str):
    def dep(user: User = Depends(current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(403, "Peran Anda tidak diizinkan untuk tindakan ini.")
        return user
    return dep


def render(request: Request, name: str, user: User | None = None, **ctx):
    return templates.TemplateResponse(request, name, {"user": user, **ctx})


def audit(db: Session, user: User | None, action: str, obj: str, summary: str = ""):
    db.add(AuditLog(user_id=user.id if user else None, action=action, obj=obj, summary=summary))


@app.get("/login", response_class=HTMLResponse)
def login_page(request: Request):
    return render(request, "login.html")


@app.post("/login")
def login(request: Request, username: str = Form(...), password: str = Form(...), db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.username == username))
    if not user or not verify_password(password, user.password_hash):
        return render(request, "login.html", error="Nama pengguna atau kata sandi salah.")
    audit(db, user, "login", f"user:{user.id}")
    db.commit()
    resp = RedirectResponse("/", status_code=303)
    resp.set_cookie("session", _sign(user.id), httponly=True, samesite="lax")
    return resp


@app.get("/logout")
def logout():
    resp = RedirectResponse("/login", status_code=303)
    resp.delete_cookie("session")
    return resp


# ---------------- kunjungan ----------------
@app.get("/", response_class=HTMLResponse)
def visits_page(request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    visits = db.scalars(select(Visit).order_by(Visit.id.desc()).limit(50)).all()
    return render(request, "visits.html", user, visits=visits,
                  patients=db.scalars(select(Patient).order_by(Patient.name)).all(),
                  practitioners=db.scalars(select(Practitioner)).all(),
                  locations=db.scalars(select(Location)).all())


@app.post("/visits")
def create_visit(patient_id: int = Form(...), practitioner_id: int = Form(...), location_id: int = Form(...),
                 user: User = Depends(require("perawat", "admin", "dokter")), db: Session = Depends(get_db)):
    today = datetime.now(WIB).strftime("%Y%m%d")
    n = db.scalar(select(func.count(Visit.id)).where(Visit.code.like(f"ANAK-{today}-%"))) + 1
    v = Visit(code=f"ANAK-{today}-{n:03d}", patient_id=patient_id, practitioner_id=practitioner_id,
              location_id=location_id)
    db.add(v)
    db.flush()
    audit(db, user, "create_visit", f"visit:{v.id}", v.code)
    db.commit()
    return RedirectResponse(f"/visits/{v.id}", status_code=303)


def get_visit(db: Session, visit_id: int) -> Visit:
    v = db.get(Visit, visit_id)
    if not v:
        raise HTTPException(404, "Kunjungan tidak ditemukan")
    return v


@app.get("/visits/{visit_id}", response_class=HTMLResponse)
def visit_page(visit_id: int, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    v = get_visit(db, visit_id)
    audit(db, user, "view", f"visit:{v.id}")
    db.commit()
    return render(request, "visit.html", user, v=v, consent_version=CONSENT_VERSION)


@app.post("/visits/{visit_id}/consent")
def give_consent(visit_id: int, given_by_name: str = Form(...), relation: str = Form(...),
                 agree: str = Form(None), user: User = Depends(current_user), db: Session = Depends(get_db)):
    v = get_visit(db, visit_id)
    if agree != "ya":
        raise HTTPException(400, "Persetujuan harus dicentang secara eksplisit.")
    if v.consent is None:
        db.add(Consent(visit_id=v.id, given_by_name=given_by_name.strip(), relation=relation,
                       text_version=CONSENT_VERSION, recorded_by=user.id))
        v.status = "consented"
        audit(db, user, "consent", f"visit:{v.id}", f"{relation}: {given_by_name}")
        db.commit()
    return RedirectResponse(f"/visits/{v.id}", status_code=303)


def _start_session(db: Session, v: Visit, user: User, audio_path: str | None) -> ScribeSession:
    if v.consent is None:
        raise HTTPException(403, "Belum ada persetujuan pasien/wali: perekaman tidak diizinkan.")
    if v.note and v.note.approved_snapshot:
        raise HTTPException(409, "Catatan sudah disetujui.")
    now = utcnow()
    v.started_at = v.started_at or now
    v.ended_at = now
    v.status = "processing"
    ss = ScribeSession(visit_id=v.id, audio_path=audio_path, status="queued")
    db.add(ss)
    audit(db, user, "scribe_start", f"visit:{v.id}", "audio" if audio_path else "teks")
    db.commit()
    return ss


@app.post("/visits/{visit_id}/audio")
async def upload_audio(visit_id: int, audio: UploadFile = File(...), started_at: str = Form(None),
                       user: User = Depends(current_user), db: Session = Depends(get_db)):
    v = get_visit(db, visit_id)
    if v.consent is None:
        raise HTTPException(403, "Belum ada persetujuan pasien/wali.")
    suffix = Path(audio.filename or "rekaman.webm").suffix or ".webm"
    path = settings.audio_dir / f"{v.code}-{int(utcnow().timestamp())}{suffix}"
    path.write_bytes(await audio.read())
    if started_at:
        try:
            v.started_at = v.started_at or datetime.fromisoformat(started_at.replace("Z", "+00:00"))
        except ValueError:
            pass
    ss = _start_session(db, v, user, str(path))
    pipeline.submit(SessionLocal, ss.id, settings)
    return JSONResponse({"session_id": ss.id})


_chunk_seq: dict[int, int] = {}


@app.post("/visits/{visit_id}/audio-chunk")
async def audio_chunk(visit_id: int, seq: int = Form(...), chunk: UploadFile = File(...),
                      session_id: int | None = Form(None), user: User = Depends(current_user),
                      db: Session = Depends(get_db)):
    """Potongan rekaman selama konsultasi berlangsung; ASR berjalan bertahap di latar belakang.
    Potongan MediaRecorder (timeslice) hanya punya header di potongan pertama, jadi semuanya
    disambung ke satu berkas webm yang tetap bisa didekode dari awal."""
    v = get_visit(db, visit_id)
    if seq == 0:
        if v.consent is None:
            raise HTTPException(403, "Belum ada persetujuan pasien/wali: perekaman tidak diizinkan.")
        if v.note and v.note.approved_snapshot:
            raise HTTPException(409, "Catatan sudah disetujui.")
        path = settings.audio_dir / f"{v.code}-{int(utcnow().timestamp())}.webm"
        path.write_bytes(b"")
        v.started_at = v.started_at or utcnow()
        v.status = "processing"
        ss = ScribeSession(visit_id=v.id, audio_path=str(path), status="recording",
                           model_info={"live": {"offset": 0.0, "asr_s": 0.0}})
        db.add(ss)
        audit(db, user, "scribe_start", f"visit:{v.id}", "rekam langsung")
        db.commit()
    else:
        ss = db.get(ScribeSession, session_id) if session_id else None
        if ss is None or ss.visit_id != v.id or ss.status != "recording":
            raise HTTPException(409, "Sesi rekaman tidak aktif.")
    # Urutan dicatat di memori (bukan di model_info) karena worker ASR juga menulis model_info.
    expected = _chunk_seq.get(ss.id, 0)
    if seq == expected - 1:  # kiriman ulang potongan yang sudah diterima (respons sebelumnya hilang)
        return {"session_id": ss.id}
    if seq != expected:  # urutan wajib benar agar berkas webm tidak rusak
        raise HTTPException(409, f"Potongan {seq} tidak berurutan (diharapkan {expected}).")
    with open(ss.audio_path, "ab") as f:
        f.write(await chunk.read())
    _chunk_seq[ss.id] = seq + 1
    pipeline.submit_live(SessionLocal, ss.id, settings)
    return {"session_id": ss.id}


@app.post("/visits/{visit_id}/audio-finish")
def audio_finish(visit_id: int, session_id: int = Form(...), user: User = Depends(current_user),
                 db: Session = Depends(get_db)):
    v = get_visit(db, visit_id)
    ss = db.get(ScribeSession, session_id)
    if ss is None or ss.visit_id != v.id or ss.status != "recording":
        raise HTTPException(409, "Sesi rekaman tidak aktif.")
    ss.status = "queued"
    v.ended_at = utcnow()
    db.commit()
    pipeline.submit(SessionLocal, ss.id, settings)
    return {"session_id": ss.id, "review_url": f"/visits/{v.id}/review"}


@app.post("/visits/{visit_id}/transcript-text")
def upload_text(visit_id: int, transcript: str = Form(...), user: User = Depends(current_user),
                db: Session = Depends(get_db)):
    v = get_visit(db, visit_id)
    ss = _start_session(db, v, user, None)
    pipeline.submit(SessionLocal, ss.id, settings, text_transcript=transcript)
    return RedirectResponse(f"/visits/{v.id}/review", status_code=303)


@app.get("/api/sessions/{session_id}")
def session_status(session_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    ss = db.get(ScribeSession, session_id)
    if not ss:
        raise HTTPException(404)
    return {"status": ss.status, "error": ss.error, "timings": ss.timings, "visit_id": ss.visit_id}


# ---------------- review dokter ----------------
def _ensure_note(db: Session, v: Visit) -> ClinicalNote:
    if v.note is None:
        db.add(ClinicalNote(visit_id=v.id))
        db.commit()
        db.refresh(v)
    return v.note


@app.get("/visits/{visit_id}/review", response_class=HTMLResponse)
def review_page(visit_id: int, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db),
                errors: str | None = None):
    v = get_visit(db, visit_id)
    note = _ensure_note(db, v)
    ss = _review_session(v)
    audit(db, user, "view_review", f"visit:{v.id}")
    db.commit()
    return render(request, "review.html", user, v=v, note=note, ss=ss, fields=SUBJECTIVE_FIELDS,
                  vitals=VITALS, drugs=DRUGS, errors=errors.split("||") if errors else [],
                  locked=bool(note.approved_snapshot), s_ready=bool(ss and ss.extraction))


def _review_session(v: Visit) -> ScribeSession | None:
    """Sesi terbaru yang belum gagal; bila semuanya gagal, sesi terbaru (agar pesan galat tampil)."""
    return next((s for s in reversed(v.scribe_sessions) if s.status != "failed"), v.latest_session)


@app.get("/visits/{visit_id}/review/panels")
def review_panels(visit_id: int, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Potongan HTML yang disisipkan ke layar review selama draf AI disusun."""
    v = get_visit(db, visit_id)
    db.expire_all()
    v = get_visit(db, visit_id)
    ss, note = _review_session(v), _ensure_note(db, v)
    ctx = {"request": request, "v": v, "ss": ss, "note": note, "fields": SUBJECTIVE_FIELDS}
    part = lambda name: templates.get_template(name).render(ctx)  # noqa: E731
    return {"status": ss.status if ss else None, "error": ss.error if ss else None,
            "n_segments": len(ss.transcript or []) if ss else 0,
            "transcript_html": part("_transcript.html"),
            "s_html": part("_s_panel.html") if ss and ss.extraction else None,
            "icd_html": part("_icd_panel.html") if ss and ss.status == "done" else None}


@app.post("/visits/{visit_id}/review")
async def save_review(visit_id: int, request: Request, user: User = Depends(current_user),
                      db: Session = Depends(get_db)):
    v = get_visit(db, visit_id)
    note = _ensure_note(db, v)
    if note.approved_snapshot:
        raise HTTPException(409, "Catatan sudah disetujui dan dibekukan.")
    form = await request.form()
    if form.get("action") == "approve" and user.role != "dokter":
        raise HTTPException(403, "Hanya dokter yang dapat menyetujui catatan klinis.")
    rows = {r.code: r for r in icd_table(settings)}

    if form.get("s_loaded"):  # bagian S belum tampil: jangan timpa draf AI yang sedang disusun
        note.subjective = {k: (form.get(f"s_{k}") or "").strip() for k in SUBJECTIVE_FIELDS}
        note.subjective_summary = (form.get("summary") or "").strip()
    vitals = {}
    for key in VITALS:
        raw = (form.get(f"vital_{key}") or "").replace(",", ".").strip()
        if raw:
            try:
                vitals[key] = float(raw)
            except ValueError:
                pass
    note.vitals = vitals
    note.exam_text = (form.get("exam_text") or "").strip()

    codes = [c.strip().upper() for c in form.getlist("dx_code") if c.strip()]
    manual = (form.get("dx_manual") or "").strip().upper()
    if manual:
        codes.append(manual)
    primary = (form.get("dx_primary") or (codes[0] if codes else "")).strip().upper()
    ai_codes = {s["code"] for s in (v.latest_session.icd_suggestions or [])} if v.latest_session else set()
    seen, diagnoses, bad = set(), [], []
    for c in [primary] + codes:
        if not c or c in seen:
            continue
        seen.add(c)
        if c not in rows:
            bad.append(f"Kode ICD-10 {c} tidak ada di tabel ICD SATUSEHAT.")
            continue
        diagnoses.append({"code": c, "display": rows[c].display, "rank": len(diagnoses) + 1,
                          "source": "ai" if c in ai_codes else "dokter"})
    note.diagnoses = diagnoses
    note.assessment = (form.get("assessment") or "").strip()
    note.plan_text = (form.get("plan_text") or "").strip()

    prescriptions = []
    if form.get("rx_enabled") == "ya":
        try:
            prescriptions.append({
                "kfa_code": form.get("rx_kfa"), "dose_value": float(str(form.get("rx_dose")).replace(",", ".")),
                "frequency": 1, "period": float(form.get("rx_period")),
                "period_max": float(form.get("rx_period_max")) if form.get("rx_period_max") else None,
                "period_unit": "h", "as_needed_text": (form.get("rx_prn") or "").strip() or None,
                "as_needed_fever": "demam" in (form.get("rx_prn") or "").lower(),
                "duration_days": int(form.get("rx_duration") or 1), "quantity": int(form.get("rx_qty") or 1),
                "route": "oral", "patient_instruction": (form.get("rx_instruction") or "").strip()})
        except (TypeError, ValueError):
            bad.append("Isian resep belum lengkap atau bukan angka.")
    note.prescriptions = prescriptions
    v.status = "draft" if v.status in ("processing", "consented", "registered") else v.status
    audit(db, user, "edit_note", f"visit:{v.id}")
    db.commit()

    if bad:
        return RedirectResponse(f"/visits/{v.id}/review?errors={'||'.join(bad)}", status_code=303)
    if form.get("action") != "approve":
        return RedirectResponse(f"/visits/{v.id}/review", status_code=303)

    try:
        sub = approve_and_queue(db, v, user, settings)
    except ApprovalError as e:
        return RedirectResponse(f"/visits/{v.id}/review?errors={'||'.join(e.errors)}", status_code=303)
    _record_edits(db, v, user)
    _delete_audio(db, v)
    if worker:
        worker.nudge()
    return RedirectResponse(f"/visits/{v.id}/status?sub={sub.id}", status_code=303)


def _record_edits(db: Session, v: Visit, user: User):
    """Bandingkan isian AI dengan isian final dokter: bahan rasio koreksi dan F1."""
    ss = next((s for s in reversed(v.scribe_sessions) if s.status == "done"), None)
    if not ss or not ss.extraction:
        return
    final = v.note.approved_snapshot
    pairs = [(k, ss.extraction[k]["nilai"], final["subjective"].get(k)) for k in SUBJECTIVE_FIELDS]
    pairs.append(("rangkuman_s", ss.extraction.get("rangkuman_s"), final["subjective_summary"]))
    ai_codes = [c["code"] for c in ss.icd_suggestions or []]
    pairs.append(("icd_primer", ai_codes[0] if ai_codes else None,
                  final["diagnoses"][0]["code"] if final["diagnoses"] else None))
    for key, ai, fin in pairs:
        ai, fin = (ai or "").strip(), (fin or "").strip()
        if ai or fin:
            db.add(ReviewEdit(visit_id=v.id, field_key=key, ai_value=ai, final_value=fin,
                              changed=ai != fin, edited_by=user.id))
    db.commit()


def _delete_audio(db: Session, v: Visit):
    """Retensi: audio dihapus setelah dokter menyetujui catatan (kebijakan 2A-7)."""
    for ss in v.scribe_sessions:
        if ss.audio_path and not ss.audio_deleted_at:
            Path(ss.audio_path).unlink(missing_ok=True)
            ss.audio_deleted_at = utcnow()
    db.commit()


# ---------------- status kirim SATUSEHAT ----------------
@app.get("/visits/{visit_id}/status", response_class=HTMLResponse)
def status_page(visit_id: int, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    v = get_visit(db, visit_id)
    db.expire_all()
    return render(request, "status.html", user, v=get_visit(db, visit_id))


@app.post("/submissions/{sub_id}/requeue")
def requeue_submission(sub_id: int, user: User = Depends(require("admin", "dokter")), db: Session = Depends(get_db)):
    sub = db.get(Submission, sub_id)
    if not sub or sub.status not in ("NEEDS_ATTENTION", "RETRY_WAIT"):
        raise HTTPException(409, "Pengiriman ini tidak bisa diulang.")
    requeue(db, sub, user)
    if worker:
        worker.nudge()
    return RedirectResponse(f"/visits/{sub.visit_id}/status", status_code=303)


@app.get("/dashboard", response_class=HTMLResponse)
def dashboard(request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    by_status = dict(db.execute(select(Submission.status, func.count()).group_by(Submission.status)).all())
    total_edits = db.scalar(select(func.count(ReviewEdit.id))) or 0
    changed = db.scalar(select(func.count(ReviewEdit.id)).where(ReviewEdit.changed)) or 0
    per_field = db.execute(select(ReviewEdit.field_key, func.count(), func.sum(ReviewEdit.changed))
                           .group_by(ReviewEdit.field_key)).all()
    sessions = db.scalars(select(ScribeSession).where(ScribeSession.status == "done")
                          .order_by(ScribeSession.id.desc()).limit(20)).all()
    return render(request, "dashboard.html", user, by_status=by_status, total_edits=total_edits,
                  changed=changed, per_field=per_field, sessions=sessions,
                  attention=db.scalars(select(Submission).where(Submission.status == "NEEDS_ATTENTION")).all())


# ---------------- pasien ----------------
@app.get("/patients", response_class=HTMLResponse)
def patients_page(request: Request, user: User = Depends(current_user), db: Session = Depends(get_db),
                  msg: str | None = None):
    return render(request, "patients.html", user, patients=db.scalars(select(Patient).order_by(Patient.name)).all(),
                  msg=msg, mode=settings.satusehat_mode)


@app.post("/patients")
def add_patient(name: str = Form(...), nik: str = Form(""), birth_date: str = Form(...), gender: str = Form(...),
                ihs_number: str = Form(""), user: User = Depends(require("admin", "perawat")),
                db: Session = Depends(get_db)):
    p = Patient(name=name.strip(), nik=nik.strip() or None, gender=gender,
                birth_date=datetime.strptime(birth_date, "%Y-%m-%d").date(), ihs_number=ihs_number.strip() or None)
    db.add(p)
    db.flush()
    msg = "Pasien ditambahkan."
    if p.nik and not p.ihs_number and settings.satusehat_mode != "mock":
        try:
            p.ihs_number = get_client(settings).find_patient_by_nik(p.nik)
            p.ihs_checked_at = utcnow()
            msg = f"Nomor IHS ditemukan: {p.ihs_number}" if p.ihs_number else "NIK tidak ditemukan di SATUSEHAT."
        except Exception as e:
            msg = f"Pencarian IHS gagal: {e}"
    audit(db, user, "create_patient", f"patient:{p.id}")
    db.commit()
    return RedirectResponse(f"/patients?msg={msg}", status_code=303)


@app.exception_handler(HTTPException)
async def http_error(request: Request, exc: HTTPException):
    if exc.status_code == 303:
        return RedirectResponse(exc.headers["Location"], status_code=303)
    if request.url.path.startswith("/api/") or request.headers.get("accept", "").startswith("application/json"):
        return JSONResponse({"detail": exc.detail}, status_code=exc.status_code)
    return templates.TemplateResponse(request, "error.html", {"user": None, "code": exc.status_code,
                                                              "detail": exc.detail}, status_code=exc.status_code)
