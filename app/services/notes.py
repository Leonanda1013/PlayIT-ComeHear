"""Persetujuan dokter -> snapshot beku -> bundle -> antrean kirim."""
import hashlib
import json

from sqlalchemy.orm import Session

from app.config import Settings
from app.fhir.builder import build_bundle
from app.fhir.precheck import check_bundle, check_snapshot
from app.models import AuditLog, ClinicalNote, Submission, User, Visit, as_utc, utcnow


def _iso(dt) -> str | None:
    return as_utc(dt).isoformat() if dt else None


def make_snapshot(visit: Visit, note: ClinicalNote, approved_at) -> dict:
    return {
        "visit": {"code": visit.code, "arrived_at": _iso(visit.arrived_at),
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
    sub = Submission(visit_id=visit.id, idempotency_key=key, bundle=bundle, status="QUEUED", next_attempt_at=now)
    db.add(sub)
    db.add(AuditLog(user_id=user.id, action="approve", obj=f"visit:{visit.id}",
                    summary=f"{len(bundle['entry'])} resource diantrekan"))
    db.commit()
    return sub


def requeue(db: Session, sub: Submission, user: User) -> None:
    """Kirim ulang manual setelah staf memperbaiki data master (bundle tetap sama)."""
    sub.status, sub.next_attempt_at = "QUEUED", utcnow()
    db.add(AuditLog(user_id=user.id, action="requeue", obj=f"submission:{sub.id}"))
    db.commit()
