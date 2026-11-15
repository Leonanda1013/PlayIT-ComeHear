"""SIM ComeHear: FastAPI Headless REST API (Backend murni + worker kirim SATUSEHAT)."""
import hashlib
import hmac
import logging
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from sqlalchemy import Integer, func, or_, select
from sqlalchemy.orm import Session, joinedload, selectinload

from app.config import get_settings
from app.db import Base, SessionLocal, engine, get_db
from app.fhir.codes import DRUGS
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
log = logging.getLogger("comehear.api")
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


app = FastAPI(
    title="ComeHear SIM API",
    description="Headless REST API untuk SIM Rawat Jalan & Asisten Scribe Klinis AI terintegrasi SATUSEHAT",
    version="2.0.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^https?://.*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------- Serialisasi & Filter Helper ----------------
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


def serialize_patient(p: Patient | None) -> dict | None:
    if not p:
        return None
    return {
        "id": p.id,
        "name": p.name,
        "rm_number": p.rm_number,
        "nik": p.nik,
        "ihs_number": p.ihs_number,
        "gender": p.gender,
        "gender_label": kelamin(p.gender),
        "birth_date": p.birth_date.isoformat() if p.birth_date else None,
        "usia": usia(p.birth_date),
        "phone": p.phone,
        "address": p.address
    }


def serialize_visit_brief(v: Visit, state: str, draft: tuple[str, str]) -> dict:
    return {
        "id": v.id,
        "code": v.code,
        "queue_no": v.queue_no,
        "status": v.status,
        "state": state,
        "draft_status": draft[0],
        "draft_kind": draft[1],
        "arrived_at": v.arrived_at.isoformat() if v.arrived_at else None,
        "called_at": v.called_at.isoformat() if v.called_at else None,
        "started_at": v.started_at.isoformat() if v.started_at else None,
        "ended_at": v.ended_at.isoformat() if v.ended_at else None,
        "patient": serialize_patient(v.patient),
        "location": {"id": v.location.id, "name": v.location.name, "label": loc_label(v.location)},
        "has_note": bool(v.note),
        "is_approved": bool(v.note and v.note.approved_snapshot)
    }


# ---------------- Autentikasi (Cookie + Bearer Token HMAC) ----------------
def _sign(uid: int) -> str:
    sig = hmac.new(settings.secret_key.encode(), str(uid).encode(), hashlib.sha256).hexdigest()
    return f"{uid}.{sig}"


def current_user(request: Request, db: Session = Depends(get_db)) -> User:
    token = ""
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        token = auth[7:].strip()
    if not token:
        token = request.headers.get("x-session-token", "")
    if not token:
        token = request.cookies.get("session", "")

    uid = token.partition(".")[0]
    if uid.isdigit() and hmac.compare_digest(_sign(int(uid)), token):
        user = db.get(User, int(uid))
        if user:
            return user
    raise HTTPException(status_code=401, detail="Sesi tidak valid atau belum login.")


def require(*roles: str):
    def dep(user: User = Depends(current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(403, "Peran Anda tidak diizinkan untuk tindakan ini.")
        return user
    return dep


def audit(db: Session, user: User | None, action: str, obj: str, summary: str = ""):
    db.add(AuditLog(user_id=user.id if user else None, action=action, obj=obj, summary=summary))


def current_location(request: Request, db: Session) -> Location:
    loc_id = request.headers.get("x-location-id") or request.cookies.get("loc", "")
    loc = db.get(Location, int(loc_id)) if str(loc_id).isdigit() else None
    return loc or db.scalar(select(Location).order_by(Location.id.desc()))


# ---------------- Root & Auth Routes ----------------
@app.get("/")
def root():
    return {
        "service": "ComeHear SIM API",
        "version": "2.0.0",
        "status": "ready",
        "endpoints": {
            "auth": ["/login", "/logout", "/api/me"],
            "queue": ["/antrean", "/visits/{id}/panggil"],
            "consultation": ["/visits/{id}", "/visits/{id}/soap", "/visits/{id}/consent", "/visits/{id}/scribe"],
            "registration": ["/pendaftaran", "/pendaftaran/pasien", "/pendaftaran/kunjungan", "/pendaftaran/demo"],
            "history": ["/riwayat"],
            "dashboard": ["/dasbor"]
        }
    }


@app.get("/login")
def login_info():
    return {"status": "ok", "message": "Gunakan POST /login dengan email dan password."}


@app.post("/login")
async def login(request: Request, db: Session = Depends(get_db)):
    ct = request.headers.get("content-type", "")
    if "application/json" in ct:
        data = await request.json()
        email = data.get("email", "")
        password = data.get("password", "")
    else:
        form = await request.form()
        email = form.get("email", "")
        password = form.get("password", "")

    ident = (email or "").strip().lower()
    user = db.scalar(select(User).where(or_(func.lower(User.email) == ident, User.username == ident)))
    if not user or not verify_password(password or "", user.password_hash):
        raise HTTPException(status_code=401, detail="Email atau kata sandi salah.")

    audit(db, user, "login", f"user:{user.id}")
    db.commit()

    token = _sign(user.id)
    resp = JSONResponse({
        "status": "ok",
        "token": token,
        "user": {
            "id": user.id,
            "username": user.username,
            "email": user.email,
            "name": user.name,
            "role": user.role,
            "practitioner_id": user.practitioner_id
        }
    })
    resp.set_cookie("session", token, httponly=True, samesite="lax")
    return resp


@app.get("/logout")
@app.post("/logout")
def logout():
    resp = JSONResponse({"status": "ok", "message": "Berhasil logout."})
    resp.delete_cookie("session")
    return resp


@app.get("/api/me")
def get_me(user: User = Depends(current_user)):
    return {
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "name": user.name,
        "role": user.role,
        "practitioner_id": user.practitioner_id
    }


# ---------------- Lokasi ----------------
@app.get("/lokasi")
@app.get("/api/lokasi")
def list_locations(db: Session = Depends(get_db)):
    locations = db.scalars(select(Location).order_by(Location.id)).all()
    return [
        {
            "id": loc.id,
            "name": loc.name,
            "poli": loc.poli,
            "label": loc_label(loc),
            "satusehat_id": loc.satusehat_location_id
        }
        for loc in locations
    ]


@app.post("/lokasi")
async def set_location(request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    ct = request.headers.get("content-type", "")
    if "application/json" in ct:
        data = await request.json()
        location_id = data.get("location_id")
    else:
        form = await request.form()
        location_id = form.get("location_id")

    loc = db.get(Location, int(location_id)) if location_id else None
    if not loc:
        raise HTTPException(status_code=404, detail="Lokasi tidak ditemukan.")

    resp = JSONResponse({
        "status": "ok",
        "location": {"id": loc.id, "name": loc.name, "label": loc_label(loc)}
    })
    resp.set_cookie("loc", str(loc.id), samesite="lax")
    return resp


# ---------------- Antrean ----------------
def today_start_utc() -> datetime:
    return datetime.now(WIB).replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc)


def visit_state(v: Visit, active_id: int | None = None) -> str:
    if v.note and v.note.approved_snapshot:
        return "selesai"
    if active_id is not None:
        if v.id == active_id:
            return "saat_ini"
    elif v.called_at:
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


@app.get("/antrean")
def queue_api(request: Request, tab: str = "semua", q: str = "", user: User = Depends(current_user),
              db: Session = Depends(get_db)):
    loc = current_location(request, db)
    # Pasien, lokasi, catatan, dan sesi scribe diambil sekaligus (bukan 1 query per baris):
    # ke Supabase tiap query ±50 ms, jadi N+1 membuat antrean terasa lambat.
    visits = db.scalars(select(Visit).where(Visit.location_id == loc.id, Visit.arrived_at >= today_start_utc())
                        .options(joinedload(Visit.patient), joinedload(Visit.location), joinedload(Visit.note),
                                 selectinload(Visit.scribe_sessions))
                        .order_by(Visit.queue_no, Visit.id)).unique().all()
    # Pastikan hanya ada tepat 1 pasien aktif ("saat_ini"): pasien belum selesai dengan called_at paling baru
    active_candidates = [
        v for v in visits if v.called_at and not (v.note and v.note.approved_snapshot)
    ]
    active_id = max(active_candidates, key=lambda v: v.called_at).id if active_candidates else None

    rows = [{"v": v, "state": visit_state(v, active_id)} for v in visits]
    active_idx = next((i for i, r in enumerate(rows) if r["state"] == "saat_ini"), -1)
    nxt = None
    if active_idx != -1:
        nxt = next((r for r in rows[active_idx + 1:] if r["state"] == "menunggu"), None)
    if not nxt:
        nxt = next((r for r in rows if r["state"] == "menunggu"), None)
    if nxt:
        nxt["state"] = "selanjutnya"

    for r in rows:
        r["draft"] = draft_label(r["v"], r["state"])
    order = {"saat_ini": 0, "selanjutnya": 1, "menunggu": 2, "selesai": 3}
    counts = {k: sum(r["state"] == k for r in rows) for k in order}
    counts["semua"] = len(rows)
    if tab != "semua":
        rows = [r for r in rows if r["state"] == tab]
    if q.strip():
        ql = q.strip().lower()
        rows = [r for r in rows if ql in r["v"].patient.name.lower() or ql in (r["v"].patient.rm_number or "").lower()
                or ql in r["v"].code.lower()]
    
    doctor = db.get(Practitioner, user.practitioner_id) if user.practitioner_id else None

    return {
        "status": "ok",
        "tab": tab,
        "counts": counts,
        "location": {"id": loc.id, "name": loc.name, "label": loc_label(loc)},
        "doctor": {"id": doctor.id, "name": doctor.name, "satusehat_id": doctor.satusehat_id} if doctor else None,
        "rows": [serialize_visit_brief(r["v"], r["state"], r["draft"]) for r in rows]
    }


@app.post("/visits/{visit_id}/panggil")
def call_patient(visit_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    v = get_visit(db, visit_id)
    # Kembalikan pasien lain di bilik/lokasi yang belum selesai diperiksa ke status "menunggu"
    other_active = db.scalars(
        select(Visit).where(
            Visit.location_id == v.location_id,
            Visit.id != v.id,
            Visit.called_at.is_not(None)
        )
    ).all()
    for other in other_active:
        if not (other.note and other.note.approved_snapshot):
            other.called_at = None
    v.called_at = utcnow()
    audit(db, user, "panggil", f"visit:{v.id}")
    db.commit()
    return {
        "status": "ok",
        "message": f"{v.patient.name} dipanggil ke {v.location.name}.",
        "visit_id": v.id,
        "called_at": v.called_at.isoformat()
    }


# ---------------- Konsultasi Klinis (SOAP + Scribe) ----------------
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
    return next((s for s in reversed(v.scribe_sessions) if s.status not in ("failed", "replaced")), None)


def _failed_session(v: Visit) -> ScribeSession | None:
    last = v.latest_session
    return last if last and last.status == "failed" else None


def serialize_consultation(v: Visit, note: ClinicalNote, step: str, db: Session, user: User) -> dict:
    ss = _review_session(v)
    failed = _failed_session(v)
    rows = icd_table(settings)
    diagnoses_map = {r.code: r.display for r in rows if any(r.code == d.get("code") for d in (note.diagnoses or []))}

    return {
        "status": "ok",
        "step": step,
        "locked": bool(note.approved_snapshot),
        "consent_version": CONSENT_VERSION,
        "visit": {
            "id": v.id,
            "code": v.code,
            "queue_no": v.queue_no,
            "status": v.status,
            "started_at": v.started_at.isoformat() if v.started_at else None,
            "ended_at": v.ended_at.isoformat() if v.ended_at else None,
            "called_at": v.called_at.isoformat() if v.called_at else None,
            "arrived_at": v.arrived_at.isoformat() if v.arrived_at else None,
            "doctor": v.practitioner.name if v.practitioner else None,
            "patient": serialize_patient(v.patient),
            "location": {"id": v.location.id, "name": v.location.name, "label": loc_label(v.location)},
            "consent": {
                "given_by_name": v.consent.given_by_name,
                "relation": v.consent.relation,
                "version": v.consent.text_version,
                "given_at": v.consent.given_at.isoformat() if v.consent.given_at else None
            } if v.consent else None
        },
        "note": {
            "id": note.id,
            "subjective": note.subjective or {},
            "subjective_summary": note.subjective_summary or "",
            "vitals": note.vitals or {},
            "exam_text": note.exam_text or "",
            "diagnoses": note.diagnoses or [],
            "plan_text": note.plan_text or "",
            "prescriptions": note.prescriptions or [],
            "assessment": note.assessment or "",
            "extra": note.extra or {},
            "updated_at": note.updated_at.isoformat() if note.updated_at else None,
            "approved": bool(note.approved_snapshot),
            "approved_snapshot": note.approved_snapshot
        },
        "session": {
            "id": ss.id,
            "status": ss.status,
            "transcript": ss.transcript or [],
            "extraction": ss.extraction,
            "icd_suggestions": ss.icd_suggestions,
            "timings": ss.timings,
            "error": ss.error,
            "has_audio": bool(ss.audio_path and not ss.audio_deleted_at and Path(ss.audio_path).exists())
        } if ss else None,
        "failed_session": {
            "id": failed.id,
            "error": failed.error
        } if failed else None,
        "options": {
            "fields": SUBJECTIVE_FIELDS,
            "drugs": DRUGS,
            "kesadaran": KESADARAN,
            "icd_map": diagnoses_map
        }
    }


@app.get("/visits/{visit_id}")
@app.get("/visits/{visit_id}/s")
@app.get("/visits/{visit_id}/oap")
@app.get("/visits/{visit_id}/verifikasi")
def get_consultation(visit_id: int, request: Request, user: User = Depends(current_user),
                     db: Session = Depends(get_db)):
    v = get_visit(db, visit_id)
    note = _ensure_note(db, v)
    if not v.called_at:
        v.called_at = utcnow()
    step = "s"
    if request.url.path.endswith("/oap"):
        step = "oap"
    elif request.url.path.endswith("/verifikasi"):
        step = "verifikasi"
    audit(db, user, f"view_{step}", f"visit:{v.id}")
    db.commit()
    return serialize_consultation(v, note, step, db, user)


@app.post("/visits/{visit_id}/soap")
async def save_soap(visit_id: int, request: Request, user: User = Depends(current_user),
                    db: Session = Depends(get_db)):
    v = get_visit(db, visit_id)
    note = _ensure_note(db, v)
    if note.approved_snapshot:
        raise HTTPException(409, "Catatan sudah divalidasi dan dibekukan.")
    
    ct = request.headers.get("content-type", "")
    if "application/json" in ct:
        form = await request.json()
    else:
        form = dict(await request.form())
    
    action = form.get("action", "save")
    if action == "approve" and user.role != "dokter":
        raise HTTPException(403, "Hanya dokter yang dapat memvalidasi catatan klinis.")
    
    errors = apply_form(note, v, form, {r.code: r for r in icd_table(settings)})
    if v.status in ("registered", "consented", "manual", "processing"):
        v.status = "draft"
    audit(db, user, "edit_note", f"visit:{v.id}", action)
    db.commit()

    if errors:
        return JSONResponse({"status": "error", "errors": errors, "detail": " ".join(errors)}, status_code=400)
    
    if action != "approve":
        return {
            "status": "ok",
            "action": action,
            "visit_id": v.id,
            "step": form.get("step", "s")
        }
    
    if form.get("confirm") != "ya":
        return JSONResponse({
            "status": "error",
            "detail": "Centang konfirmasi pemeriksaan sebelum validasi."
        }, status_code=400)
    
    try:
        sub = approve_and_queue(db, v, user, settings)
    except ApprovalError as e:
        return JSONResponse({
            "status": "error",
            "errors": e.errors,
            "detail": " || ".join(e.errors)
        }, status_code=400)
    
    _record_edits(db, v, user)
    _delete_audio(db, v)
    if worker:
        worker.nudge()
    return {
        "status": "ok",
        "action": "approved",
        "visit_id": v.id,
        "submission_id": sub.id,
        "message": "SOAP tervalidasi dan diantrekan ke SATUSEHAT."
    }


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
        if v.consent is not None:
            db.delete(v.consent)
        if v.status in ("registered", "consented"):
            v.status = "manual"
        audit(db, user, "consent", f"visit:{v.id}", "menolak direkam (manual)")
    db.commit()
    return {"decision": decision, "status": "ok"}


def _start_session(db: Session, v: Visit, user: User, audio_path: str | None, status: str = "queued") -> ScribeSession:
    if v.consent is None:
        raise HTTPException(403, "Belum ada persetujuan pasien: perekaman tidak diizinkan.")
    if v.note and v.note.approved_snapshot:
        raise HTTPException(409, "Catatan sudah divalidasi.")
    for old in v.scribe_sessions:
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
    return {"session_id": ss.id, "status": "ok"}


_chunk_seq: dict[int, int] = {}


@app.post("/visits/{visit_id}/audio-chunk")
async def audio_chunk(visit_id: int, seq: int = Form(...), chunk: UploadFile = File(...),
                      session_id: int | None = Form(None), user: User = Depends(current_user),
                      db: Session = Depends(get_db)):
    v = get_visit(db, visit_id)
    if seq == 0:
        path = settings.audio_dir / f"visit{v.id}-{int(utcnow().timestamp())}.webm"
        ss = _start_session(db, v, user, str(path), status="recording")
        path.write_bytes(b"")
    else:
        ss = db.get(ScribeSession, session_id) if session_id else None
        if ss is None or ss.visit_id != v.id or ss.status != "recording":
            raise HTTPException(409, "Sesi rekaman tidak aktif.")
    expected = _chunk_seq.get(ss.id, 0)
    if seq == expected - 1:
        return {"session_id": ss.id, "status": "ok"}
    if seq != expected:
        raise HTTPException(409, f"Potongan {seq} tidak berurutan (diharapkan {expected}).")
    with open(ss.audio_path, "ab") as f:
        f.write(await chunk.read())
    _chunk_seq[ss.id] = seq + 1
    pipeline.submit_live(SessionLocal, ss.id, settings)
    return {"session_id": ss.id, "status": "ok"}


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
    return {"session_id": ss.id, "status": "ok"}


@app.post("/visits/{visit_id}/transcript-text")
async def upload_text(visit_id: int, request: Request, transcript: str = Form(None),
                      user: User = Depends(current_user), db: Session = Depends(get_db)):
    v = get_visit(db, visit_id)
    text = transcript
    if not text:
        ct = request.headers.get("content-type", "")
        if "application/json" in ct:
            body = await request.json()
            text = body.get("transcript", "")
    if not text:
        raise HTTPException(400, "Transkrip tidak boleh kosong.")
    ss = _start_session(db, v, user, None)
    pipeline.submit(SessionLocal, ss.id, settings, text_transcript=text)
    return {
        "status": "ok",
        "session_id": ss.id,
        "visit_id": v.id
    }


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
def scribe_state(visit_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Keadaan draf AI untuk asisten klinis (dipanggil berkala selama rekaman/penyusunan)."""
    db.expire_all()
    v = get_visit(db, visit_id)
    ss, failed = _review_session(v), _failed_session(v)
    return {
        "status": ss.status if ss else ("failed" if failed else None),
        "error": failed.error if failed and not ss else None,
        "n_segments": len(ss.transcript or []) if ss else 0,
        "transcript": ss.transcript or [] if ss else [],
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
    for ss in v.scribe_sessions:
        if ss.audio_path and not ss.audio_deleted_at:
            Path(ss.audio_path).unlink(missing_ok=True)
            ss.audio_deleted_at = utcnow()
    db.commit()


# ---------------- Resume & Riwayat ----------------
@app.get("/visits/{visit_id}/resume")
@app.get("/visits/{visit_id}/status")
def resume_page(visit_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    db.expire_all()
    v = get_visit(db, visit_id)
    sub = v.latest_submission
    return {
        "status": "ok",
        "mode": settings.satusehat_mode,
        "visit": {
            "id": v.id,
            "code": v.code,
            "status": v.status,
            "patient": serialize_patient(v.patient),
            "location": {"id": v.location.id, "name": v.location.name, "label": loc_label(v.location)},
            "satusehat_encounter_id": v.satusehat_encounter_id
        },
        "note": {
            "id": v.note.id if v.note else None,
            "subjective_summary": v.note.subjective_summary if v.note else "",
            "subjective": v.note.subjective if v.note else {},
            "vitals": v.note.vitals if v.note else {},
            "exam_text": v.note.exam_text if v.note else "",
            "diagnoses": v.note.diagnoses if v.note else [],
            "plan_text": v.note.plan_text if v.note else "",
            "prescriptions": v.note.prescriptions if v.note else [],
            "assessment": v.note.assessment if v.note else "",
            "extra": v.note.extra if v.note else {},
            "approved": bool(v.note and v.note.approved_snapshot),
            "approved_snapshot": v.note.approved_snapshot if v.note else None
        },
        "submission": {
            "id": sub.id,
            "status": sub.status,
            "attempts": sub.attempts,
            "last_error_text": sub.last_error_text,
            "last_error_code": sub.last_error_code,
            "bundle": sub.bundle,
            "resources": [{"resource_type": r.resource_type, "resource_id": r.resource_id} for r in sub.resources]
        } if sub else None
    }


@app.post("/submissions/{sub_id}/requeue")
def requeue_submission(sub_id: int, user: User = Depends(require("admin", "dokter")), db: Session = Depends(get_db)):
    sub = db.get(Submission, sub_id)
    if not sub or sub.status not in ("NEEDS_ATTENTION", "RETRY_WAIT"):
        raise HTTPException(409, "Pengiriman ini tidak bisa diulang.")
    requeue(db, sub, user)
    if worker:
        worker.nudge()
    return {
        "status": "ok",
        "message": "Submission berhasil dimasukkan kembali ke antrean kirim.",
        "submission_id": sub.id
    }


@app.get("/riwayat")
def history_page(q: str = "", user: User = Depends(current_user), db: Session = Depends(get_db)):
    stmt = select(Visit).join(Patient).order_by(Visit.arrived_at.desc()).limit(200)
    if q.strip():
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(Patient.name.ilike(like), Patient.rm_number.ilike(like), Visit.code.ilike(like)))
    visits = db.scalars(stmt).all()
    return {
        "status": "ok",
        "q": q,
        "count": len(visits),
        "visits": [
            {
                "id": v.id,
                "code": v.code,
                "status": v.status,
                "arrived_at": v.arrived_at.isoformat() if v.arrived_at else None,
                "patient": serialize_patient(v.patient),
                "location": {"id": v.location.id, "name": v.location.name, "label": loc_label(v.location),
                             "poli": v.location.poli},
                "doctor": v.practitioner.name if v.practitioner else None,
                "diagnosis": (v.note.diagnoses[0]["display"] if v.note and v.note.diagnoses else None),
                "diagnosis_code": (v.note.diagnoses[0]["code"] if v.note and v.note.diagnoses else None),
                "is_approved": bool(v.note and v.note.approved_snapshot),
                "submission_status": v.latest_submission.status if v.latest_submission else None,
                "satusehat_encounter_id": v.satusehat_encounter_id
            }
            for v in visits
        ]
    }


# ---------------- Petugas Rekam Medis ----------------
def rm_status(v: Visit) -> str:
    if v.note and v.note.approved_snapshot:
        return "selesai"
    if v.called_at or v.status in ("consented", "manual", "processing", "draft"):
        return "dalam_pemeriksaan"
    if v.confirmed_at:
        return "menunggu_pemeriksaan"
    return "terjadwal"


def serialize_rm_visit(v: Visit) -> dict:
    return {
        "id": v.id,
        "code": v.code,
        "queue_no": v.queue_no,
        "visit_date": v.arrived_at.astimezone(WIB).date().isoformat() if v.arrived_at else None,
        "arrived_at": v.arrived_at.isoformat() if v.arrived_at else None,
        "confirmed_at": v.confirmed_at.isoformat() if v.confirmed_at else None,
        "visit_type": v.visit_type or "Kontrol",
        "admin_note": v.admin_note,
        "rm_status": rm_status(v),
        "patient": serialize_patient(v.patient),
        "location": {"id": v.location.id, "name": v.location.name, "label": loc_label(v.location),
                     "poli": v.location.poli},
        "doctor": v.practitioner.name if v.practitioner else None,
        "submission_status": v.latest_submission.status if v.latest_submission else None,
    }


@app.get("/api/practitioners")
def list_practitioners(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return [{"id": p.id, "name": p.name} for p in db.scalars(select(Practitioner).order_by(Practitioner.name))]


@app.get("/api/rm/kunjungan")
def rm_visits(scope: str = "hari_ini", q: str = "", status: str = "", tanggal: str = "",
              user: User = Depends(current_user), db: Session = Depends(get_db)):
    start = today_start_utc()
    if tanggal:
        try:
            day = datetime.strptime(tanggal, "%Y-%m-%d").date()
            start = datetime(day.year, day.month, day.day, tzinfo=WIB).astimezone(timezone.utc)
        except ValueError:
            raise HTTPException(400, "Tanggal tidak valid.")
    end = start + timedelta(days=1)
    stmt = select(Visit).join(Patient)
    if scope == "mendatang":
        stmt = stmt.where(Visit.arrived_at >= end).order_by(Visit.arrived_at, Visit.queue_no)
    elif scope == "riwayat":
        stmt = stmt.where(Visit.arrived_at < start).order_by(Visit.arrived_at.desc())
    else:
        stmt = stmt.where(Visit.arrived_at >= start, Visit.arrived_at < end).order_by(Visit.queue_no, Visit.id)
    if q.strip():
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(Patient.name.ilike(like), Patient.rm_number.ilike(like)))
    rows = [serialize_rm_visit(v) for v in db.scalars(stmt.limit(300)).all()]
    counts = {k: sum(r["rm_status"] == k for r in rows)
              for k in ("terjadwal", "menunggu_pemeriksaan", "dalam_pemeriksaan", "selesai")}
    counts["total"] = len(rows)
    if status:
        rows = [r for r in rows if r["rm_status"] == status]
    return {"status": "ok", "scope": scope, "counts": counts, "rows": rows,
            "updated_at": utcnow().isoformat()}


@app.post("/visits/{visit_id}/konfirmasi")
def confirm_arrival(visit_id: int, user: User = Depends(require("admin", "perawat")),
                    db: Session = Depends(get_db)):
    v = get_visit(db, visit_id)
    if v.confirmed_at:
        raise HTTPException(409, "Kedatangan pasien ini sudah dikonfirmasi.")
    v.confirmed_at = utcnow()
    audit(db, user, "konfirmasi_kedatangan", f"visit:{v.id}")
    db.commit()
    return {"status": "ok", "message": f"Kedatangan {v.patient.name} dikonfirmasi. Status: Menunggu Pemeriksaan.",
            "visit": serialize_rm_visit(v)}


@app.get("/api/satusehat/pengiriman")
def satusehat_submissions(user: User = Depends(current_user), db: Session = Depends(get_db)):
    subs = db.scalars(select(Submission).order_by(Submission.id.desc()).limit(200)).all()
    return {
        "status": "ok",
        "mode": settings.satusehat_mode,
        "rows": [{
            "id": s.id,
            "status": s.status,
            "attempts": s.attempts,
            "last_error_code": s.last_error_code,
            "last_error_text": s.last_error_text,
            "visit_id": s.visit_id,
            "visit_code": s.visit.code if s.visit else None,
            "visit_date": s.visit.arrived_at.isoformat() if s.visit and s.visit.arrived_at else None,
            "patient": serialize_patient(s.visit.patient) if s.visit else None,
            "doctor": s.visit.practitioner.name if s.visit and s.visit.practitioner else None,
            "poli": s.visit.location.poli if s.visit else None,
        } for s in subs],
        "updated_at": utcnow().isoformat(),
    }


# ---------------- Administrasi Pendaftaran ----------------
@app.get("/pendaftaran")
def registration_page(user: User = Depends(current_user), db: Session = Depends(get_db)):
    queued = set(db.scalars(select(Visit.patient_id).where(Visit.arrived_at >= today_start_utc())))
    patients = db.scalars(select(Patient).order_by(Patient.name)).all()
    return {
        "status": "ok",
        "mode": settings.satusehat_mode,
        "patients": [serialize_patient(p) for p in patients],
        "queued_patient_ids": list(queued)
    }


async def _body(request: Request) -> dict:
    """Isian dari JSON atau form, supaya frontend React dan klien lama sama-sama bisa memakai rute ini."""
    if "application/json" in request.headers.get("content-type", ""):
        data = await request.json()
        return data if isinstance(data, dict) else {}
    return dict(await request.form())


@app.post("/pendaftaran/pasien")
async def add_patient(request: Request, user: User = Depends(require("admin", "perawat", "dokter")),
                      db: Session = Depends(get_db)):
    body = await _body(request)
    name, birth_date, gender = body.get("name"), body.get("birth_date"), body.get("gender")
    nik, ihs_number = str(body.get("nik") or ""), str(body.get("ihs_number") or "")
    if not name or not birth_date or not gender:
        raise HTTPException(400, "Nama, tanggal lahir, dan jenis kelamin wajib diisi.")
    if nik.strip() and not (nik.strip().isdigit() and len(nik.strip()) == 16):
        raise HTTPException(400, "NIK harus 16 digit angka.")

    p = Patient(name=str(name).strip(), rm_number=next_rm_number(db), nik=nik.strip() or None, gender=gender,
                birth_date=datetime.strptime(birth_date, "%Y-%m-%d").date(), ihs_number=ihs_number.strip() or None,
                phone=str(body.get("phone") or "").strip() or None,
                address=str(body.get("address") or "").strip() or None)
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
    return {
        "status": "ok",
        "message": msg,
        "patient": serialize_patient(p)
    }


@app.post("/pendaftaran/kunjungan")
async def register_visit(request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    body = await _body(request)
    pid = body.get("patient_id")
    if pid in (None, ""):
        raise HTTPException(400, "patient_id wajib diisi.")
    if not db.get(Patient, int(pid)):
        raise HTTPException(404, "Pasien tidak ditemukan.")

    loc = current_location(request, db)
    dr = None
    if body.get("practitioner_id"):
        dr = db.get(Practitioner, int(body["practitioner_id"]))
    if dr is None:
        dr = db.get(Practitioner, user.practitioner_id) if user.practitioner_id else \
            db.scalar(select(Practitioner).order_by(Practitioner.id.desc()))
    arrived = utcnow()
    if body.get("visit_date"):
        try:
            day = datetime.strptime(str(body["visit_date"]), "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(400, "Tanggal kunjungan tidak valid.")
        if day != datetime.now(WIB).date():
            arrived = datetime(day.year, day.month, day.day, 8, 0, tzinfo=WIB).astimezone(timezone.utc)
    v = Visit(code=next_visit_code(db), patient_id=int(pid), practitioner_id=dr.id, location_id=loc.id,
              queue_no=next_queue_no(db, loc.id), arrived_at=arrived,
              visit_type=str(body.get("visit_type") or "Baru"),
              admin_note=str(body.get("admin_note") or "").strip() or None)
    db.add(v)
    db.flush()
    audit(db, user, "create_visit", f"visit:{v.id}", v.code)
    db.commit()
    return {
        "status": "ok",
        "message": f"{v.patient.name} masuk antrean nomor {v.queue_no} ({loc.name}).",
        "visit": {
            "id": v.id,
            "code": v.code,
            "queue_no": v.queue_no,
            "patient_id": v.patient_id,
            "location_id": v.location_id
        }
    }


@app.post("/pendaftaran/demo")
def fill_demo_queue(user: User = Depends(current_user), db: Session = Depends(get_db)):
    n = seed_today_queue(db)
    return {
        "status": "ok",
        "count": n,
        "message": f"{n} pasien demo ditambahkan ke antrean hari ini."
    }


# ---------------- Dasbor & Statistik ----------------
@app.get("/dasbor")
def dashboard(user: User = Depends(current_user), db: Session = Depends(get_db)):
    by_status = dict(db.execute(select(Submission.status, func.count()).group_by(Submission.status)).all())
    total_edits = db.scalar(select(func.count(ReviewEdit.id))) or 0
    changed = db.scalar(select(func.count(ReviewEdit.id)).where(ReviewEdit.changed)) or 0
    correction_ratio = (changed / total_edits) if total_edits > 0 else 0.0
    per_field = [
        {"field": row[0], "count": row[1], "changed": int(row[2] or 0)}
        for row in db.execute(select(ReviewEdit.field_key, func.count(),
                                     func.sum(func.cast(ReviewEdit.changed, Integer)))
                              .group_by(ReviewEdit.field_key)).all()
    ]
    sessions = db.scalars(select(ScribeSession).where(ScribeSession.status == "done")
                          .order_by(ScribeSession.id.desc()).limit(20)).all()
    attention = db.scalars(select(Submission).where(Submission.status == "NEEDS_ATTENTION")).all()

    return {
        "status": "ok",
        "by_status": by_status,
        "total_edits": total_edits,
        "changed": changed,
        "correction_ratio": correction_ratio,
        "per_field": per_field,
        "sessions": [
            {
                "id": s.id,
                "visit_id": s.visit_id,
                "status": s.status,
                "created_at": s.created_at.isoformat() if s.created_at else None,
                "timings": s.timings
            }
            for s in sessions
        ],
        "attention": [
            {
                "id": a.id,
                "visit_id": a.visit_id,
                "status": a.status,
                "attempts": a.attempts,
                "last_error": a.last_error
            }
            for a in attention
        ],
        "mode": settings.satusehat_mode,
        "llm": settings.llm_providers
    }


# ---------------- Penanganan Galat Global JSON ----------------
@app.exception_handler(HTTPException)
async def http_error(_request: Request, exc: HTTPException):
    return JSONResponse({"detail": exc.detail}, status_code=exc.status_code)
