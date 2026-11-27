"""SIM ComeHear: FastAPI Headless REST API (Backend murni + worker kirim SATUSEHAT)."""
import asyncio
import hashlib
import hmac
import json
import logging
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from sqlalchemy import Integer, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload, selectinload

from app.config import get_settings
from app.db import Base, SessionLocal, engine, get_db
from app.fhir.codes import DRUGS
from app.migrate import add_missing_columns, ensure_patient_nik_unique
from app.models import (AuditLog, ClinicalNote, Consent, ConsentHistory, Location, Patient, Practitioner, ReviewEdit,
                        ScribeSession, Submission, User, Visit, as_utc, utcnow)
from app.satusehat.client import get_client
from app.scribe import pipeline
from app.scribe.icd import icd_table
from app.scribe.schemas import SUBJECTIVE_FIELDS
from app.security import verify_password
from app.seed import next_queue_no, next_rm_number, next_visit_code, seed, seed_today_queue
from app.services.notes import ApprovalError, approve_and_queue, correct_identity_and_queue, requeue
from app.services.queue_speech import announcement_wav
from app.services.soap_form import KESADARAN, apply_form
from app.sync.worker import OutboxWorker

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
log = logging.getLogger("comehear.api")
settings = get_settings()
APP_DIR = Path(__file__).parent
WIB = timezone(timedelta(hours=7))
CONSENT_VERSION = "v1-2026-10"
CONSENT_RELATIONS = {"pasien", "ibu", "ayah", "wali", "pasangan", "anak", "keluarga", "lainnya"}
ROLE_MATRIX = {
    "clinical": ("dokter",),
    "queue_call": ("dokter",),
    "registration": ("admin", "perawat"),
    "satusehat": ("admin", "perawat"),
    "shared_records": ("dokter", "admin", "perawat"),
}
HARI = ["Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu"]
BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"]
worker: OutboxWorker | None = None


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global worker
    settings.validate_runtime()
    Base.metadata.create_all(engine)
    added = add_missing_columns(engine)
    if added:
        log.info("kolom baru ditambahkan: %s", ", ".join(added))
    duplicates = ensure_patient_nik_unique(engine)
    if duplicates:
        masked = [f"****{nik[-4:]} ({count} data)" for nik, count in duplicates]
        log.error("NIK ganda ditemukan; indeks unik belum dipasang: %s", ", ".join(masked))
    settings.audio_dir.mkdir(parents=True, exist_ok=True)
    if settings.enable_demo_seed:
        with SessionLocal() as db:
            seed(db, settings.demo_password)
    worker = OutboxWorker(SessionLocal, get_client(settings), settings)
    worker.start()
    pipeline.warm_up(settings)
    pipeline.recover_stale_sessions(SessionLocal, settings)
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
    allow_origins=settings.allowed_origins,
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
        "location": {"id": v.location.id, "name": v.location.name, "label": loc_label(v.location),
                     "poli": v.location.poli},
        "has_note": bool(v.note),
        "is_approved": bool(v.note and v.note.approved_snapshot)
    }


# ---------------- Autentikasi (Cookie + Bearer Token HMAC) ----------------
def _sign(uid: int, issued_at: int | None = None) -> str:
    issued_at = issued_at or int(utcnow().timestamp())
    payload = f"{uid}.{issued_at}"
    sig = hmac.new(settings.secret_key.encode(), payload.encode(), hashlib.sha256).hexdigest()
    return f"{payload}.{sig}"


def current_user(request: Request, db: Session = Depends(get_db)) -> User:
    token = ""
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        token = auth[7:].strip()
    if not token:
        token = request.headers.get("x-session-token", "")
    if not token:
        token = request.cookies.get("session", "")

    parts = token.split(".")
    if len(parts) == 3 and parts[0].isdigit() and parts[1].isdigit():
        uid, issued_at = int(parts[0]), int(parts[1])
        max_age = settings.session_ttl_minutes * 60
        now = int(utcnow().timestamp())
        if 0 <= now - issued_at <= max_age and hmac.compare_digest(_sign(uid, issued_at), token):
            user = db.get(User, uid)
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


def current_location(request: Request, db: Session, default_location_id: int | None = None) -> Location | None:
    loc_id = request.headers.get("x-location-id") or request.cookies.get("loc", "")
    loc = db.get(Location, int(loc_id)) if str(loc_id).isdigit() else None
    if loc is None and default_location_id is not None:
        loc = db.get(Location, default_location_id)
    return loc or db.scalar(select(Location).order_by(Location.id.desc()))


def serialize_user(user: User) -> dict:
    return {
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "name": user.name,
        "role": user.role,
        "practitioner_id": user.practitioner_id,
        "default_location_id": user.practitioner.default_location_id if user.practitioner else None,
    }


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
    resp = JSONResponse({"status": "ok", "token": token, "user": serialize_user(user)})
    resp.delete_cookie("loc")
    resp.set_cookie("session", token, httponly=True, samesite="lax",
                    secure=settings.secure_cookies, max_age=settings.session_ttl_minutes * 60)
    return resp


@app.get("/logout")
@app.post("/logout")
def logout():
    resp = JSONResponse({"status": "ok", "message": "Berhasil logout."})
    resp.delete_cookie("session")
    return resp


@app.get("/api/me")
def get_me(user: User = Depends(current_user)):
    return serialize_user(user)


# ---------------- Lokasi ----------------
@app.get("/lokasi")
@app.get("/api/lokasi")
def list_locations(user: User = Depends(require(*ROLE_MATRIX["shared_records"])),
                   db: Session = Depends(get_db)):
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
async def set_location(request: Request, user: User = Depends(require(*ROLE_MATRIX["shared_records"])),
                       db: Session = Depends(get_db)):
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
    if ss and ss.status in ("recording", "queued", "transcribing", "refining", "extracting"):
        return "Menyusun draf", "primary"
    if (ss and ss.extraction) or (v.note and (v.note.subjective_summary or v.note.vitals)):
        return "Draf tersimpan", "primary"
    return ("Belum Ada Draft SOAP", "") if state == "saat_ini" else ("-", "")


@app.get("/antrean")
def queue_api(request: Request, tab: str = "semua", q: str = "",
              user: User = Depends(require(*ROLE_MATRIX["queue_call"])),
              db: Session = Depends(get_db)):
    doctor = user.practitioner
    loc = current_location(request, db, doctor.default_location_id if doctor else None)
    if loc is None:
        raise HTTPException(404, "Belum ada bilik layanan.")
    # Pasien, lokasi, catatan, dan sesi scribe diambil sekaligus (bukan 1 query per baris):
    # ke Supabase tiap query ±50 ms, jadi N+1 membuat antrean terasa lambat.
    visits = db.scalars(select(Visit).where(Visit.location_id == loc.id, Visit.arrived_at >= today_start_utc(),
                                           Visit.practitioner_id == user.practitioner_id)
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
    
    return {
        "status": "ok",
        "tab": tab,
        "counts": counts,
        "location": {"id": loc.id, "name": loc.name, "poli": loc.poli, "label": loc_label(loc)},
        "doctor": {"id": doctor.id, "name": doctor.name, "satusehat_id": doctor.satusehat_id} if doctor else None,
        "rows": [serialize_visit_brief(r["v"], r["state"], r["draft"]) for r in rows]
    }


@app.post("/visits/{visit_id}/panggil")
def call_patient(visit_id: int, user: User = Depends(require(*ROLE_MATRIX["queue_call"])),
                 db: Session = Depends(get_db)):
    v = get_assigned_visit(db, visit_id, user)
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


@app.get("/visits/{visit_id}/panggil/audio")
def call_patient_audio(visit_id: int, user: User = Depends(require(*ROLE_MATRIX["queue_call"])),
                       db: Session = Depends(get_db)):
    visit = get_assigned_visit(db, visit_id, user)
    if visit.queue_no is None:
        raise HTTPException(404, "Nomor antrean belum tersedia")
    poli = (visit.location.poli or "").strip()
    if poli and not poli.lower().startswith("poli "):
        poli = f"Poli {poli}"
    destination = ", ".join(filter(None, (poli, visit.location.name)))
    try:
        audio = announcement_wav(visit.queue_no, destination)
    except Exception:
        log.exception("Gagal membuat pengumuman antrean")
        raise HTTPException(503, "Pengumuman suara belum tersedia") from None
    return Response(audio, media_type="audio/wav", headers={"Cache-Control": "no-store"})


# ---------------- Konsultasi Klinis (SOAP + Scribe) ----------------
def get_visit(db: Session, visit_id: int) -> Visit:
    v = db.get(Visit, visit_id)
    if not v:
        raise HTTPException(404, "Kunjungan tidak ditemukan")
    return v


def get_assigned_visit(db: Session, visit_id: int, user: User) -> Visit:
    visit = get_visit(db, visit_id)
    if visit.practitioner_id != user.practitioner_id:
        raise HTTPException(403, "Kunjungan ini ditugaskan kepada dokter lain.")
    return visit


def _ensure_note(db: Session, v: Visit) -> ClinicalNote:
    if v.note is None:
        db.add(ClinicalNote(visit_id=v.id))
        db.commit()
        db.refresh(v)
    return v.note


def _review_session(v: Visit) -> ScribeSession | None:
    return next((s for s in reversed(v.scribe_sessions)
                 if s.status not in ("failed", "replaced", "abandoned")), None)


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
            "arrived_at": v.arrived_at.isoformat() if v.arrived_at else None,
            "started_at": v.started_at.isoformat() if v.started_at else None,
            "ended_at": v.ended_at.isoformat() if v.ended_at else None,
            "called_at": v.called_at.isoformat() if v.called_at else None,
            "doctor": v.practitioner.name if v.practitioner else None,
            "patient": serialize_patient(v.patient),
            "location": {"id": v.location.id, "name": v.location.name, "label": loc_label(v.location)},
            "consent": {
                "decision": v.consent.decision,
                "given_by_name": v.consent.given_by_name,
                "relation": v.consent.relation,
                "version": v.consent.text_version,
                "given_at": v.consent.given_at.isoformat() if v.consent.given_at else None
            } if v.consent else None,
            "consent_history": [{
                "decision": item.decision,
                "given_by_name": item.given_by_name,
                "relation": item.relation,
                "version": item.text_version,
                "recorded_by": item.recorded_by,
                "changed_at": item.changed_at.isoformat() if item.changed_at else None,
            } for item in db.scalars(select(ConsentHistory).where(
                ConsentHistory.visit_id == v.id).order_by(ConsentHistory.id)).all()]
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
            "id": ss.id if ss else 0,
            "job_id": ss.job_id if ss else None,
            "status": ss.status if ss else "done",
            "transcript": ss.transcript if ss else [],
            "extraction": ss.extraction if ss else None,
            "subjective_ready": bool(ss and ss.extraction),
            "icd_ready": bool((ss and ss.icd_suggestions) or (note.extra and note.extra.get("icd_suggestions"))),
            "applied_to_note": (ss.model_info or {}).get("applied_to_note", True) if ss else True,
            "manual_conflict": bool((ss.model_info or {}).get("manual_conflict")) if ss else False,
            "icd_suggestions": (ss.icd_suggestions if (ss and ss.icd_suggestions) else (note.extra.get("icd_suggestions") if note.extra else None)),
            "timings": ss.timings if ss else None,
            "error": ss.error if ss else None,
            "has_audio": bool(ss.audio_path and not ss.audio_deleted_at and Path(ss.audio_path).exists()) if ss else False
        } if (ss or (note.extra and note.extra.get("icd_suggestions"))) else None,
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
def get_consultation(visit_id: int, request: Request,
                     user: User = Depends(require(*ROLE_MATRIX["clinical"])),
                     db: Session = Depends(get_db)):
    v = get_assigned_visit(db, visit_id, user)
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
async def save_soap(visit_id: int, request: Request,
                    user: User = Depends(require(*ROLE_MATRIX["clinical"])),
                    db: Session = Depends(get_db)):
    v = get_assigned_visit(db, visit_id, user)
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
    
    v.started_at = v.started_at or utcnow()
    errors = apply_form(note, v, form, {r.code: r for r in icd_table(settings)})
    if v.status in ("registered", "consented", "manual", "processing"):
        v.status = "draft"
    audit(db, user, "edit_note", f"visit:{v.id}", action)
    db.commit()

    if errors:
        return JSONResponse({"status": "error", "errors": errors, "detail": " ".join(errors)}, status_code=400)

    # Pemicu background rekomendasi ICD-10 saat dokter lanjut dari Subjektif
    step = form.get("step")
    if step == "s" or action == "to_oap":
        subj_data = dict(note.subjective or {})
        if note.subjective_summary:
            subj_data["rangkuman_s"] = note.subjective_summary
        pipeline.submit_suggest_icd(SessionLocal, v.id, settings, subjective=subj_data)

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
    nxt = _advance_queue(db, v, user)
    if worker:
        worker.nudge()
    return {
        "status": "ok",
        "action": "approved",
        "next_visit_id": nxt.id if nxt else None,
        "visit_id": v.id,
        "submission_id": sub.id,
        "message": "SOAP tervalidasi dan diantrekan ke SATUSEHAT."
    }


@app.post("/visits/{visit_id}/consent")
def set_consent(visit_id: int, decision: str = Form(...), given_by_name: str = Form(...),
                relation: str = Form(...),
                user: User = Depends(require(*ROLE_MATRIX["clinical"])),
                db: Session = Depends(get_db)):
    v = get_assigned_visit(db, visit_id, user)
    if v.note and v.note.approved_snapshot:
        raise HTTPException(409, "Persetujuan tidak dapat diubah setelah catatan divalidasi.")
    decision = decision.strip().lower()
    if decision not in ("setuju", "tolak"):
        raise HTTPException(422, "Keputusan persetujuan hanya boleh 'setuju' atau 'tolak'.")
    giver = (given_by_name or "").strip()
    relationship = (relation or "").strip().lower()
    if not giver:
        raise HTTPException(422, "Nama pemberi persetujuan wajib diisi.")
    if relationship not in CONSENT_RELATIONS:
        raise HTTPException(422, "Hubungan pemberi persetujuan tidak valid.")
    if decision == "tolak" and any(s.status == "recording" for s in v.scribe_sessions):
        raise HTTPException(409, "Hentikan atau tutup rekaman lebih dulu.")
    if v.consent is None:
        v.consent = Consent(visit_id=v.id, decision=decision, given_by_name=giver,
                            relation=relationship, text_version=CONSENT_VERSION, recorded_by=user.id)
    else:
        v.consent.decision = decision
        v.consent.given_by_name = giver
        v.consent.relation = relationship
        v.consent.text_version = CONSENT_VERSION
        v.consent.given_at = utcnow()
        v.consent.recorded_by = user.id
    db.add(ConsentHistory(visit_id=v.id, decision=decision, given_by_name=giver,
                          relation=relationship, text_version=CONSENT_VERSION, recorded_by=user.id))
    if decision == "setuju":
        if v.status in ("registered", "manual"):
            v.status = "consented"
        summary = f"setuju; pemberi={giver}; hubungan={relationship}; versi={CONSENT_VERSION}"
    else:
        v.status = "manual"
        summary = f"tolak; pemberi={giver}; hubungan={relationship}; versi={CONSENT_VERSION}"
    audit(db, user, "consent", f"visit:{v.id}", summary)
    db.commit()
    return {"decision": decision, "given_by_name": giver, "relation": relationship,
            "version": CONSENT_VERSION, "status": "ok"}


def _start_session(
    db: Session,
    v: Visit,
    user: User,
    audio_path: str | None,
    status: str = "queued",
    idempotency_key: str | None = None,
) -> tuple[ScribeSession, bool]:
    if v.consent is None or v.consent.decision != "setuju":
        raise HTTPException(403, "Belum ada persetujuan pasien: perekaman tidak diizinkan.")
    if v.note and v.note.approved_snapshot:
        raise HTTPException(409, "Catatan sudah divalidasi.")
    if idempotency_key:
        existing = db.scalar(
            select(ScribeSession)
            .where(
                ScribeSession.visit_id == v.id,
                ScribeSession.idempotency_key == idempotency_key,
                ScribeSession.status.notin_(["replaced", "abandoned"]),
            )
            .order_by(ScribeSession.id.desc())
        )
        if existing is not None:
            return existing, False
    for old in v.scribe_sessions:
        if old.status not in ("failed", "replaced"):
            old.status = "replaced"
    now = utcnow()
    v.started_at = v.started_at or now
    if status != "recording":
        v.ended_at = now
    v.status = "processing"
    ss = ScribeSession(
        visit_id=v.id,
        audio_path=audio_path,
        status=status,
        job_id=str(uuid4()) if status != "recording" else None,
        idempotency_key=idempotency_key,
        last_activity_at=now,
        heartbeat_at=now,
        model_info={"live": {"offset": 0.0, "asr_s": 0.0}} if status == "recording" else None,
    )
    db.add(ss)
    audit(db, user, "scribe_start", f"visit:{v.id}", "rekam langsung" if status == "recording" else
          ("audio" if audio_path else "teks"))
    db.commit()
    return ss, True


@app.post("/visits/{visit_id}/audio")
async def upload_audio(visit_id: int, request: Request, audio: UploadFile = File(...),
                       user: User = Depends(require(*ROLE_MATRIX["clinical"])),
                       db: Session = Depends(get_db)):
    v = get_assigned_visit(db, visit_id, user)
    if v.consent is None or v.consent.decision != "setuju":
        raise HTTPException(403, "Belum ada persetujuan pasien.")
    idem_key = (request.headers.get("idempotency-key") or "").strip()[:80] or None
    suffix = Path(audio.filename or "rekaman.webm").suffix or ".webm"
    path = settings.audio_dir / f"visit{v.id}-{int(utcnow().timestamp())}{suffix}"
    ss, created = _start_session(db, v, user, str(path), idempotency_key=idem_key)
    if created:
        path.write_bytes(await audio.read())
        pipeline.submit(SessionLocal, ss.id, settings)
    return {"session_id": ss.id, "job_id": ss.job_id, "status": "ok"}


@app.post("/visits/{visit_id}/audio-start")
def audio_start(visit_id: int, user: User = Depends(require(*ROLE_MATRIX["clinical"])),
                db: Session = Depends(get_db)):
    v = get_assigned_visit(db, visit_id, user)
    path = settings.audio_dir / f"visit{v.id}-{uuid4().hex}.webm"
    ss, _ = _start_session(db, v, user, str(path), status="recording")
    path.write_bytes(b"")
    return {"status": "ok", "session_id": ss.id, "next_seq": 0}


@app.post("/visits/{visit_id}/audio-chunk")
async def audio_chunk(visit_id: int, seq: int = Form(...), chunk: UploadFile = File(...),
                      session_id: int | None = Form(None),
                      user: User = Depends(require(*ROLE_MATRIX["clinical"])),
                      db: Session = Depends(get_db)):
    v = get_assigned_visit(db, visit_id, user)
    if v.consent is None or v.consent.decision != "setuju":
        raise HTTPException(403, "Belum ada persetujuan pasien.")
    if v.note and v.note.approved_snapshot:
        raise HTTPException(409, "Catatan sudah divalidasi.")
    if seq == 0 and session_id is None:
        path = settings.audio_dir / f"visit{v.id}-{int(utcnow().timestamp())}.webm"
        ss, _ = _start_session(db, v, user, str(path), status="recording")
        path.write_bytes(b"")
    else:
        ss = db.get(ScribeSession, session_id) if session_id else None
        if ss is None or ss.visit_id != v.id or ss.status != "recording":
            raise HTTPException(409, "Sesi rekaman tidak aktif.")
    expected = ss.next_chunk_seq or 0
    if seq == expected - 1:
        return {"session_id": ss.id, "status": "ok"}
    if seq != expected:
        raise HTTPException(409, f"Potongan {seq} tidak berurutan (diharapkan {expected}).")
    with open(ss.audio_path, "ab") as f:
        f.write(await chunk.read())
    ss.next_chunk_seq = seq + 1
    ss.last_activity_at = utcnow()
    db.commit()
    pipeline.submit_live(SessionLocal, ss.id, settings)
    return {"session_id": ss.id, "next_seq": ss.next_chunk_seq, "status": "ok"}


@app.post("/visits/{visit_id}/audio-finish")
def audio_finish(visit_id: int, session_id: int = Form(...),
                 user: User = Depends(require(*ROLE_MATRIX["clinical"])),
                 db: Session = Depends(get_db),
                 idempotency_key: str | None = Form(None)):
    v = get_assigned_visit(db, visit_id, user)
    ss = db.get(ScribeSession, session_id)
    if ss is None or ss.visit_id != v.id:
        raise HTTPException(409, "Sesi rekaman tidak aktif.")
    if ss.status in ("queued", "transcribing", "refining", "extracting", "coding", "done"):
        return {"session_id": ss.id, "job_id": ss.job_id, "status": "ok"}
    if ss.status != "recording":
        raise HTTPException(409, "Sesi rekaman tidak aktif.")
    now = utcnow()
    ss.status = "queued"
    ss.job_id = ss.job_id or str(uuid4())
    if idempotency_key and not ss.idempotency_key:
        ss.idempotency_key = idempotency_key.strip()[:80]
    ss.closed_at = ss.last_activity_at = ss.heartbeat_at = now
    ss.closed_by = user.id
    v.ended_at = now
    db.commit()
    pipeline.notify_visit(v.id, pipeline.build_scribe_snapshot(v, ss, None))
    pipeline.submit(SessionLocal, ss.id, settings)
    return {"session_id": ss.id, "job_id": ss.job_id, "status": "ok"}


def _recoverable_recording(db: Session, visit_id: int, session_id: int | None = None) -> ScribeSession:
    stmt = select(ScribeSession).where(ScribeSession.visit_id == visit_id,
                                         ScribeSession.status == "recording")
    if session_id is not None:
        stmt = stmt.where(ScribeSession.id == session_id)
    ss = db.scalar(stmt.order_by(ScribeSession.id.desc()))
    if not ss:
        raise HTTPException(404, "Tidak ada sesi rekaman terputus yang dapat dipulihkan.")
    return ss


@app.get("/visits/{visit_id}/recording-recovery")
def recording_recovery(visit_id: int, user: User = Depends(require(*ROLE_MATRIX["clinical"])),
                       db: Session = Depends(get_db)):
    get_assigned_visit(db, visit_id, user)
    try:
        ss = _recoverable_recording(db, visit_id)
    except HTTPException:
        return {"status": "ok", "recoverable": False, "session": None}
    size = Path(ss.audio_path).stat().st_size if ss.audio_path and Path(ss.audio_path).exists() else 0
    return {"status": "ok", "recoverable": True, "session": {
        "id": ss.id, "next_seq": ss.next_chunk_seq or 0, "last_activity_at":
        ss.last_activity_at.isoformat() if ss.last_activity_at else None, "audio_bytes": size}}


@app.post("/visits/{visit_id}/recording-recovery/{session_id}/resume")
def resume_recording(visit_id: int, session_id: int,
                     user: User = Depends(require(*ROLE_MATRIX["clinical"])),
                     db: Session = Depends(get_db)):
    v = get_assigned_visit(db, visit_id, user)
    if not v.consent or v.consent.decision != "setuju":
        raise HTTPException(403, "Belum ada persetujuan pasien.")
    if v.note and v.note.approved_snapshot:
        raise HTTPException(409, "Catatan sudah divalidasi.")
    ss = db.scalar(select(ScribeSession).where(ScribeSession.id == session_id,
                   ScribeSession.visit_id == visit_id).with_for_update().execution_options(populate_existing=True))
    if not ss or ss.status not in ("recording", "done", "failed") or v.latest_session.id != ss.id:
        raise HTTPException(409, "Sesi ini tidak dapat dilanjutkan. Tunggu pemrosesan selesai atau mulai rekaman baru.")
    if not ss.audio_path or not Path(ss.audio_path).exists():
        raise HTTPException(409, "Berkas rekaman sesi tidak tersedia.")
    ss.status, ss.error, ss.finished_at = "recording", None, None
    ss.closed_at, ss.closed_by = None, None
    ss.last_activity_at = utcnow()
    v.status = "processing"
    audit(db, user, "resume_recording", f"visit:{visit_id}", f"session:{ss.id}")
    db.commit()
    return {"status": "ok", "session_id": ss.id, "next_seq": ss.next_chunk_seq or 0}


@app.post("/visits/{visit_id}/scribe/{session_id}/retry")
def retry_scribe(visit_id: int, session_id: int,
                 user: User = Depends(require(*ROLE_MATRIX["clinical"])),
                 db: Session = Depends(get_db)):
    v = get_assigned_visit(db, visit_id, user)
    ss = db.scalar(select(ScribeSession).where(ScribeSession.id == session_id,
                   ScribeSession.visit_id == v.id).with_for_update().execution_options(populate_existing=True))
    if ss is None or ss.status != "failed" or v.latest_session.id != ss.id:
        raise HTTPException(409, "Hanya sesi terakhir yang gagal dapat dicoba lagi.")
    if not v.consent or v.consent.decision != "setuju":
        raise HTTPException(403, "Belum ada persetujuan pasien.")
    if v.note and v.note.approved_snapshot:
        raise HTTPException(409, "Catatan sudah divalidasi.")
    text_transcript = None
    if not ss.audio_path or ss.audio_deleted_at or not Path(ss.audio_path).exists():
        text_transcript = "\n".join(segment["text"] for segment in (ss.transcript or []))
        if not text_transcript.strip():
            raise HTTPException(409, "Audio dan transkrip tidak tersedia. Silakan rekam ulang.")
    ss.status, ss.error, ss.finished_at = "queued", None, None
    ss.job_id = str(uuid4())
    ss.heartbeat_at = utcnow()
    v.status = "processing"
    audit(db, user, "scribe_retry", f"visit:{v.id}", f"session:{ss.id}")
    db.commit()
    pipeline.notify_visit(v.id, pipeline.build_scribe_snapshot(v, ss, None))
    pipeline.submit(SessionLocal, ss.id, settings, text_transcript=text_transcript)
    return {"status": "ok", "session_id": ss.id, "job_id": ss.job_id}


@app.post("/visits/{visit_id}/scribe/{session_id}/apply")
def apply_scribe_draft(visit_id: int, session_id: int,
                       user: User = Depends(require(*ROLE_MATRIX["clinical"])),
                       db: Session = Depends(get_db)):
    """Terapkan hasil draf Subjektif AI ke catatan klinis atas persetujuan dokter."""
    v = get_assigned_visit(db, visit_id, user)
    note = _ensure_note(db, v)
    if note.approved_snapshot:
        raise HTTPException(409, "Catatan sudah divalidasi dan dibekukan.")
    ss = db.scalar(
        select(ScribeSession)
        .where(ScribeSession.id == session_id, ScribeSession.visit_id == v.id)
        .execution_options(populate_existing=True)
    )
    if ss is None or not ss.extraction:
        raise HTTPException(404, "Draf AI sesi ini belum tersedia.")
    if not pipeline.apply_session_extraction(db, ss, note):
        raise HTTPException(409, "Draf AI tidak dapat diterapkan.")
    audit(db, user, "apply_ai_draft", f"visit:{v.id}", f"session:{ss.id}")
    db.commit()
    pipeline.notify_visit(v.id, pipeline.build_scribe_snapshot(v, ss, None))
    return {
        "status": "ok",
        "session_id": ss.id,
        "subjective": note.subjective,
        "subjective_summary": note.subjective_summary,
    }


@app.post("/visits/{visit_id}/recording-recovery/{session_id}/abandon")
def abandon_recording(visit_id: int, session_id: int,
                      user: User = Depends(require(*ROLE_MATRIX["clinical"])),
                      db: Session = Depends(get_db)):
    v = get_assigned_visit(db, visit_id, user)
    ss = _recoverable_recording(db, visit_id, session_id)
    if ss.audio_path:
        Path(ss.audio_path).unlink(missing_ok=True)
        ss.audio_deleted_at = utcnow()
    ss.status, ss.closed_at, ss.closed_by = "abandoned", utcnow(), user.id
    v.status = "consented" if v.consent and v.consent.decision == "setuju" else "manual"
    audit(db, user, "abandon_recording", f"visit:{visit_id}", f"session:{ss.id}")
    db.commit()
    return {"status": "ok", "session_id": ss.id, "message": "Sesi rekaman ditutup dan audio parsial dihapus."}


@app.post("/visits/{visit_id}/transcript-text")
async def upload_text(visit_id: int, request: Request, transcript: str = Form(None),
                      user: User = Depends(require(*ROLE_MATRIX["clinical"])),
                      db: Session = Depends(get_db)):
    v = get_assigned_visit(db, visit_id, user)
    text = transcript
    if not text:
        ct = request.headers.get("content-type", "")
        if "application/json" in ct:
            body = await request.json()
            text = body.get("transcript", "")
    if not text:
        raise HTTPException(400, "Transkrip tidak boleh kosong.")
    idem_key = (request.headers.get("idempotency-key") or "").strip()[:80] or None
    ss, created = _start_session(db, v, user, None, idempotency_key=idem_key)
    if created:
        pipeline.submit(SessionLocal, ss.id, settings, text_transcript=text)
    return {
        "status": "ok",
        "session_id": ss.id,
        "job_id": ss.job_id,
        "visit_id": v.id
    }


@app.get("/visits/{visit_id}/audio/{session_id}")
def play_audio(visit_id: int, session_id: int,
               user: User = Depends(require(*ROLE_MATRIX["clinical"])), db: Session = Depends(get_db)):
    get_assigned_visit(db, visit_id, user)
    ss = db.get(ScribeSession, session_id)
    if not ss or ss.visit_id != visit_id or not ss.audio_path or ss.audio_deleted_at or not Path(ss.audio_path).exists():
        raise HTTPException(404, "Rekaman tidak tersedia (sudah dihapus setelah validasi).")
    audit(db, user, "play_audio", f"visit:{visit_id}")
    db.commit()
    return FileResponse(ss.audio_path, media_type="audio/webm")


@app.get("/api/sessions/{session_id}")
def session_status(session_id: int, user: User = Depends(require(*ROLE_MATRIX["clinical"])),
                   db: Session = Depends(get_db)):
    ss = db.get(ScribeSession, session_id)
    if not ss:
        raise HTTPException(404)
    get_assigned_visit(db, ss.visit_id, user)
    return {"status": ss.status, "error": ss.error, "timings": ss.timings, "visit_id": ss.visit_id}


@app.get("/visits/{visit_id}/scribe")
def scribe_state(visit_id: int, user: User = Depends(require(*ROLE_MATRIX["clinical"])),
                 db: Session = Depends(get_db)):
    """Keadaan draf AI untuk asisten klinis (dipanggil berkala selama rekaman/penyusunan)."""
    db.expire_all()
    v = get_assigned_visit(db, visit_id, user)
    ss, failed = _review_session(v), _failed_session(v)
    return pipeline.build_scribe_snapshot(v, ss, failed)


@app.get("/visits/{visit_id}/scribe/events")
async def scribe_events(visit_id: int, request: Request,
                        user: User = Depends(require(*ROLE_MATRIX["clinical"])),
                        db: Session = Depends(get_db)):
    """Server-Sent Events untuk pembaruan status Scribe & ICD-10 tanpa menahan koneksi DB."""
    v = get_assigned_visit(db, visit_id, user)
    initial = pipeline.build_scribe_snapshot(v, _review_session(v), _failed_session(v))
    db.close()

    loop = asyncio.get_running_loop()
    queue = pipeline.subscribe(visit_id, loop)

    async def stream():
        try:
            yield f"event: scribe\ndata: {json.dumps(initial, ensure_ascii=False)}\n\n"
            while True:
                if await request.is_disconnected():
                    break
                try:
                    payload = await asyncio.wait_for(queue.get(), timeout=15.0)
                    yield f"event: scribe\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"
                except asyncio.TimeoutError:
                    yield ": ping\n\n"
        finally:
            pipeline.unsubscribe(visit_id, loop, queue)

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
    )


@app.post("/visits/{visit_id}/suggest-icd")
async def trigger_icd(visit_id: int, request: Request,
                      user: User = Depends(require(*ROLE_MATRIX["clinical"])),
                      db: Session = Depends(get_db)):
    """Pemicu background untuk menyusun/memperbarui rekomendasi ICD-10."""
    v = get_assigned_visit(db, visit_id, user)
    note = _ensure_note(db, v)
    body = await _body(request)
    subj = body.get("subjective") or dict(note.subjective or {})
    if note.subjective_summary and "rangkuman_s" not in subj:
        subj["rangkuman_s"] = note.subjective_summary
    obj = body.get("objective") or note.exam_text or (note.extra.get("objektif") if note.extra else None)
    pipeline.submit_suggest_icd(SessionLocal, v.id, settings, subjective=subj, objective=obj)
    return {"status": "ok", "message": "Penyusunan usulan ICD-10 berjalan di background."}


@app.get("/api/icd")
def icd_search(q: str = "", user: User = Depends(require(*ROLE_MATRIX["clinical"]))):
    ql = q.strip().lower()
    if len(ql) < 2:
        return []
    rows = icd_table(settings)
    hits = [r for r in rows if r.code.lower().startswith(ql)] + \
           [r for r in rows if ql in r.display.lower() and not r.code.lower().startswith(ql)]
    return [{"code": r.code, "display": r.display} for r in hits[:15]]


@app.get("/api/kfa")
@app.get("/api/backend/kfa")
def kfa_search(q: str = "", user: User = Depends(require(*ROLE_MATRIX["clinical"]))):
    """Mencari obat KFA terdaftar untuk peresepan terstruktur SATUSEHAT."""
    ql = q.strip().lower()
    hits = []
    for code, meta in DRUGS.items():
        display = meta.get("display", "")
        ing = meta.get("ingredient_display", "")
        if not ql or ql in code.lower() or ql in display.lower() or ql in ing.lower():
            hits.append({
                "code": code,
                "display": display,
                "form": meta.get("form_display", ""),
                "dose_unit": meta.get("dose_unit", "tablet"),
                "proven": meta.get("proven", True),
            })
    return hits


@app.get("/api/clinic")
@app.get("/api/backend/clinic")
def clinic_info():
    """Mengembalikan informasi identitas faskes / profil klinik."""
    return {
        "name": settings.clinic_name,
        "serviceType": settings.clinic_service_type,
        "address": settings.clinic_address,
        "phone": settings.clinic_phone,
        "email": settings.clinic_email,
        "licenseNumber": settings.clinic_license,
        "faskesCode": settings.clinic_faskes_code,
    }


@app.get("/api/notifikasi")
@app.get("/api/backend/notifikasi")
def notifications_list(user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Daftar notifikasi aktif berdasarkan peran pengguna."""
    items = []

    # 1. SATUSEHAT Gagal / Perlu Perhatian
    failed_subs = db.scalars(
        select(Submission)
        .where(Submission.status == "NEEDS_ATTENTION")
        .order_by(Submission.id.desc())
        .limit(5)
    ).all()
    for s in failed_subs:
        p_name = s.visit.patient.name if s.visit and s.visit.patient else "Pasien"
        err = s.last_error_text or "Gagal kirim ke SATUSEHAT"
        items.append({
            "id": f"sub-{s.id}",
            "type": "satusehat_error",
            "severity": "danger",
            "title": f"SATUSEHAT: {p_name}",
            "message": err[:90] + ("..." if len(err) > 90 else ""),
            "created_at": s.created_at.isoformat() if s.created_at else utcnow().isoformat(),
            "link": "/rm/satusehat" if user.role != "dokter" else f"/kunjungan/{s.visit_id}/resume",
        })

    # 2. Pasien Terjadwal Hari Ini Belum Konfirmasi Kedatangan (untuk Petugas RM)
    if user.role != "dokter":
        unconfirmed = db.scalars(
            select(Visit)
            .where(Visit.arrived_at >= today_start_utc(), Visit.confirmed_at.is_(None))
            .order_by(Visit.id.desc())
            .limit(5)
        ).all()
        for v in unconfirmed:
            p_name = v.patient.name if v.patient else "Pasien"
            items.append({
                "id": f"visit-unconfirmed-{v.id}",
                "type": "patient_terjadwal",
                "severity": "warning",
                "title": "Perlu Konfirmasi Kedatangan",
                "message": f"{p_name} ({v.patient.rm_number or 'RM-'}) terjadwal hari ini.",
                "created_at": v.arrived_at.isoformat() if v.arrived_at else utcnow().isoformat(),
                "link": "/rm/kunjungan",
            })

    # 3. Antrean Menunggu Pemeriksaan Dokter (untuk Dokter)
    if user.role == "dokter":
        waiting = db.scalars(
            select(Visit)
            .where(
                Visit.arrived_at >= today_start_utc(),
                Visit.status.in_(["registered", "consented"]),
                Visit.confirmed_at.is_not(None),
                Visit.practitioner_id == user.practitioner_id,
            )
            .order_by(Visit.queue_no, Visit.id)
            .limit(3)
        ).all()
        for v in waiting:
            p_name = v.patient.name if v.patient else "Pasien"
            items.append({
                "id": f"queue-{v.id}",
                "type": "patient_waiting",
                "severity": "info",
                "title": f"Antrean No. {v.queue_no or '-'}",
                "message": f"Pasien {p_name} siap diperiksa.",
                "created_at": (v.confirmed_at or v.arrived_at).isoformat(),
                "link": f"/kunjungan/{v.id}/subjektif",
            })

    return {
        "status": "ok",
        "count": len(items),
        "items": items,
    }



def _advance_queue(db: Session, done: Visit, user: User) -> Visit | None:
    """Setelah SOAP divalidasi, pasien menunggu berikutnya otomatis menjadi "Antrean saat ini".

    Tidak mengubah apa pun bila dokter sudah memanggil pasien lain lebih dulu.
    """
    visits = db.scalars(select(Visit).where(Visit.location_id == done.location_id, Visit.arrived_at >= today_start_utc())
                        .options(joinedload(Visit.note)).order_by(Visit.queue_no, Visit.id)).unique().all()
    pending = [o for o in visits if o.id != done.id and not (o.note and o.note.approved_snapshot)]
    if any(o.called_at for o in pending):
        return None
    pending = [o for o in pending if o.practitioner_id == done.practitioner_id]
    after = [o for o in pending if (o.queue_no or 0) > (done.queue_no or 0)]
    nxt = (after or pending or [None])[0]
    if nxt:
        nxt.called_at = utcnow()
        audit(db, user, "panggil_otomatis", f"visit:{nxt.id}", f"setelah visit:{done.id} selesai")
        db.commit()
    return nxt

def _record_edits(db: Session, v: Visit, user: User):
    ss = next((s for s in reversed(v.scribe_sessions) if s.status == "done"), None)
    if not ss or not ss.extraction:
        return
    final = v.note.approved_snapshot
    pairs = [(k, ss.extraction[k]["nilai"], final["subjective"].get(k)) for k in SUBJECTIVE_FIELDS]
    pairs.append(("rangkuman_s", ss.extraction.get("rangkuman_s"), final["subjective_summary"]))
    raw_icd = ss.icd_suggestions or []
    if isinstance(raw_icd, dict):
        ai_codes = [c["code"] for c in raw_icd.get("utama", []) if isinstance(c, dict) and "code" in c]
    else:
        ai_codes = [c["code"] for c in raw_icd if isinstance(c, dict) and "code" in c]
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
def resume_page(visit_id: int, user: User = Depends(require(*ROLE_MATRIX["shared_records"])),
                db: Session = Depends(get_db)):
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
            "arrived_at": v.arrived_at.isoformat() if v.arrived_at else None,
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
            "revision": sub.revision or 1,
            "supersedes_id": sub.supersedes_id,
            "correction_reason": sub.correction_reason,
            "status": sub.status,
            "attempts": sub.attempts,
            "last_error_text": sub.last_error_text,
            "last_error_code": sub.last_error_code,
            "bundle": sub.bundle,
            "resources": [{"resource_type": r.resource_type, "resource_id": r.resource_id} for r in sub.resources]
        } if sub else None
    }


@app.post("/submissions/{sub_id}/requeue")
def requeue_submission(sub_id: int, user: User = Depends(require(*ROLE_MATRIX["satusehat"])),
                       db: Session = Depends(get_db)):
    sub = db.get(Submission, sub_id)
    if not sub or sub.status not in ("NEEDS_ATTENTION", "RETRY_WAIT"):
        raise HTTPException(409, "Pengiriman ini tidak bisa diulang.")
    try:
        requeue(db, sub, user)
    except ApprovalError as exc:
        raise HTTPException(409, " ".join(exc.errors)) from exc
    if worker:
        worker.nudge()
    return {
        "status": "ok",
        "message": "Submission berhasil dimasukkan kembali ke antrean kirim.",
        "submission_id": sub.id
    }


@app.post("/submissions/{sub_id}/correct-identity")
async def correct_submission_identity(sub_id: int, request: Request,
                                      user: User = Depends(require(*ROLE_MATRIX["satusehat"])),
                                      db: Session = Depends(get_db)):
    sub = db.get(Submission, sub_id)
    if not sub:
        raise HTTPException(404, "Pengiriman tidak ditemukan.")
    body = await _body(request)
    reason = str(body.get("reason") or "Perbaikan identitas pasien").strip()
    if not reason:
        raise HTTPException(422, "Alasan koreksi wajib diisi.")
    try:
        corrected = correct_identity_and_queue(db, sub, user, settings, reason)
    except ApprovalError as exc:
        raise HTTPException(409, " ".join(exc.errors)) from exc
    if worker:
        worker.nudge()
    return {"status": "ok", "message": "Bundle koreksi dibuat dan dimasukkan ke antrean kirim.",
            "submission_id": corrected.id, "revision": corrected.revision,
            "supersedes_id": corrected.supersedes_id}


@app.get("/riwayat")
def history_page(q: str = "", user: User = Depends(require(*ROLE_MATRIX["shared_records"])),
                 db: Session = Depends(get_db)):
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
def list_practitioners(user: User = Depends(require(*ROLE_MATRIX["registration"])),
                       db: Session = Depends(get_db)):
    return [{"id": p.id, "name": p.name, "default_location_id": p.default_location_id}
            for p in db.scalars(select(Practitioner).order_by(Practitioner.name))]


@app.get("/api/rm/kunjungan")
def rm_visits(scope: str = "hari_ini", q: str = "", status: str = "", tanggal: str = "",
              user: User = Depends(require(*ROLE_MATRIX["registration"])), db: Session = Depends(get_db)):
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
def satusehat_submissions(user: User = Depends(require(*ROLE_MATRIX["satusehat"])),
                          db: Session = Depends(get_db)):
    subs = db.scalars(select(Submission).order_by(Submission.id.desc()).limit(200)).all()
    return {
        "status": "ok",
        "mode": settings.satusehat_mode,
        "rows": [{
            "id": s.id,
            "revision": s.revision or 1,
            "supersedes_id": s.supersedes_id,
            "correction_reason": s.correction_reason,
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
def registration_page(user: User = Depends(require(*ROLE_MATRIX["registration"])),
                      db: Session = Depends(get_db)):
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


def _reject_duplicate_nik(db: Session, nik: str, exclude_patient_id: int | None = None) -> None:
    stmt = select(Patient).where(Patient.nik == nik)
    if exclude_patient_id is not None:
        stmt = stmt.where(Patient.id != exclude_patient_id)
    duplicate = db.scalar(stmt)
    if duplicate:
        raise HTTPException(409, f"NIK sudah terdaftar pada pasien RM {duplicate.rm_number}.")


@app.post("/pendaftaran/pasien")
async def add_patient(request: Request, user: User = Depends(require(*ROLE_MATRIX["registration"])),
                      db: Session = Depends(get_db)):
    body = await _body(request)
    name, birth_date, gender = body.get("name"), body.get("birth_date"), body.get("gender")
    nik, ihs_number = str(body.get("nik") or ""), str(body.get("ihs_number") or "")
    if not name or not birth_date or not gender:
        raise HTTPException(400, "Nama, tanggal lahir, dan jenis kelamin wajib diisi.")
    if nik.strip() and not (nik.strip().isdigit() and len(nik.strip()) == 16):
        raise HTTPException(400, "NIK harus 16 digit angka.")
    if nik.strip():
        _reject_duplicate_nik(db, nik.strip())

    p = Patient(name=str(name).strip(), rm_number=next_rm_number(db), nik=nik.strip() or None, gender=gender,
                birth_date=datetime.strptime(birth_date, "%Y-%m-%d").date(), ihs_number=ihs_number.strip() or None,
                phone=str(body.get("phone") or "").strip() or None,
                address=str(body.get("address") or "").strip() or None)
    db.add(p)
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(409, "NIK sudah terdaftar pada pasien lain.") from exc
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


@app.put("/pendaftaran/pasien/{patient_id}")
@app.post("/pendaftaran/pasien/{patient_id}")
async def update_patient(patient_id: int, request: Request,
                         user: User = Depends(require(*ROLE_MATRIX["registration"])),
                         db: Session = Depends(get_db)):
    p = db.get(Patient, patient_id)
    if not p:
        raise HTTPException(404, "Pasien tidak ditemukan.")
    body = await _body(request)
    name = body.get("name")
    birth_date = body.get("birth_date")
    gender = body.get("gender")
    nik = str(body.get("nik") or "").strip()
    phone = str(body.get("phone") or "").strip() or None
    address = str(body.get("address") or "").strip() or None

    if name is not None:
        if not str(name).strip():
            raise HTTPException(400, "Nama lengkap tidak boleh kosong.")
        p.name = str(name).strip()

    if birth_date is not None:
        try:
            p.birth_date = datetime.strptime(str(birth_date).strip(), "%Y-%m-%d").date()
        except Exception:
            raise HTTPException(400, "Format tanggal lahir harus YYYY-MM-DD.")

    if gender is not None:
        if gender in ("male", "female"):
            p.gender = gender
        elif gender in ("L", "P"):
            p.gender = "male" if gender == "L" else "female"

    if "nik" in body:
        if not nik:
            raise HTTPException(400, "NIK wajib diisi.")
        if not (nik.isdigit() and len(nik) == 16):
            raise HTTPException(400, "NIK harus 16 digit angka.")
        if nik != (p.nik or ""):
            _reject_duplicate_nik(db, nik, p.id)
            p.nik = nik
            p.ihs_number = None

    if phone is not None:
        p.phone = phone
    if address is not None:
        p.address = address

    msg = f"Data pasien {p.name} (RM {p.rm_number}) berhasil diperbarui."
    if p.nik and not p.ihs_number and settings.satusehat_mode != "mock":
        try:
            p.ihs_number = get_client(settings).find_patient_by_nik(p.nik)
            p.ihs_checked_at = utcnow()
            if p.ihs_number:
                msg += f" Nomor IHS diperbarui: {p.ihs_number}."
        except Exception:
            pass

    audit(db, user, "update_patient", f"patient:{p.id}")
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(409, "NIK sudah terdaftar pada pasien lain.") from exc
    return {
        "status": "ok",
        "message": msg,
        "patient": serialize_patient(p)
    }


@app.post("/pendaftaran/kunjungan")
async def register_visit(request: Request, user: User = Depends(require(*ROLE_MATRIX["registration"])),
                         db: Session = Depends(get_db)):
    body = await _body(request)
    pid = body.get("patient_id")
    if pid in (None, ""):
        raise HTTPException(400, "patient_id wajib diisi.")
    if not db.get(Patient, int(pid)):
        raise HTTPException(404, "Pasien tidak ditemukan.")

    try:
        location_id = int(body["location_id"]) if body.get("location_id") else None
        practitioner_id = int(body["practitioner_id"]) if body.get("practitioner_id") else user.practitioner_id
    except (TypeError, ValueError):
        raise HTTPException(400, "Bilik atau dokter tidak valid.") from None
    dr = db.get(Practitioner, practitioner_id) if practitioner_id is not None else None
    if practitioner_id is not None and dr is None:
        raise HTTPException(404, "Dokter tidak ditemukan.")
    loc = (db.get(Location, location_id) if location_id is not None
           else current_location(request, db, dr.default_location_id if dr else None))
    if loc is None:
        raise HTTPException(404, "Bilik layanan tidak ditemukan.")
    if dr is None:
        doctors = select(Practitioner).order_by(Practitioner.id.desc())
        dr = db.scalar(doctors.where(Practitioner.default_location_id == loc.id)) or db.scalar(doctors)
        if dr is None:
            raise HTTPException(404, "Dokter tidak ditemukan.")
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
def fill_demo_queue(user: User = Depends(require(*ROLE_MATRIX["registration"])),
                    db: Session = Depends(get_db)):
    if settings.satusehat_mode != "mock" or not settings.enable_demo_seed:
        raise HTTPException(403, "Pengisian data demo hanya aktif pada mode mock lokal.")
    n = seed_today_queue(db)
    return {
        "status": "ok",
        "count": n,
        "message": f"{n} pasien demo ditambahkan ke antrean hari ini."
    }


# ---------------- Dasbor & Statistik ----------------
@app.get("/dasbor")
def dashboard(user: User = Depends(require(*ROLE_MATRIX["satusehat"])), db: Session = Depends(get_db)):
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
