"""SIM ComeHear: FastAPI monolit (UI server-side + API + worker kirim SATUSEHAT)."""
import hashlib
import hmac
import logging
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import quote

from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import Base, SessionLocal, engine, get_db
from app.fhir.codes import DRUGS
from app.icons import icon
from app.migrate import add_missing_columns
from app.models import (AuditLog, ClinicalNote, Consent, Location, Patient, Practitioner, ReviewEdit,
                        ScribeSession, Submission, User, Visit, as_utc, utcnow)
from app.satusehat.client import get_client
from app.scribe import pipeline
from app.scribe.icd import icd_table
from app.scribe.schemas import SUBJECTIVE_FIELDS
from app.security import verify_password
from app.seed import next_queue_no, next_rm_number, next_visit_code, seed, seed_today_queue
from app.services.notes import ApprovalError, approve_and_queue, requeue
from app.services.soap_form import KESADARAN, apply_form
from app.sync.worker import OutboxWorker

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
log = logging.getLogger("comehear.web")
settings = get_settings()
APP_DIR = Path(__file__).parent
WIB = timezone(timedelta(hours=7))
CONSENT_VERSION = "v1-2026-10"
HARI = ["Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu"]
BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"]
worker: OutboxWorker | None = None


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global worker
    Base.metadata.create_all(engine)
    added = add_missing_columns(engine)
    if added:
        log.info("kolom baru ditambahkan: %s", ", ".join(added))
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


# ---------------- filter & helper tampilan ----------------
def wib(dt) -> str:
    return as_utc(dt).astimezone(WIB).strftime("%d %b %Y %H:%M") if dt else "-"


def tanggal(dt: datetime | date) -> str:
    return f"{HARI[dt.weekday()]}, {dt.day} {BULAN[dt.month - 1]} {dt.year}"


def usia(born: date | None) -> str:
    if not born:
        return "-"
    today = datetime.now(WIB).date()
    months = (today.year - born.year) * 12 + today.month - born.month - (today.day < born.day)
    return f"{months} bulan" if months < 24 else f"{months // 12} tahun"


def kelamin(g: str | None) -> str:
    return {"male": "Laki - Laki", "female": "Perempuan"}.get(g or "", "-")


def loc_label(loc: Location) -> str:
    poli = (loc.poli or "").removeprefix("Poli ").strip()
    return f"{poli} {loc.name.split()[-1]}".strip() if poli else loc.name


templates.env.filters.update(wib=wib, usia=usia, kelamin=kelamin)
templates.env.globals.update(icon=icon)


# ---------------- autentikasi (cookie bertanda tangan HMAC) ----------------
def _sign(uid: int) -> str:
    sig = hmac.new(settings.secret_key.encode(), str(uid).encode(), hashlib.sha256).hexdigest()
    return f"{uid}.{sig}"


def current_user(request: Request, db: Session = Depends(get_db)) -> User:
    raw = request.cookies.get("session", "")
    uid = raw.partition(".")[0]
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


def audit(db: Session, user: User | None, action: str, obj: str, summary: str = ""):
    db.add(AuditLog(user_id=user.id if user else None, action=action, obj=obj, summary=summary))


def current_location(request: Request, db: Session) -> Location:
    loc_id = request.cookies.get("loc", "")
    loc = db.get(Location, int(loc_id)) if loc_id.isdigit() else None
    return loc or db.scalar(select(Location).order_by(Location.id.desc()))


def page(request: Request, db: Session, user: User, name: str, nav: str = "", **ctx):
    """Render halaman dengan kerangka aplikasi (sidebar, header ruang, tanggal, notifikasi)."""
    locations = db.scalars(select(Location).order_by(Location.id)).all()
    for loc in locations:
        loc.label = loc_label(loc)
    flashes = []
    if request.query_params.get("msg"):
        flashes.append({"text": request.query_params["msg"], "kind": request.query_params.get("kind", "info")})
    return templates.TemplateResponse(request, name, {
        "user": user, "nav": nav, "locations": locations, "loc": current_location(request, db),
        "facility": "RSUD Mitra", "today_label": tanggal(datetime.now(WIB)), "flashes": flashes,
        "attention_count": db.scalar(select(func.count(Submission.id))
                                     .where(Submission.status == "NEEDS_ATTENTION")) or 0,
        **ctx})


def redirect(url: str, msg: str | None = None, kind: str = "info") -> RedirectResponse:
    if msg:
        url += ("&" if "?" in url else "?") + f"msg={quote(msg)}&kind={kind}"
    return RedirectResponse(url, status_code=303)


@app.get("/login", response_class=HTMLResponse)
def login_page(request: Request):
    return templates.TemplateResponse(request, "login.html", {})


@app.post("/login")
def login(request: Request, email: str = Form(...), password: str = Form(...), db: Session = Depends(get_db)):
    ident = email.strip().lower()
    user = db.scalar(select(User).where(or_(func.lower(User.email) == ident, User.username == ident)))
    if not user or not verify_password(password, user.password_hash):
        return templates.TemplateResponse(request, "login.html",
                                          {"error": "Email atau kata sandi salah.", "email": email})
    audit(db, user, "login", f"user:{user.id}")
    db.commit()
    resp = RedirectResponse("/antrean", status_code=303)
    resp.set_cookie("session", _sign(user.id), httponly=True, samesite="lax")
    return resp


@app.get("/logout")
def logout():
    resp = RedirectResponse("/login", status_code=303)
    resp.delete_cookie("session")
    return resp


@app.post("/lokasi")
def set_location(location_id: int = Form(...), next: str = Form("/antrean"), user: User = Depends(current_user)):
    resp = RedirectResponse(next if next.startswith("/") else "/antrean", status_code=303)
    resp.set_cookie("loc", str(location_id), samesite="lax")
    return resp


# ---------------- antrean ----------------
def today_start_utc() -> datetime:
    return datetime.now(WIB).replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc)


def visit_state(v: Visit) -> str:
    if v.note and v.note.approved_snapshot:
        return "selesai"
    if v.called_at:
        return "saat_ini"
    return "menunggu"


def draft_label(v: Visit, state: str) -> tuple[str, str]:
    if state == "selesai":
        return "Tersimpan", "ok"
    ss = _review_session(v)
    if ss and ss.status in ("recording", "queued", "transcribing", "extracting"):
        return "Menyusun draf", "primary"
    if (ss and ss.extraction) or (v.note and (v.note.subjective_summary or v.note.vitals)):
        return "Draf tersimpan", "primary"
    return ("Belum Ada Draft SOAP", "") if state == "saat_ini" else ("-", "")


@app.get("/")
def home():
    return RedirectResponse("/antrean", status_code=303)


@app.get("/antrean", response_class=HTMLResponse)
def queue_page(request: Request, tab: str = "semua", q: str = "", user: User = Depends(current_user),
               db: Session = Depends(get_db)):
    loc = current_location(request, db)
    visits = db.scalars(select(Visit).where(Visit.location_id == loc.id, Visit.arrived_at >= today_start_utc())
                        .order_by(Visit.queue_no, Visit.id)).all()
    rows = [{"v": v, "state": visit_state(v)} for v in visits]
    nxt = next((r for r in rows if r["state"] == "menunggu"), None)
    if nxt:
        nxt["state"] = "selanjutnya"
    order = {"saat_ini": 0, "selanjutnya": 1, "menunggu": 2, "selesai": 3}
    rows.sort(key=lambda r: (order[r["state"]], r["v"].queue_no or 0))
    for r in rows:
        r["draft"] = draft_label(r["v"], r["state"])
    counts = {k: sum(r["state"] == k for r in rows) for k in order}
    counts["semua"] = len(rows)
    if tab != "semua":
        rows = [r for r in rows if r["state"] == tab]
    if q.strip():
        ql = q.strip().lower()
        rows = [r for r in rows if ql in r["v"].patient.name.lower() or ql in (r["v"].patient.rm_number or "").lower()
                or ql in r["v"].code.lower()]
    return page(request, db, user, "queue.html", "antrean", rows=rows, counts=counts, tab=tab, q=q,
                doctor=db.get(Practitioner, user.practitioner_id) if user.practitioner_id else None)


@app.post("/visits/{visit_id}/panggil")
def call_patient(visit_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    v = get_visit(db, visit_id)
    v.called_at = utcnow()
    audit(db, user, "panggil", f"visit:{v.id}")
    db.commit()
    return redirect("/antrean", f"{v.patient.name} dipanggil ke {v.location.name}.")


# ---------------- konsultasi: S -> O-A-P -> Verifikasi ----------------
def get_visit(db: Session, visit_id: int) -> Visit:
    v = db.get(Visit, visit_id)
    if not v:
        raise HTTPException(404, "Kunjungan tidak ditemukan")
    return v


def _ensure_note(db: Session, v: Visit) -> ClinicalNote:
    if v.note is None:
        db.add(ClinicalNote(visit_id=v.id))
        db.commit()
        db.refresh(v)
    return v.note


def _review_session(v: Visit) -> ScribeSession | None:
    """Sesi terbaru yang dipakai: abaikan yang gagal atau diganti rekaman ulang."""
    return next((s for s in reversed(v.scribe_sessions) if s.status not in ("failed", "replaced")), None)


def _failed_session(v: Visit) -> ScribeSession | None:
    last = v.latest_session
    return last if last and last.status == "failed" else None


def _consult(request: Request, db: Session, user: User, v: Visit, step: str, errors: list[str] | None = None):
    note = _ensure_note(db, v)
    if not v.called_at:
        v.called_at = utcnow()
    audit(db, user, f"view_{step}", f"visit:{v.id}")
    db.commit()
    rows = icd_table(settings)
    return page(request, db, user, "consult.html", "antrean", v=v, note=note, step=step, ss=_review_session(v),
                failed=_failed_session(v), fields=SUBJECTIVE_FIELDS, drugs=DRUGS, kesadaran=KESADARAN,
                errors=errors or [], locked=bool(note.approved_snapshot), consent_version=CONSENT_VERSION,
                icd_rows={r.code: r.display for r in rows if any(r.code == d["code"] for d in note.diagnoses)})


@app.get("/visits/{visit_id}", response_class=HTMLResponse)
@app.get("/visits/{visit_id}/s", response_class=HTMLResponse)
def step_s(visit_id: int, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return _consult(request, db, user, get_visit(db, visit_id), "s")


@app.get("/visits/{visit_id}/oap", response_class=HTMLResponse)
def step_oap(visit_id: int, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return _consult(request, db, user, get_visit(db, visit_id), "oap")


@app.get("/visits/{visit_id}/verifikasi", response_class=HTMLResponse)
def step_verify(visit_id: int, request: Request, errors: str | None = None, user: User = Depends(current_user),
                db: Session = Depends(get_db)):
    return _consult(request, db, user, get_visit(db, visit_id), "verifikasi",
                    errors.split("||") if errors else None)


@app.post("/visits/{visit_id}/soap")
async def save_soap(visit_id: int, request: Request, user: User = Depends(current_user),
                    db: Session = Depends(get_db)):
    v = get_visit(db, visit_id)
    note = _ensure_note(db, v)
    if note.approved_snapshot:
        raise HTTPException(409, "Catatan sudah divalidasi dan dibekukan.")
    form = await request.form()
    action = form.get("action", "save")
    if action == "approve" and user.role != "dokter":
        raise HTTPException(403, "Hanya dokter yang dapat memvalidasi catatan klinis.")
    errors = apply_form(note, v, form, {r.code: r for r in icd_table(settings)})
    if v.status in ("registered", "consented", "manual", "processing"):
        v.status = "draft"
    audit(db, user, "edit_note", f"visit:{v.id}", action)
    db.commit()

    targets = {"to_s": "s", "to_oap": "oap", "to_verify": "verifikasi", "save": form.get("step", "s")}
    if errors:
        return redirect(f"/visits/{v.id}/{form.get('step', 'oap')}", " ".join(errors), "bad")
    if action != "approve":
        return redirect(f"/visits/{v.id}/{targets.get(action, 's')}")
    if form.get("confirm") != "ya":
        return redirect(f"/visits/{v.id}/verifikasi", "Centang konfirmasi pemeriksaan sebelum validasi.", "bad")
    try:
        sub = approve_and_queue(db, v, user, settings)
    except ApprovalError as e:
        return redirect(f"/visits/{v.id}/verifikasi?errors={quote('||'.join(e.errors))}")
    _record_edits(db, v, user)
    _delete_audio(db, v)
    if worker:
        worker.nudge()
    return redirect(f"/visits/{v.id}/resume", "SOAP tervalidasi dan diantrekan ke SATUSEHAT.", "ok")


@app.post("/visits/{visit_id}/consent")
def set_consent(visit_id: int, decision: str = Form(...), user: User = Depends(current_user),
                db: Session = Depends(get_db)):
    v = get_visit(db, visit_id)
    if decision == "setuju":
        if v.consent is None:
            db.add(Consent(visit_id=v.id, given_by_name=v.patient.name, relation="pasien",
                           text_version=CONSENT_VERSION, recorded_by=user.id))
        if v.status in ("registered", "manual"):
            v.status = "consented"
        audit(db, user, "consent", f"visit:{v.id}", "setuju direkam")
    else:
        if any(s.status == "recording" for s in v.scribe_sessions):
            raise HTTPException(409, "Hentikan rekaman lebih dulu.")
        if v.consent is not None:  # penarikan persetujuan: hentikan pemrosesan (UU PDP Pasal 40)
            db.delete(v.consent)
        if v.status in ("registered", "consented"):
            v.status = "manual"
        audit(db, user, "consent", f"visit:{v.id}", "menolak direkam (manual)")
    db.commit()
    return {"decision": decision}


def _start_session(db: Session, v: Visit, user: User, audio_path: str | None, status: str = "queued") -> ScribeSession:
    if v.consent is None:
        raise HTTPException(403, "Belum ada persetujuan pasien: perekaman tidak diizinkan.")
    if v.note and v.note.approved_snapshot:
        raise HTTPException(409, "Catatan sudah divalidasi.")
    for old in v.scribe_sessions:  # rekam ulang: sesi lama tidak dipakai lagi
        if old.status not in ("failed", "replaced"):
            old.status = "replaced"
    now = utcnow()
    v.started_at = v.started_at or now
    if status != "recording":
        v.ended_at = now
    v.status = "processing"
    ss = ScribeSession(visit_id=v.id, audio_path=audio_path, status=status,
                       model_info={"live": {"offset": 0.0, "asr_s": 0.0}} if status == "recording" else None)
    db.add(ss)
    audit(db, user, "scribe_start", f"visit:{v.id}", "rekam langsung" if status == "recording" else
          ("audio" if audio_path else "teks"))
    db.commit()
    return ss


@app.post("/visits/{visit_id}/audio")
async def upload_audio(visit_id: int, audio: UploadFile = File(...), user: User = Depends(current_user),
                       db: Session = Depends(get_db)):
    v = get_visit(db, visit_id)
    if v.consent is None:
        raise HTTPException(403, "Belum ada persetujuan pasien.")
    suffix = Path(audio.filename or "rekaman.webm").suffix or ".webm"
    path = settings.audio_dir / f"visit{v.id}-{int(utcnow().timestamp())}{suffix}"
    path.write_bytes(await audio.read())
    ss = _start_session(db, v, user, str(path))
    pipeline.submit(SessionLocal, ss.id, settings)
    return {"session_id": ss.id}


_chunk_seq: dict[int, int] = {}


@app.post("/visits/{visit_id}/audio-chunk")
async def audio_chunk(visit_id: int, seq: int = Form(...), chunk: UploadFile = File(...),
                      session_id: int | None = Form(None), user: User = Depends(current_user),
                      db: Session = Depends(get_db)):
    """Potongan rekaman selama konsultasi; ASR berjalan bertahap di latar belakang. Potongan
    MediaRecorder hanya punya header di potongan pertama, jadi semua disambung ke satu berkas webm."""
    v = get_visit(db, visit_id)
    if seq == 0:
        path = settings.audio_dir / f"visit{v.id}-{int(utcnow().timestamp())}.webm"
        ss = _start_session(db, v, user, str(path), status="recording")
        path.write_bytes(b"")
    else:
        ss = db.get(ScribeSession, session_id) if session_id else None
        if ss is None or ss.visit_id != v.id or ss.status != "recording":
            raise HTTPException(409, "Sesi rekaman tidak aktif.")
    # Urutan dicatat di memori (bukan di model_info) karena worker ASR juga menulis model_info.
    expected = _chunk_seq.get(ss.id, 0)
    if seq == expected - 1:  # kiriman ulang potongan yang sudah diterima (respons sebelumnya hilang)
        return {"session_id": ss.id}
    if seq != expected:
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
    return {"session_id": ss.id}


@app.post("/visits/{visit_id}/transcript-text")
def upload_text(visit_id: int, transcript: str = Form(...), user: User = Depends(current_user),
                db: Session = Depends(get_db)):
    v = get_visit(db, visit_id)
    ss = _start_session(db, v, user, None)
    pipeline.submit(SessionLocal, ss.id, settings, text_transcript=transcript)
    return redirect(f"/visits/{v.id}/s")


@app.get("/visits/{visit_id}/audio/{session_id}")
def play_audio(visit_id: int, session_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    ss = db.get(ScribeSession, session_id)
    if not ss or ss.visit_id != visit_id or not ss.audio_path or ss.audio_deleted_at or not Path(ss.audio_path).exists():
        raise HTTPException(404, "Rekaman tidak tersedia (sudah dihapus setelah validasi).")
    audit(db, user, "play_audio", f"visit:{visit_id}")
    db.commit()
    return FileResponse(ss.audio_path, media_type="audio/webm")


@app.get("/api/sessions/{session_id}")
def session_status(session_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    ss = db.get(ScribeSession, session_id)
    if not ss:
        raise HTTPException(404)
    return {"status": ss.status, "error": ss.error, "timings": ss.timings, "visit_id": ss.visit_id}


@app.get("/visits/{visit_id}/scribe")
def scribe_state(visit_id: int, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Keadaan draf AI untuk layar konsultasi (dipanggil berkala selama rekaman/penyusunan)."""
    db.expire_all()
    v = get_visit(db, visit_id)
    ss, failed = _review_session(v), _failed_session(v)
    ctx = {"request": request, "v": v, "ss": ss, "icon": icon}
    return {
        "status": ss.status if ss else ("failed" if failed else None),
        "error": failed.error if failed and not ss else None,
        "n_segments": len(ss.transcript or []) if ss else 0,
        "chat_html": templates.get_template("_chat.html").render(ctx),
        "summary": v.note.subjective_summary if v.note and ss and ss.extraction else None,
        "fields": dict(v.note.subjective or {}) if v.note and ss and ss.extraction else None,
        "duration_s": (ss.model_info or {}).get("duration_s") if ss else None,
        "icd": ss.icd_suggestions if ss and ss.status == "done" else None,
    }


@app.get("/api/icd")
def icd_search(q: str = "", user: User = Depends(current_user)):
    ql = q.strip().lower()
    if len(ql) < 2:
        return []
    rows = icd_table(settings)
    hits = [r for r in rows if r.code.lower().startswith(ql)] + \
           [r for r in rows if ql in r.display.lower() and not r.code.lower().startswith(ql)]
    return [{"code": r.code, "display": r.display} for r in hits[:15]]


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
    """Retensi: audio dihapus setelah dokter memvalidasi catatan (kebijakan 2A-7)."""
    for ss in v.scribe_sessions:
        if ss.audio_path and not ss.audio_deleted_at:
            Path(ss.audio_path).unlink(missing_ok=True)
            ss.audio_deleted_at = utcnow()
    db.commit()


# ---------------- resume & riwayat ----------------
@app.get("/visits/{visit_id}/resume", response_class=HTMLResponse)
@app.get("/visits/{visit_id}/status", response_class=HTMLResponse)
def resume_page(visit_id: int, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    db.expire_all()
    v = get_visit(db, visit_id)
    return page(request, db, user, "resume.html", "riwayat", v=v, note=v.note, fields=SUBJECTIVE_FIELDS)


@app.post("/submissions/{sub_id}/requeue")
def requeue_submission(sub_id: int, user: User = Depends(require("admin", "dokter")), db: Session = Depends(get_db)):
    sub = db.get(Submission, sub_id)
    if not sub or sub.status not in ("NEEDS_ATTENTION", "RETRY_WAIT"):
        raise HTTPException(409, "Pengiriman ini tidak bisa diulang.")
    requeue(db, sub, user)
    if worker:
        worker.nudge()
    return redirect(f"/visits/{sub.visit_id}/resume", "Dikirim ulang.")


@app.get("/riwayat", response_class=HTMLResponse)
def history_page(request: Request, q: str = "", user: User = Depends(current_user), db: Session = Depends(get_db)):
    stmt = select(Visit).join(Patient).order_by(Visit.arrived_at.desc()).limit(200)
    if q.strip():
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(Patient.name.ilike(like), Patient.rm_number.ilike(like), Visit.code.ilike(like)))
    return page(request, db, user, "history.html", "riwayat", visits=db.scalars(stmt).all(), q=q)


# ---------------- administrasi ----------------
@app.get("/pendaftaran", response_class=HTMLResponse)
def registration_page(request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    queued = set(db.scalars(select(Visit.patient_id).where(Visit.arrived_at >= today_start_utc())))
    return page(request, db, user, "registration.html", "pendaftaran",
                patients=db.scalars(select(Patient).order_by(Patient.name)).all(), queued=queued,
                mode=settings.satusehat_mode)


@app.post("/pendaftaran/pasien")
def add_patient(name: str = Form(...), nik: str = Form(""), birth_date: str = Form(...), gender: str = Form(...),
                ihs_number: str = Form(""), user: User = Depends(require("admin", "perawat", "dokter")),
                db: Session = Depends(get_db)):
    p = Patient(name=name.strip(), rm_number=next_rm_number(db), nik=nik.strip() or None, gender=gender,
                birth_date=datetime.strptime(birth_date, "%Y-%m-%d").date(), ihs_number=ihs_number.strip() or None)
    db.add(p)
    db.flush()
    msg = f"Pasien {p.name} ditambahkan (RM {p.rm_number})."
    if p.nik and not p.ihs_number and settings.satusehat_mode != "mock":
        try:
            p.ihs_number = get_client(settings).find_patient_by_nik(p.nik)
            p.ihs_checked_at = utcnow()
            msg += f" Nomor IHS: {p.ihs_number}." if p.ihs_number else " NIK tidak ditemukan di SATUSEHAT."
        except Exception as e:
            msg += f" Pencarian IHS gagal: {e}"
    audit(db, user, "create_patient", f"patient:{p.id}")
    db.commit()
    return redirect("/pendaftaran", msg, "ok")


@app.post("/pendaftaran/kunjungan")
def register_visit(request: Request, patient_id: int = Form(...), user: User = Depends(current_user),
                   db: Session = Depends(get_db)):
    loc = current_location(request, db)
    dr = db.get(Practitioner, user.practitioner_id) if user.practitioner_id else \
        db.scalar(select(Practitioner).order_by(Practitioner.id.desc()))
    v = Visit(code=next_visit_code(db), patient_id=patient_id, practitioner_id=dr.id, location_id=loc.id,
              queue_no=next_queue_no(db, loc.id))
    db.add(v)
    db.flush()
    audit(db, user, "create_visit", f"visit:{v.id}", v.code)
    db.commit()
    return redirect("/pendaftaran", f"{v.patient.name} masuk antrean nomor {v.queue_no} ({loc.name}).", "ok")


@app.post("/pendaftaran/demo")
def fill_demo_queue(user: User = Depends(current_user), db: Session = Depends(get_db)):
    n = seed_today_queue(db)
    return redirect("/antrean", f"{n} pasien demo ditambahkan ke antrean hari ini.", "ok")


@app.get("/dasbor", response_class=HTMLResponse)
def dashboard(request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    by_status = dict(db.execute(select(Submission.status, func.count()).group_by(Submission.status)).all())
    total_edits = db.scalar(select(func.count(ReviewEdit.id))) or 0
    changed = db.scalar(select(func.count(ReviewEdit.id)).where(ReviewEdit.changed)) or 0
    per_field = db.execute(select(ReviewEdit.field_key, func.count(), func.sum(ReviewEdit.changed))
                           .group_by(ReviewEdit.field_key)).all()
    sessions = db.scalars(select(ScribeSession).where(ScribeSession.status == "done")
                          .order_by(ScribeSession.id.desc()).limit(20)).all()
    return page(request, db, user, "dashboard.html", "dasbor", by_status=by_status, total_edits=total_edits,
                changed=changed, per_field=per_field, sessions=sessions, mode=settings.satusehat_mode,
                llm=settings.llm_providers,
                attention=db.scalars(select(Submission).where(Submission.status == "NEEDS_ATTENTION")).all())


@app.exception_handler(HTTPException)
async def http_error(request: Request, exc: HTTPException):
    if exc.status_code == 303:
        return RedirectResponse(exc.headers["Location"], status_code=303)
    if request.url.path.startswith("/api/") or "application/json" in request.headers.get("accept", "") \
            or request.method == "POST" and "/audio" in request.url.path:
        return JSONResponse({"detail": exc.detail}, status_code=exc.status_code)
    return templates.TemplateResponse(request, "error.html", {"code": exc.status_code, "detail": exc.detail},
                                      status_code=exc.status_code)
