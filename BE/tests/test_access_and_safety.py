import pytest
from fastapi import HTTPException
from starlette.requests import Request
from sqlalchemy import func, select

from app.main import (_reject_duplicate_nik, _sign, abandon_recording, current_user, recording_recovery,
                      require, resume_recording, set_consent, settings)
from app.models import ConsentHistory, Patient, ScribeSession
from app.services.notes import ApprovalError, approve_and_queue, correct_identity_and_queue, requeue


def test_role_matrix_blocks_cross_role_actions(doctor, medical_records_user):
    clinical = require("dokter")
    registration = require("admin", "perawat")
    assert clinical(doctor) is doctor
    assert registration(medical_records_user) is medical_records_user
    with pytest.raises(HTTPException) as clinical_denied:
        clinical(medical_records_user)
    assert clinical_denied.value.status_code == 403
    with pytest.raises(HTTPException) as registration_denied:
        registration(doctor)
    assert registration_denied.value.status_code == 403


def test_session_token_has_expiry(db, doctor):
    now = int(__import__("time").time())
    valid = _sign(doctor.id, now)
    request = Request({"type": "http", "method": "GET", "path": "/api/me",
                       "headers": [(b"x-session-token", valid.encode())]})
    assert current_user(request, db).id == doctor.id

    expired = _sign(doctor.id, now - settings.session_ttl_minutes * 60 - 1)
    request = Request({"type": "http", "method": "GET", "path": "/api/me",
                       "headers": [(b"x-session-token", expired.encode())]})
    with pytest.raises(HTTPException) as denied:
        current_user(request, db)
    assert denied.value.status_code == 401


def test_consent_is_strict_and_keeps_history(db, doctor, visit_with_note):
    with pytest.raises(HTTPException) as invalid:
        set_consent(visit_with_note.id, "mungkin", None, None, doctor, db)
    assert invalid.value.status_code == 422
    accepted = set_consent(visit_with_note.id, "setuju", "Siti", "ibu", doctor, db)
    assert accepted["decision"] == "setuju"
    refused = set_consent(visit_with_note.id, "tolak", "Siti", "ibu", doctor, db)
    assert refused["decision"] == "tolak"

    db.expire_all()
    assert visit_with_note.consent.decision == "tolak"
    assert visit_with_note.consent.given_by_name == "Siti"
    assert db.scalar(select(func.count(ConsentHistory.id)).where(
        ConsentHistory.visit_id == visit_with_note.id)) == 2


def test_duplicate_nik_rejected_on_create_and_edit(db):
    patients = list(db.scalars(select(Patient).order_by(Patient.id).limit(2)))
    patients[0].nik = "3173010101010001"
    db.commit()
    with pytest.raises(HTTPException) as create:
        _reject_duplicate_nik(db, patients[0].nik)
    assert create.value.status_code == 409
    with pytest.raises(HTTPException) as edit:
        _reject_duplicate_nik(db, patients[0].nik, patients[1].id)
    assert edit.value.status_code == 409


def test_identity_correction_creates_audited_submission_revision(
        db, visit_with_note, doctor, medical_records_user, settings):
    original = approve_and_queue(db, visit_with_note, doctor, settings)
    original.status = "NEEDS_ATTENTION"
    original.last_error_code = "invalid"
    original.last_error_text = "Patient IHS tidak ditemukan untuk identitas pasien"
    visit_with_note.patient.ihs_number = "P09999999999"
    db.commit()

    corrected = correct_identity_and_queue(db, original, medical_records_user, settings,
                                           "IHS pasien diperbarui setelah verifikasi NIK")
    assert original.status == "SUPERSEDED"
    assert corrected.supersedes_id == original.id
    assert corrected.revision == 2
    assert corrected.snapshot["patient"]["ihs_number"] == "P09999999999"
    assert corrected.bundle != original.bundle
    with pytest.raises(ApprovalError):
        correct_identity_and_queue(db, original, medical_records_user, settings, "ulang")


def test_same_bundle_retry_rejects_identity_error(db, visit_with_note, doctor, medical_records_user, settings):
    sub = approve_and_queue(db, visit_with_note, doctor, settings)
    sub.status = "NEEDS_ATTENTION"
    sub.last_error_text = "NIK atau IHS pasien tidak valid"
    db.commit()
    with pytest.raises(ApprovalError, match="bundle koreksi"):
        requeue(db, sub, medical_records_user)


def test_interrupted_recording_can_resume_or_be_closed(db, doctor, visit_with_note, tmp_path):
    audio = tmp_path / "partial.webm"
    audio.write_bytes(b"partial audio")
    session = ScribeSession(visit_id=visit_with_note.id, audio_path=str(audio), status="recording",
                            next_chunk_seq=3)
    db.add(session)
    db.commit()
    recovery = recording_recovery(visit_with_note.id, doctor, db)
    assert recovery["session"]["next_seq"] == 3
    resumed = resume_recording(visit_with_note.id, session.id, doctor, db)
    assert resumed["next_seq"] == 3
    abandoned = abandon_recording(visit_with_note.id, session.id, doctor, db)
    assert abandoned["status"] == "ok"
    assert not audio.exists()
    db.refresh(session)
    assert session.status == "abandoned"
