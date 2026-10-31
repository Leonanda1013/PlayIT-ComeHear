"""Worker pengiriman (outbox) ke SATUSEHAT.

QUEUED -> SENDING -> SENT
                  -> RETRY_WAIT      (timeout, 5xx, 429)      -> SENDING lagi
                  -> NEEDS_ATTENTION (400 validasi/rujukan)  -> staf memperbaiki
                  -> RECONCILING     (duplikat 20002)          -> cari Encounter -> SENT
Retry selalu mengirim bundle yang sama persis (urn:uuid disimpan di submission).
"""
import logging
import threading
from datetime import timedelta

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.config import Settings
from app.models import AuditLog, ResourceMap, Submission, as_utc, utcnow
from app.satusehat.client import TransientError, outcome_codes, parse_entry_ids

log = logging.getLogger("comehear.worker")

BACKOFF_MIN = [1, 5, 30, 60, 120]
DUPLICATE_CODES = {"20002", "20013", "duplicate"}  # sandbox: issue.code "duplicate"


def _schedule_retry(sub: Submission, settings: Settings, reason: str) -> None:
    sub.last_error_code, sub.last_error_text = "transient", reason
    if sub.attempts >= settings.max_send_attempts:
        sub.status = "NEEDS_ATTENTION"
        sub.last_error_text = f"Gagal {sub.attempts}x berturut-turut: {reason}"
        return
    delay = BACKOFF_MIN[min(sub.attempts - 1, len(BACKOFF_MIN) - 1)]
    sub.status = "RETRY_WAIT"
    sub.next_attempt_at = utcnow() + timedelta(minutes=delay)


def _mark_sent(db: Session, sub: Submission, ids: list[tuple[str | None, str | None]]) -> None:
    for i, entry in enumerate(sub.bundle["entry"]):
        rtype, rid = ids[i] if i < len(ids) else (None, None)
        db.add(ResourceMap(submission_id=sub.id, entry_index=i, full_url=entry["fullUrl"],
                           resource_type=rtype or entry["resource"]["resourceType"], resource_id=rid))
    sub.status, sub.sent_at = "SENT", utcnow()
    sub.last_error_code = sub.last_error_text = None
    sub.visit.satusehat_encounter_id = ids[0][1] if ids else sub.visit.satusehat_encounter_id
    db.add(AuditLog(action="satusehat_sent", obj=f"visit:{sub.visit_id}",
                    summary=f"submission {sub.id}, Encounter {sub.visit.satusehat_encounter_id}"))


def _reconcile(db: Session, sub: Submission, client, settings: Settings) -> None:
    sub.status = "RECONCILING"
    ident = sub.bundle["entry"][0]["resource"]["identifier"][0]
    try:
        enc_id = client.find_encounter(ident["system"], ident["value"])
    except TransientError as e:
        _schedule_retry(sub, settings, f"rekonsiliasi: {e}")
        return
    if enc_id:
        # Data sudah ada di SATUSEHAT (respons sebelumnya hilang). ID resource lain tidak
        # dikembalikan pencarian Encounter, jadi hanya Encounter yang dipetakan.
        _mark_sent(db, sub, [("Encounter", enc_id)])
        sub.last_error_text = "Direkonsiliasi: Encounter sudah ada; ID resource lain tidak diketahui."
    else:
        sub.status = "NEEDS_ATTENTION"
        sub.last_error_text = "Ditolak sebagai duplikat, tetapi Encounter tidak ditemukan lewat identifier."


def process_one(db: Session, sub: Submission, client, settings: Settings) -> None:
    sub.status, sub.attempts = "SENDING", sub.attempts + 1
    db.commit()
    try:
        result = client.post_bundle(sub.bundle)
    except TransientError as e:
        _schedule_retry(sub, settings, str(e))
        db.commit()
        return
    sub.response = result.body
    if result.status_code in (200, 201):
        _mark_sent(db, sub, parse_entry_ids(result.body))
    else:
        codes, text = outcome_codes(result.body)
        sub.last_error_code = ",".join(sorted(codes))[:40] or str(result.status_code)
        sub.last_error_text = text or f"HTTP {result.status_code}"
        if codes & DUPLICATE_CODES or "duplicate" in text.lower():
            _reconcile(db, sub, client, settings)
        else:
            sub.status = "NEEDS_ATTENTION"  # 400: validasi/rujukan, tidak diulang otomatis
    db.commit()


def due_submissions(db: Session) -> list[Submission]:
    now = utcnow()
    subs = db.scalars(select(Submission).where(
        Submission.status.in_(["QUEUED", "RETRY_WAIT"]),
        or_(Submission.next_attempt_at.is_(None), Submission.next_attempt_at <= now),
    ).order_by(Submission.id)).all()
    return [s for s in subs if (as_utc(s.next_attempt_at) or now) <= now]


def run_once(session_factory, client, settings: Settings) -> int:
    with session_factory() as db:
        subs = due_submissions(db)
        for sub in subs:
            try:
                process_one(db, sub, client, settings)
            except Exception as e:  # jangan biarkan satu submission mematikan worker
                log.exception("submission %s gagal diproses", sub.id)
                db.rollback()
                sub = db.get(Submission, sub.id)
                sub.status, sub.last_error_code, sub.last_error_text = "NEEDS_ATTENTION", "internal", str(e)
                db.commit()
        return len(subs)


class OutboxWorker:
    def __init__(self, session_factory, client, settings: Settings):
        self.sf, self.client, self.settings = session_factory, client, settings
        self._stop = threading.Event()
        self._wake = threading.Event()
        self.thread = threading.Thread(target=self._loop, name="outbox-worker", daemon=True)

    def start(self):
        self.thread.start()

    def stop(self):
        self._stop.set()
        self._wake.set()

    def nudge(self):
        self._wake.set()

    def _loop(self):
        while not self._stop.is_set():
            try:
                run_once(self.sf, self.client, self.settings)
            except Exception:
                log.exception("putaran worker gagal")
            self._wake.wait(self.settings.worker_interval_s)
            self._wake.clear()
