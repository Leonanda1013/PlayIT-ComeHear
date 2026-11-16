"""Persetujuan dokter -> snapshot beku -> bundle -> antrean kirim."""
import hashlib
import json
from copy import deepcopy
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import Settings
from app.fhir.builder import build_bundle
from app.fhir.precheck import check_bundle, check_snapshot
from app.models import AuditLog, ClinicalNote, Submission, User, Visit, as_utc, utcnow

IDENTITY_MARKERS = ("patient", "pasien", "ihs", "nik", "identitas")
TRANSIENT_MARKERS = ("timeout", "koneksi", "connect", "transport", "http 5", "429", "temporar")


def _iso(dt) -> str | None:
    return as_utc(dt).isoformat() if dt else None


def actual_arrival(visit: Visit, approved_at) -> str | None:
    """Jadwal kunjungan bukan waktu kedatangan untuk Encounter."""
    if isinstance(approved_at, str):
        approved_at = datetime.fromisoformat(approved_at)
    approved = as_utc(approved_at)
    candidates = [as_utc(dt) for dt in (visit.confirmed_at, visit.started_at) if dt]
    candidates = [dt for dt in candidates if dt <= approved]
    if candidates:
        return _iso(min(candidates))
    scheduled = as_utc(visit.arrived_at)
    return _iso(scheduled) if scheduled and scheduled <= approved else None


def make_snapshot(visit: Visit, note: ClinicalNote, approved_at) -> dict:
    return {
        "visit": {"code": visit.code, "arrived_at": actual_arrival(visit, approved_at),
                  "scheduled_at": _iso(visit.arrived_at),
                  "started_at": _iso(visit.started_at), "ended_at": _iso(visit.ended_at)},
        "patient": {"ihs_number": visit.patient.ihs_number, "name": visit.patient.name},
        "practitioner": {"satusehat_id": visit.practitioner.satusehat_id, "name": visit.practitioner.name},
        "location": {"satusehat_id": visit.location.satusehat_location_id, "name": visit.location.name,
                     "service_type_code": visit.location.service_type_code,
                     "service_type_display": visit.location.service_type_display},
        "subjective": dict(note.subjective or {}),
        "subjective_summary": note.subjective_summary or "",
        "allergies": list(note.allergies or []),
        "vitals": dict(note.vitals or {}),
        "exam_text": note.exam_text or "",
        "diagnoses": list(note.diagnoses or []),
        "assessment": note.assessment or "",
        "prescriptions": list(note.prescriptions or []),
        "plan_text": note.plan_text or "",
        "approved_at": _iso(approved_at),
    }


class ApprovalError(Exception):
    def __init__(self, errors: list[str]):
        super().__init__("; ".join(errors))
        self.errors = errors


def approve_and_queue(db: Session, visit: Visit, user: User, settings: Settings) -> Submission:
    """Hanya dokter yang boleh menyetujui. Tidak ada pengiriman sebelum disetujui."""
    if user.role != "dokter":
        raise ApprovalError(["Hanya dokter yang dapat menyetujui catatan klinis."])
    note = visit.note
    if note is None:
        raise ApprovalError(["Catatan belum ada."])
    if note.approved_snapshot:
        raise ApprovalError(["Catatan sudah disetujui; koreksi dibuat sebagai versi baru."])
    now = utcnow()
    if visit.ended_at is None:
        visit.ended_at = now
    snap = make_snapshot(visit, note, now)
    errors = check_snapshot(snap, settings.satusehat_org_id)
    if errors:
        raise ApprovalError(errors)
    bundle = build_bundle(snap, settings.satusehat_org_id)
    errors = check_bundle(bundle)
    if errors:
        raise ApprovalError(errors)

    note.approved_snapshot, note.approved_by, note.approved_at = snap, user.id, now
    visit.status = "approved"
    key = hashlib.sha256(f"{visit.code}:{json.dumps(snap, sort_keys=True)}".encode()).hexdigest()[:40]
    sub = Submission(visit_id=visit.id, idempotency_key=key, bundle=bundle, snapshot=snap,
                     revision=1, status="QUEUED", next_attempt_at=now)
    db.add(sub)
    db.add(AuditLog(user_id=user.id, action="approve", obj=f"visit:{visit.id}",
                    summary=f"{len(bundle['entry'])} resource diantrekan"))
    db.commit()
    return sub


def requeue(db: Session, sub: Submission, user: User) -> None:
    """Ulang bundle identik hanya untuk gangguan sementara; koreksi data memakai versi baru."""
    error = sub.last_error_text or ""
    normalized = f"{sub.last_error_code or ''} {error}".lower()
    if any(marker in normalized for marker in IDENTITY_MARKERS):
        raise ApprovalError(["Identitas pasien berubah; buat bundle koreksi sebelum mengirim ulang."])
    if "Future Date" in error and "Encounter" in error:
        if sub.resources:
            raise ApprovalError(["Pengiriman sudah memiliki resource; koreksi otomatis tidak aman."])
        snap = sub.visit.note.approved_snapshot if sub.visit.note else None
        arrival = actual_arrival(sub.visit, snap["approved_at"]) if snap else None
        if not arrival:
            raise ApprovalError(["Waktu kedatangan/pemeriksaan aktual belum tercatat; pengiriman tidak dapat diperbaiki otomatis."])
        corrected = deepcopy(snap)
        corrected["visit"]["arrived_at"] = arrival
        org_id = sub.bundle["entry"][0]["resource"]["serviceProvider"]["reference"].split("/")[-1]
        errors = check_snapshot(corrected, org_id)
        if errors:
            raise ApprovalError(errors)
        bundle = build_bundle(corrected, org_id)
        errors = check_bundle(bundle)
        if errors:
            raise ApprovalError(errors)
        sub.bundle = bundle
        db.add(AuditLog(user_id=user.id, action="correct_encounter_time", obj=f"submission:{sub.id}",
                        summary=f"Jadwal {snap['visit']['arrived_at']} diganti waktu aktual {arrival} pada bundle"))
    elif sub.status != "RETRY_WAIT" and not any(marker in normalized for marker in TRANSIENT_MARKERS):
        raise ApprovalError(["Bundle lama hanya boleh dikirim ulang untuk gangguan sementara."])
    sub.status, sub.next_attempt_at = "QUEUED", utcnow()
    db.add(AuditLog(user_id=user.id, action="requeue", obj=f"submission:{sub.id}"))
    db.commit()


def correct_identity_and_queue(db: Session, sub: Submission, user: User, settings: Settings,
                               reason: str) -> Submission:
    """Bangun submission revisi dari identitas pasien terkini tanpa mengubah snapshot klinis beku."""
    if sub.status != "NEEDS_ATTENTION":
        raise ApprovalError(["Hanya pengiriman yang memerlukan perhatian yang dapat dikoreksi."])
    normalized = f"{sub.last_error_code or ''} {sub.last_error_text or ''}".lower()
    if not any(marker in normalized for marker in IDENTITY_MARKERS):
        raise ApprovalError(["Koreksi identitas hanya tersedia untuk error identitas pasien."])
    if sub.resources:
        raise ApprovalError(["Sebagian resource sudah tercatat; koreksi otomatis tidak aman."])
    if db.scalar(select(Submission.id).where(Submission.supersedes_id == sub.id).limit(1)):
        raise ApprovalError(["Bundle koreksi untuk pengiriman ini sudah dibuat."])
    base = sub.snapshot or (sub.visit.note.approved_snapshot if sub.visit.note else None)
    if not base:
        raise ApprovalError(["Snapshot pengiriman lama tidak tersedia."])
    corrected = deepcopy(base)
    corrected["patient"] = {
        **corrected.get("patient", {}),
        "ihs_number": sub.visit.patient.ihs_number,
        "name": sub.visit.patient.name,
    }
    errors = check_snapshot(corrected, settings.satusehat_org_id)
    if errors:
        raise ApprovalError(errors)
    bundle = build_bundle(corrected, settings.satusehat_org_id)
    errors = check_bundle(bundle)
    if errors:
        raise ApprovalError(errors)
    revision = (sub.revision or 1) + 1
    key_material = f"{sub.visit.code}:revision:{revision}:{json.dumps(corrected, sort_keys=True)}"
    corrected_sub = Submission(
        visit_id=sub.visit_id,
        supersedes_id=sub.id,
        revision=revision,
        correction_reason=reason.strip()[:1000],
        corrected_by=user.id,
        snapshot=corrected,
        idempotency_key=hashlib.sha256(key_material.encode()).hexdigest()[:40],
        bundle=bundle,
        status="QUEUED",
        next_attempt_at=utcnow(),
    )
    sub.status = "SUPERSEDED"
    db.add(corrected_sub)
    db.flush()
    db.add(AuditLog(user_id=user.id, action="correct_identity", obj=f"submission:{corrected_sub.id}",
                    summary=f"revisi {revision}; menggantikan submission {sub.id}; {reason.strip()[:500]}"))
    db.commit()
    return corrected_sub
