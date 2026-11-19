import itertools
from copy import deepcopy
from datetime import timedelta

import pytest

from app.fhir.builder import build_bundle
from app.fhir.precheck import check_bundle
from app.models import Submission, utcnow
from app.services.notes import ApprovalError, approve_and_queue, make_snapshot, requeue


def test_bundle_matches_proven_sandbox_shape(visit_with_note, settings):
    counter = itertools.count()
    snap = make_snapshot(visit_with_note, visit_with_note.note, visit_with_note.ended_at)
    b = build_bundle(snap, settings.satusehat_org_id,
                     new_uuid=lambda: f"00000000-0000-0000-0000-{next(counter):012d}")
    types = [e["resource"]["resourceType"] for e in b["entry"]]
    assert types == ["Encounter", "Condition", "Observation", "Observation",
                     "ClinicalImpression", "MedicationRequest"]
    enc = b["entry"][0]["resource"]
    assert enc["status"] == "finished"
    assert [h["status"] for h in enc["statusHistory"]] == ["arrived", "in-progress", "finished"]
    assert enc["serviceType"]["coding"][0]["code"] == "394814009"  # General practice
    assert enc["identifier"][0]["value"] == "ANAK-20261028-001"
    assert enc["diagnosis"][0]["rank"] == 1
    assert enc["diagnosis"][0]["condition"]["reference"] == b["entry"][1]["fullUrl"]
    assert enc["subject"]["reference"] == "Patient/P02478375538"
    cond = b["entry"][1]["resource"]
    assert cond["code"]["coding"][0] == {"system": "http://hl7.org/fhir/sid/icd-10", "code": "A90",
                                         "display": "Dengue fever [classical dengue]"}
    assert "stage" not in cond  # tidak melingkar ke ClinicalImpression
    ci = b["entry"][4]["resource"]
    assert ci["problem"][0]["reference"] == b["entry"][1]["fullUrl"]
    assert len(ci["investigation"][0]["item"]) == 2
    mr = b["entry"][5]["resource"]
    assert mr["contained"][0]["code"]["coding"][0]["code"] == "93001926"
    assert mr["dosageInstruction"][0]["timing"]["repeat"] == {"frequency": 1, "period": 4.0,
                                                              "periodUnit": "h", "periodMax": 6.0}
    assert mr["reasonReference"][0]["reference"] == b["entry"][1]["fullUrl"]
    assert check_bundle(b) == []
    for e in b["entry"]:
        if e["resource"]["resourceType"] != "Encounter":
            assert e["resource"].get("encounter", e["resource"].get("context"))["reference"] == b["entry"][0]["fullUrl"]


def test_precheck_blocks_missing_ihs_and_diagnosis(db, visit_with_note, doctor, settings):
    visit_with_note.patient.ihs_number = None
    visit_with_note.note.diagnoses = []
    with pytest.raises(ApprovalError) as e:
        approve_and_queue(db, visit_with_note, doctor, settings)
    assert any("IHS" in m for m in e.value.errors)
    assert any("diagnosis" in m for m in e.value.errors)
    assert db.query(Submission).count() == 0


def test_only_doctor_can_approve(db, visit_with_note, settings):
    from app.models import User
    admin = db.query(User).filter_by(role="admin").one()
    with pytest.raises(ApprovalError):
        approve_and_queue(db, visit_with_note, admin, settings)


def test_approve_freezes_snapshot_and_queues(db, visit_with_note, doctor, settings):
    sub = approve_and_queue(db, visit_with_note, doctor, settings)
    assert sub.status == "QUEUED"
    assert visit_with_note.note.approved_snapshot["diagnoses"][0]["code"] == "A90"
    with pytest.raises(ApprovalError):  # tidak bisa disetujui dua kali
        approve_and_queue(db, visit_with_note, doctor, settings)


def test_future_schedule_uses_actual_clinical_time(db, visit_with_note, doctor, settings):
    now = utcnow()
    visit_with_note.arrived_at = now + timedelta(days=1)
    visit_with_note.started_at = now - timedelta(minutes=15)
    visit_with_note.ended_at = now - timedelta(minutes=1)
    sub = approve_and_queue(db, visit_with_note, doctor, settings)
    encounter = sub.bundle["entry"][0]["resource"]
    assert encounter["period"]["start"] == visit_with_note.started_at.replace(microsecond=0).isoformat()
    assert encounter["period"]["end"] <= utcnow().isoformat()
    assert visit_with_note.note.approved_snapshot["visit"]["scheduled_at"] == visit_with_note.arrived_at.isoformat()


def test_requeue_repairs_rejected_future_encounter(db, visit_with_note, doctor, settings):
    now = utcnow()
    visit_with_note.arrived_at = now + timedelta(days=1)
    visit_with_note.started_at = now - timedelta(minutes=15)
    visit_with_note.ended_at = now - timedelta(minutes=1)
    sub = approve_and_queue(db, visit_with_note, doctor, settings)
    original = deepcopy(visit_with_note.note.approved_snapshot)
    original["visit"]["arrived_at"] = original["visit"]["scheduled_at"]
    visit_with_note.note.approved_snapshot = original
    sub.bundle = build_bundle(original, settings.satusehat_org_id)
    sub.status = "NEEDS_ATTENTION"
    sub.last_error_text = "Invalid date time value: Future Date [Encounter.period.start]"
    db.commit()
    requeue(db, sub, doctor)
    assert sub.status == "QUEUED"
    assert sub.bundle["entry"][0]["resource"]["period"]["start"] == visit_with_note.started_at.replace(microsecond=0).isoformat()
    assert visit_with_note.note.approved_snapshot["visit"]["arrived_at"] == original["visit"]["arrived_at"]
