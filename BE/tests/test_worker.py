from datetime import timedelta

from app.models import Submission, utcnow
from app.satusehat.client import MockSatusehat
from app.services.notes import approve_and_queue
from app.sync.worker import run_once


def _queue(db, visit, doctor, settings):
    return approve_and_queue(db, visit, doctor, settings).id


def _force_due(sf, sid):
    with sf() as db:
        s = db.get(Submission, sid)
        s.next_attempt_at = utcnow() - timedelta(seconds=1)
        db.commit()


def test_happy_path_maps_ids(session_factory, db, visit_with_note, doctor, settings):
    sid = _queue(db, visit_with_note, doctor, settings)
    client = MockSatusehat()
    assert run_once(session_factory, client, settings) == 1
    with session_factory() as s:
        sub = s.get(Submission, sid)
        assert sub.status == "SENT"
        assert len(sub.resources) == 6
        assert all(r.resource_id for r in sub.resources)
        assert sub.visit.satusehat_encounter_id == sub.resources[0].resource_id


def test_timeout_then_retry_succeeds(session_factory, db, visit_with_note, doctor, settings):
    sid = _queue(db, visit_with_note, doctor, settings)
    client = MockSatusehat(fail_queue=["timeout"])
    run_once(session_factory, client, settings)
    with session_factory() as s:
        sub = s.get(Submission, sid)
        assert sub.status == "RETRY_WAIT" and sub.attempts == 1
    assert run_once(session_factory, client, settings) == 0  # belum jatuh tempo
    _force_due(session_factory, sid)
    run_once(session_factory, client, settings)
    with session_factory() as s:
        assert s.get(Submission, sid).status == "SENT"


def test_lost_response_is_reconciled_without_duplicate(session_factory, db, visit_with_note, doctor, settings):
    sid = _queue(db, visit_with_note, doctor, settings)
    client = MockSatusehat(fail_queue=["lost_response"])
    run_once(session_factory, client, settings)  # server menyimpan, respons hilang
    _force_due(session_factory, sid)
    run_once(session_factory, client, settings)  # kirim ulang -> 20002 -> rekonsiliasi
    with session_factory() as s:
        sub = s.get(Submission, sid)
        assert sub.status == "SENT"
        assert sub.visit.satusehat_encounter_id == client.encounters["ANAK-20261028-001"]
    assert len(client.encounters) == 1


def test_bad_reference_needs_attention(session_factory, db, visit_with_note, doctor, settings):
    sid = _queue(db, visit_with_note, doctor, settings)
    with session_factory() as s:
        sub = s.get(Submission, sid)
        bundle = dict(sub.bundle)
        bundle["entry"] = [dict(e) for e in bundle["entry"]]
        bundle["entry"][1] = {**bundle["entry"][1], "fullUrl": "urn:uuid:ganti"}
        sub.bundle = bundle
        s.commit()
    run_once(session_factory, MockSatusehat(), settings)
    with session_factory() as s:
        sub = s.get(Submission, sid)
        assert sub.status == "NEEDS_ATTENTION"
        assert "reference_not_found" in sub.last_error_text


def test_gives_up_after_max_attempts(session_factory, db, visit_with_note, doctor, settings):
    sid = _queue(db, visit_with_note, doctor, settings)
    client = MockSatusehat(fail_queue=["500"] * 20)
    for _ in range(settings.max_send_attempts):
        _force_due(session_factory, sid)
        run_once(session_factory, client, settings)
    with session_factory() as s:
        assert s.get(Submission, sid).status == "NEEDS_ATTENTION"
