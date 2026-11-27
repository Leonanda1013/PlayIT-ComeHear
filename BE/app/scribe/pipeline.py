"""Pipeline ujung ke ujung: audio/teks -> transkrip -> S (+ label pembicara) -> ICD-10 -> draf catatan.

Arsitektur non-blocking:
1. ASR (CPU-bound) berjalan di `asr_executor` terpisah dari `llm_pool` (I/O-bound) agar antrean
   LLM satu dokter tidak menghambat transkripsi dokter lain.
2. Segera setelah `extracting` selesai, hasil S tersimpan (`subjective_ready=True`) dan dikirim
   lewat event SSE sebelum `coding` (ICD-10) selesai.
3. Proteksi anti-overwrite: jika dokter sudah mengisi/menyunting Subjektif secara manual selama
   pemrosesan berjalan, hasil AI tetap disimpan di `ScribeSession.extraction` tanpa menimpa
   `ClinicalNote` milik dokter.
4. Recovery startup memulihkan sesi yang terhenti bila server restart di tengah proses.
"""
import asyncio
import json
import logging
import threading
import time
from concurrent.futures import Future, ThreadPoolExecutor
from datetime import datetime
from pathlib import Path
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import Settings
from app.models import AuditLog, ClinicalNote, ScribeSession, Visit, as_utc, utcnow
from app.scribe import asr
from app.scribe.extract import extract_subjective, icd_keywords, icd_pick, suggest_icd
from app.scribe.icd import icd_table
from app.scribe.llm import LLM
from app.scribe.mock_llm import mock_generate
from app.scribe.schemas import SUBJECTIVE_FIELDS

log = logging.getLogger("comehear.pipeline")

# ASR (CPU berat) terpisah dari panggilan LLM (I/O jaringan paralel).
asr_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="scribe-asr")
executor = asr_executor  # kompatibilitas nama lama
llm_pool = ThreadPoolExecutor(max_workers=6, thread_name_prefix="scribe-llm")

_live_jobs: dict[int, Future] = {}
_jobs_lock = threading.Lock()
_active_job_ids: dict[int, str] = {}

_sub_lock = threading.Lock()
_subscribers: dict[int, set[tuple[asyncio.AbstractEventLoop, asyncio.Queue]]] = {}


class Replaced(Exception):
    """Sesi diganti rekaman ulang di tengah jalan: berhenti tanpa menyentuh catatan."""


def subscribe(visit_id: int, loop: asyncio.AbstractEventLoop) -> asyncio.Queue:
    q: asyncio.Queue = asyncio.Queue(maxsize=32)
    with _sub_lock:
        _subscribers.setdefault(visit_id, set()).add((loop, q))
    return q


def unsubscribe(visit_id: int, loop: asyncio.AbstractEventLoop, q: asyncio.Queue) -> None:
    with _sub_lock:
        subs = _subscribers.get(visit_id)
        if subs:
            subs.discard((loop, q))
            if not subs:
                _subscribers.pop(visit_id, None)


def _push_to_queue(q: asyncio.Queue, event: dict) -> None:
    if q.full():
        try:
            q.get_nowait()
        except asyncio.QueueEmpty:
            pass
    try:
        q.put_nowait(event)
    except asyncio.QueueFull:
        pass


def notify_visit(visit_id: int, event: dict) -> None:
    with _sub_lock:
        targets = list(_subscribers.get(visit_id, ()))
    for loop, q in targets:
        try:
            if not loop.is_closed():
                loop.call_soon_threadsafe(_push_to_queue, q, event)
        except RuntimeError:
            pass


def build_scribe_snapshot(visit: Visit, ss: ScribeSession | None, failed: ScribeSession | None) -> dict:
    info = (ss.model_info or {}) if ss else {}
    note = visit.note
    extra = (note.extra or {}) if note else {}
    icd_data = (
        ss.icd_suggestions
        if (ss and ss.icd_suggestions)
        else (extra.get("icd_suggestions") if extra else None)
    )
    return {
        "status": ss.status if ss else ("failed" if failed else None),
        "error": failed.error if failed and not ss else (ss.error if ss and ss.status == "failed" else None),
        "job_id": ss.job_id if ss else (failed.job_id if failed else None),
        "n_segments": len(ss.transcript or []) if ss else 0,
        "transcript": ss.transcript or [] if ss else [],
        "extraction": ss.extraction if ss else None,
        "subjective_ready": bool(ss and ss.extraction),
        "icd_ready": bool(icd_data),
        "applied_to_note": info.get("applied_to_note", True) if ss else True,
        "manual_conflict": bool(info.get("manual_conflict")) if ss else False,
        "summary": note.subjective_summary if note and ss and ss.extraction else None,
        "fields": dict(note.subjective or {}) if note and ss and ss.extraction else None,
        "duration_s": info.get("duration_s") if ss else None,
        "icd": icd_data if (ss and ss.status == "done" and ss.icd_suggestions) or extra.get("icd_suggestions") else None,
    }


def _emit_from_db(db: Session, visit_id: int) -> None:
    visit = db.get(Visit, visit_id)
    if not visit:
        return
    ss = next((s for s in reversed(visit.scribe_sessions) if s.status not in ("failed", "replaced", "abandoned")), None)
    last = visit.latest_session
    failed = last if last and last.status == "failed" else None
    notify_visit(visit_id, build_scribe_snapshot(visit, ss, failed))


def _live_state(ss: ScribeSession) -> dict:
    return dict((ss.model_info or {}).get("live") or {"offset": 0.0, "asr_s": 0.0})


def _asr_step(ss: ScribeSession, settings: Settings, final: bool) -> None:
    state = _live_state(ss)
    t = time.perf_counter()
    segments, state["offset"], duration = asr.transcribe_incremental(
        ss.audio_path, settings, list(ss.transcript or []), state["offset"], final
    )
    state["asr_s"] = round(state["asr_s"] + time.perf_counter() - t, 1)
    ss.transcript = segments
    ss.model_info = {
        **(ss.model_info or {}),
        "live": state,
        "asr_model": settings.asr_model,
        "duration_s": round(duration, 1),
    }


def live_asr(session_factory, session_id: int, settings: Settings) -> None:
    """Satu putaran ASR bertahap selama rekaman masih berjalan."""
    with session_factory() as db:
        ss = db.get(ScribeSession, session_id)
        if ss is None or ss.status != "recording":
            return
        try:
            _asr_step(ss, settings, final=False)
            ss.heartbeat_at = utcnow()
            db.commit()
            _emit_from_db(db, ss.visit_id)
        except Exception:
            log.exception("ASR bertahap sesi %s gagal; akan dicoba lagi saat potongan berikutnya", session_id)
            db.rollback()


def submit_live(session_factory, session_id: int, settings: Settings) -> None:
    job = _live_jobs.get(session_id)
    if job is None or job.done():  # jangan menumpuk antrean bila ASR belum mengejar
        _live_jobs[session_id] = asr_executor.submit(live_asr, session_factory, session_id, settings)


def _should_apply_ai_to_note(note: ClinicalNote | None, ss: ScribeSession) -> bool:
    """Lindungi isian manual dokter dan catatan tervalidasi agar tidak tertimpa hasil AI yang selesai belakangan."""
    if note is None:
        return True
    if note.approved_snapshot:
        return False
    extra = note.extra or {}
    edited_raw = extra.get("subjective_edited_at")
    if edited_raw:
        try:
            edited_at = as_utc(datetime.fromisoformat(str(edited_raw)))
        except ValueError:
            edited_at = None
        session_start = as_utc(ss.created_at)
        if edited_at is not None and (session_start is None or edited_at >= session_start):
            return False
    return True


def apply_session_extraction(db: Session, ss: ScribeSession, note: ClinicalNote) -> bool:
    """Terapkan hasil ekstraksi sesi ke ClinicalNote (dipakai otomatis bila aman, atau eksplisit oleh dokter)."""
    if note.approved_snapshot or not ss.extraction:
        return False
    subjective = ss.extraction
    note.subjective = {k: (subjective.get(k) or {}).get("nilai") or "" for k in SUBJECTIVE_FIELDS}
    note.subjective_summary = subjective.get("rangkuman_s") or ""
    note.allergies = subjective.get("alergi_terstruktur") or []
    extra = dict(note.extra or {})
    extra["subjective_applied_session_id"] = ss.id
    extra["subjective_source"] = "ai"
    note.extra = extra
    ss.model_info = {**(ss.model_info or {}), "applied_to_note": True, "manual_conflict": False}
    db.add(note)
    return True


def _mark_failed(session_factory, session_id: int, timings: dict, llm: LLM, exc: Exception) -> None:
    with session_factory() as db:
        db.rollback()
        ss = db.get(ScribeSession, session_id)
        if ss is None:
            return
        if ss.status != "replaced":
            ss.status = "failed"
            ss.error = str(exc)[:2000]
            ss.timings = timings
            ss.heartbeat_at = utcnow()
            ss.model_info = {**(ss.model_info or {}), "llm_usage": llm.usage_report()}
        if ss.status != "replaced" and ss.visit and ss.visit.status == "processing":
            ss.visit.status = "consented"
        db.commit()
        _emit_from_db(db, ss.visit_id)


def _run_asr_stage(
    session_factory,
    session_id: int,
    settings: Settings,
    text_transcript: str | None = None,
) -> tuple[bool, dict, dict]:
    timings: dict = {}
    models: dict = {}
    with session_factory() as db:
        ss = db.get(ScribeSession, session_id)
        if ss is None:
            return False, timings, models

        def step(name: str) -> float:
            db.refresh(ss, ["status"])
            if ss.status == "replaced":
                raise Replaced()
            ss.status = name
            ss.started_at = ss.started_at or utcnow()
            ss.heartbeat_at = utcnow()
            db.commit()
            _emit_from_db(db, ss.visit_id)
            return time.perf_counter()

        try:
            t = step("transcribing")
            if text_transcript:
                segments = asr.parse_text_transcript(text_transcript)
                models["asr_model"] = "teks"
            elif ss.model_info and ss.model_info.get("live"):
                timings["asr_live_s"] = ss.model_info["live"]["asr_s"]
                if settings.final_asr_model != settings.asr_model:
                    t = step("refining")
                    segments, info = asr.transcribe(ss.audio_path, settings, model=settings.final_asr_model)
                    models.update(info)
                    models["asr_live_model"] = settings.asr_model
                    timings["asr_refine_s"] = round(time.perf_counter() - t, 1)
                    ss.transcript = segments
                    ss.heartbeat_at = utcnow()
                    db.commit()
                else:
                    _asr_step(ss, settings, final=True)
                    segments = ss.transcript
                    models.update({k: v for k, v in ss.model_info.items() if k != "live"})
            elif (not ss.audio_path or ss.audio_deleted_at) and ss.transcript:
                segments = list(ss.transcript)
                models["asr_model"] = (ss.model_info or {}).get("asr_model") or "teks"
            else:
                segments, info = asr.transcribe(ss.audio_path, settings, model=settings.final_asr_model)
                models.update(info)

            timings["asr_s"] = round(time.perf_counter() - t, 1)
            if not segments:
                raise RuntimeError("Transkrip kosong: periksa mikrofon atau berkas audio.")
            segments = [dict(s) for s in segments]
            ss.transcript = [dict(segment) for segment in segments]
            ss.timings = timings
            ss.model_info = {**(ss.model_info or {}), **models}
            ss.heartbeat_at = utcnow()
            db.commit()
            return True, timings, models
        except Replaced:
            log.info("sesi scribe %s diganti rekaman ulang; hasil ASR dibuang", session_id)
            db.rollback()
            return False, timings, models
        except Exception as exc:
            log.exception("tahap ASR sesi scribe %s gagal", session_id)
            db.rollback()
            ss = db.get(ScribeSession, session_id)
            if ss is not None:
                if ss.status != "replaced":
                    ss.status, ss.error, ss.timings = "failed", str(exc)[:2000], timings
                    ss.heartbeat_at = utcnow()
                if ss.status != "replaced" and ss.visit and ss.visit.status == "processing":
                    ss.visit.status = "consented"
                db.commit()
                _emit_from_db(db, ss.visit_id)
            return False, timings, models


def _run_llm_stage(
    session_factory,
    session_id: int,
    settings: Settings,
    timings: dict | None = None,
    models: dict | None = None,
) -> None:
    llm = LLM(settings, mock=mock_generate)
    timings = dict(timings or {})
    models = dict(models or {})
    with session_factory() as db:
        ss = db.get(ScribeSession, session_id)
        if ss is None:
            return

        def step(name: str) -> float:
            db.refresh(ss, ["status"])
            if ss.status == "replaced":
                raise Replaced()
            ss.status = name
            ss.heartbeat_at = utcnow()
            db.commit()
            _emit_from_db(db, ss.visit_id)
            return time.perf_counter()

        try:
            t = step("extracting")
            segments = [dict(s) for s in (ss.transcript or [])]
            visit = ss.visit
            patient = visit.patient if visit else None
            practitioner = visit.practitioner if visit else None

            subjective, models["extract_llm"] = extract_subjective(
                segments,
                llm,
                nama_pasien=patient.name if patient else None,
                nama_dokter=practitioner.name if practitioner else None,
                alamat_pasien=patient.address if patient else None,
            )
            ss.transcript = segments
            ss.extraction = subjective
            timings["extract_s"] = round(time.perf_counter() - t, 1)

            db.refresh(ss, ["status"])
            if ss.status == "replaced":
                raise Replaced()

            # Baca ulang catatan terbaru sebelum menulis agar tidak menimpa edit manual yang masuk saat LLM bekerja.
            db.refresh(visit, ["note"])
            note = visit.note or ClinicalNote(visit_id=visit.id)
            if _should_apply_ai_to_note(note, ss):
                apply_session_extraction(db, ss, note)
            else:
                ss.model_info = {
                    **(ss.model_info or {}),
                    "applied_to_note": False,
                    "manual_conflict": True,
                }
            if visit.status == "processing":
                visit.status = "draft"

            t = step("coding")  # S sudah siap & notifikasi terkirim; ICD menyusul di background

            keywords = subjective.get("kata_kunci_icd10_en") or icd_keywords(subjective.get("rangkuman_s") or "", llm)
            icd, models["icd"] = icd_pick(subjective, keywords, icd_table(settings), llm)
            ss.icd_suggestions = icd
            timings["icd_s"] = round(time.perf_counter() - t, 1)

            ss.status, ss.finished_at, ss.heartbeat_at = "done", utcnow(), utcnow()
            timings["total_s"] = round(sum(v for k, v in timings.items() if k in ("asr_s", "extract_s", "icd_s")), 1)
            ss.timings = timings
            ss.model_info = {**(ss.model_info or {}), **models, "llm_usage": llm.usage_report()}
            db.add(AuditLog(action="scribe_done", obj=f"visit:{visit.id}", summary=str(timings)))
            db.commit()
            _emit_from_db(db, visit.id)
        except Replaced:
            log.info("sesi scribe %s diganti rekaman ulang; hasil dibuang", session_id)
            db.rollback()
        except Exception as exc:
            log.exception("sesi scribe %s gagal", session_id)
            _mark_failed(session_factory, session_id, timings, llm, exc)


def run_session(session_factory, session_id: int, settings: Settings, text_transcript: str | None = None):
    """Jalankan tahap ASR + LLM secara berurutan (dipakai pemanggil sinkron dan unit test)."""
    ok, timings, models = _run_asr_stage(session_factory, session_id, settings, text_transcript=text_transcript)
    if ok:
        _run_llm_stage(session_factory, session_id, settings, timings=timings, models=models)


def _asr_then_handoff_llm(session_factory, session_id: int, settings: Settings, text_transcript: str | None = None):
    ok, timings, models = _run_asr_stage(session_factory, session_id, settings, text_transcript=text_transcript)
    if ok:
        def _finish_llm():
            try:
                _run_llm_stage(session_factory, session_id, settings, timings=timings, models=models)
            finally:
                with _jobs_lock:
                    _active_job_ids.pop(session_id, None)

        llm_pool.submit(_finish_llm)
    else:
        with _jobs_lock:
            _active_job_ids.pop(session_id, None)


def submit(session_factory, session_id: int, settings: Settings, text_transcript: str | None = None):
    """Antrekan sesi scribe non-blocking; cegah pengiriman ganda untuk job_id yang sama."""
    with session_factory() as db:
        ss = db.get(ScribeSession, session_id)
        if ss is None:
            return None
        if not ss.job_id:
            ss.job_id = str(uuid4())
            db.commit()
        job_id = ss.job_id

    with _jobs_lock:
        if _active_job_ids.get(session_id) == job_id:
            return None
        _active_job_ids[session_id] = job_id

    if text_transcript:
        # Teks tidak butuh CPU Whisper; cukup parsing cepat lalu langsung antrekan ke pool LLM.
        def _text_job():
            try:
                ok, timings, models = _run_asr_stage(session_factory, session_id, settings, text_transcript=text_transcript)
                if ok:
                    _run_llm_stage(session_factory, session_id, settings, timings=timings, models=models)
            finally:
                with _jobs_lock:
                    _active_job_ids.pop(session_id, None)

        return llm_pool.submit(_text_job)

    return asr_executor.submit(_asr_then_handoff_llm, session_factory, session_id, settings, None)


def recover_stale_sessions(session_factory, settings: Settings) -> int:
    """Pulihkan sesi pemrosesan yang terputus akibat server restart."""
    recovered = 0
    with session_factory() as db:
        stale = db.scalars(
            select(ScribeSession).where(
                ScribeSession.status.in_(["queued", "transcribing", "refining", "extracting", "coding"])
            )
        ).all()
        for ss in stale:
            if ss.status == "coding" and ss.extraction:
                ss.status = "done"
                ss.finished_at = ss.finished_at or utcnow()
                ss.heartbeat_at = utcnow()
                db.commit()
                submit_suggest_icd(session_factory, ss.visit_id, settings)
                recovered += 1
                continue

            has_audio = bool(ss.audio_path and not ss.audio_deleted_at and Path(ss.audio_path).exists())
            has_text = bool(ss.transcript and any((s.get("text") or "").strip() for s in ss.transcript))
            if has_audio:
                ss.status = "queued"
                ss.job_id = str(uuid4())
                ss.heartbeat_at = utcnow()
                db.commit()
                submit(session_factory, ss.id, settings)
                recovered += 1
            elif has_text:
                text = "\n".join(s["text"] for s in ss.transcript if s.get("text"))
                ss.status = "queued"
                ss.job_id = str(uuid4())
                ss.heartbeat_at = utcnow()
                db.commit()
                submit(session_factory, ss.id, settings, text_transcript=text)
                recovered += 1
            else:
                ss.status = "failed"
                ss.error = "Pemrosesan terhenti saat server dimulai ulang. Silakan rekam ulang atau isi manual."
                ss.heartbeat_at = utcnow()
                if ss.visit and ss.visit.status == "processing":
                    ss.visit.status = "consented"
                db.commit()
    return recovered


def run_suggest_icd(
    session_factory,
    visit_id: int,
    settings: Settings,
    subjective: dict | None = None,
    objective: dict | str | None = None,
):
    llm = LLM(settings, mock=mock_generate)
    with session_factory() as db:
        visit = db.get(Visit, visit_id)
        if not visit:
            return
        note = visit.note
        subj = subjective
        if not subj and note:
            subj = dict(note.subjective or {})
            if note.subjective_summary:
                subj["rangkuman_s"] = note.subjective_summary

        if not subj or not any(str(v).strip() for v in subj.values() if v is not None):
            return

        obj = objective
        if obj is None and note:
            obj = note.exam_text or (note.extra.get("objektif") if note.extra else None)

        try:
            icd, models = suggest_icd(subj, icd_table(settings), llm, objective=obj)
            if not icd or not isinstance(icd, dict) or not icd.get("utama"):
                log.warning("Hasil usulan ICD kosong; pertahankan usulan sebelumnya untuk kunjungan %s.", visit_id)
                return

            ss = next(
                (s for s in reversed(visit.scribe_sessions) if s.status not in ("failed", "replaced", "abandoned")),
                None,
            )
            if ss:
                ss.icd_suggestions = icd
                ss.model_info = {**(ss.model_info or {}), **models}
            else:
                ss = ScribeSession(visit_id=visit.id, status="done", icd_suggestions=icd, model_info=models)
                db.add(ss)

            if note:
                extra = dict(note.extra or {})
                extra["icd_suggestions"] = icd
                note.extra = extra

            db.commit()
            _emit_from_db(db, visit_id)
            log.info("Rekomendasi ICD-10 background kunjungan %s selesai.", visit_id)
        except Exception:
            log.exception("Gagal menyusun usulan ICD-10 background untuk kunjungan %s", visit_id)
            db.rollback()
        finally:
            # Append satu record per job, termasuk hasil kosong/gagal. JSON pada
            # sesi bersama bisa saling menimpa bila dua job ICD selesai bersamaan.
            db.add(
                AuditLog(
                    action="llm_usage_icd",
                    obj=f"visit:{visit_id}",
                    summary=json.dumps(
                        {
                            "job_id": str(uuid4()),
                            "usage": llm.usage_report(),
                        }
                    ),
                )
            )
            db.commit()


def submit_suggest_icd(
    session_factory,
    visit_id: int,
    settings: Settings,
    subjective: dict | None = None,
    objective: dict | str | None = None,
):
    return llm_pool.submit(
        run_suggest_icd, session_factory, visit_id, settings, subjective, objective
    )


def warm_up(settings: Settings) -> None:
    """Muat model ASR saat server menyala, bukan saat rekaman pertama (±13 detik)."""
    if settings.asr_model:
        asr_executor.submit(asr.get_model, settings)
        if settings.final_asr_model != settings.asr_model:
            asr_executor.submit(asr.get_model, settings, settings.final_asr_model)
