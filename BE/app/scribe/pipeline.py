"""Pipeline ujung ke ujung: audio/teks -> transkrip -> S (+ label pembicara) -> ICD-10 -> draf catatan.

Supaya dokter tidak menunggu:
1. ASR berjalan selama rekaman (`live_asr`): potongan audio dikirim tiap beberapa detik dan
   ditranskripsi bertahap, jadi saat tombol Selesai ditekan sisa ASR tinggal beberapa detik.
2. Label pembicara digabung ke panggilan ekstraksi S (satu putaran LLM, bukan dua).
3. Kata kunci ICD diambil dari hasil ekstraksi S; panggilan tambahan hanya jika hasilnya kosong.
4. Bagian S disimpan begitu jadi (status "coding"), sebelum usulan ICD selesai.
"""
import json
import logging
import time
from uuid import uuid4
from concurrent.futures import Future, ThreadPoolExecutor

from app.config import Settings
from app.models import AuditLog, ClinicalNote, ScribeSession, Visit, utcnow
from app.scribe import asr
from app.scribe.extract import extract_subjective, icd_keywords, icd_pick, suggest_icd
from app.scribe.icd import icd_table
from app.scribe.llm import LLM
from app.scribe.mock_llm import mock_generate
from app.scribe.schemas import SUBJECTIVE_FIELDS

log = logging.getLogger("comehear.pipeline")

# ASR (CPU berat) satu per satu agar urutan potongan terjaga; panggilan LLM (I/O) boleh paralel.
executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="scribe")
llm_pool = ThreadPoolExecutor(max_workers=4, thread_name_prefix="llm")
_live_jobs: dict[int, Future] = {}


class Replaced(Exception):
    """Sesi diganti rekaman ulang di tengah jalan: berhenti tanpa menyentuh catatan."""


def _live_state(ss: ScribeSession) -> dict:
    return dict((ss.model_info or {}).get("live") or {"offset": 0.0, "asr_s": 0.0})


def _asr_step(ss: ScribeSession, settings: Settings, final: bool) -> None:
    state = _live_state(ss)
    t = time.perf_counter()
    segments, state["offset"], duration = asr.transcribe_incremental(
        ss.audio_path, settings, list(ss.transcript or []), state["offset"], final)
    state["asr_s"] = round(state["asr_s"] + time.perf_counter() - t, 1)
    ss.transcript = segments
    ss.model_info = {**(ss.model_info or {}), "live": state, "asr_model": settings.asr_model,
                     "duration_s": round(duration, 1)}


def live_asr(session_factory, session_id: int, settings: Settings) -> None:
    """Satu putaran ASR bertahap selama rekaman masih berjalan."""
    with session_factory() as db:
        ss = db.get(ScribeSession, session_id)
        if ss is None or ss.status != "recording":
            return
        try:
            _asr_step(ss, settings, final=False)
            db.commit()
        except Exception:
            log.exception("ASR bertahap sesi %s gagal; akan dicoba lagi saat potongan berikutnya", session_id)
            db.rollback()


def submit_live(session_factory, session_id: int, settings: Settings) -> None:
    job = _live_jobs.get(session_id)
    if job is None or job.done():  # jangan menumpuk antrean bila ASR belum mengejar
        _live_jobs[session_id] = executor.submit(live_asr, session_factory, session_id, settings)


def run_session(session_factory, session_id: int, settings: Settings, text_transcript: str | None = None):
    llm = LLM(settings, mock=mock_generate)
    timings, models = {}, {}
    with session_factory() as db:
        ss = db.get(ScribeSession, session_id)

        def step(name: str):
            db.refresh(ss, ["status"])
            if ss.status == "replaced":
                raise Replaced()
            ss.status = name
            db.commit()
            return time.perf_counter()

        try:
            t = step("transcribing")
            if text_transcript:
                segments = asr.parse_text_transcript(text_transcript)
                models["asr_model"] = "teks"
            elif ss.model_info and ss.model_info.get("live"):
                timings["asr_live_s"] = ss.model_info["live"]["asr_s"]
                if settings.final_asr_model != settings.asr_model:
                    # Skema dua model: transkrip live (model cepat) hanya untuk tampilan selama rekaman.
                    # Seluruh audio ditranskrip ulang dengan model akhir yang lebih akurat; hasil inilah
                    # yang dikirim ke LLM dan disimpan sebagai bukti kutipan.
                    t = step("refining")
                    segments, info = asr.transcribe(ss.audio_path, settings, model=settings.final_asr_model)
                    models.update(info)
                    models["asr_live_model"] = settings.asr_model
                    timings["asr_refine_s"] = round(time.perf_counter() - t, 1)
                    ss.transcript = segments
                    db.commit()
                else:
                    _asr_step(ss, settings, final=True)  # hanya sisa audio setelah potongan terakhir
                    segments = ss.transcript
                    models.update({k: v for k, v in ss.model_info.items() if k != "live"})
            else:
                segments, info = asr.transcribe(ss.audio_path, settings, model=settings.final_asr_model)
                models.update(info)
            timings["asr_s"] = round(time.perf_counter() - t, 1)
            if not segments:
                raise RuntimeError("Transkrip kosong: periksa mikrofon atau berkas audio.")
            # Salinan baru: ekstraksi menulis label pembicara ke tiap segmen. Mengubah objek JSON yang
            # sedang dilacak SQLAlchemy di tempat tidak terdeteksi sebagai perubahan, sehingga label hilang.
            segments = [dict(s) for s in segments]

            t = step("extracting")
            visit = ss.visit
            patient = visit.patient if visit else None
            practitioner = visit.practitioner if visit else None
            nama_pasien = patient.name if patient else None
            nama_dokter = practitioner.name if practitioner else None
            alamat_pasien = patient.address if patient else None

            subjective, models["extract_llm"] = extract_subjective(
                segments,
                llm,
                nama_pasien=nama_pasien,
                nama_dokter=nama_dokter,
                alamat_pasien=alamat_pasien,
            )
            ss.transcript = segments
            ss.extraction = subjective
            timings["extract_s"] = round(time.perf_counter() - t, 1)
            db.refresh(ss, ["status"])
            if ss.status == "replaced":
                raise Replaced()

            note = visit.note or ClinicalNote(visit_id=visit.id)
            note.subjective = {k: subjective[k]["nilai"] or "" for k in SUBJECTIVE_FIELDS}
            note.subjective_summary = subjective["rangkuman_s"]
            note.allergies = subjective["alergi_terstruktur"]
            db.add(note)
            visit.status = "draft"
            t = step("coding")  # S sudah tampil di layar review; ICD menyusul

            keywords = subjective.get("kata_kunci_icd10_en") or icd_keywords(subjective.get("rangkuman_s") or "", llm)
            icd, models["icd"] = icd_pick(subjective, keywords, icd_table(settings), llm)
            ss.icd_suggestions = icd
            timings["icd_s"] = round(time.perf_counter() - t, 1)

            ss.status, ss.finished_at = "done", utcnow()
            timings["total_s"] = round(sum(v for k, v in timings.items() if k in ("asr_s", "extract_s", "icd_s")), 1)
            ss.timings, ss.model_info = timings, {**(ss.model_info or {}), **models}
            ss.model_info = {**ss.model_info, "llm_usage": llm.usage_report()}
            db.add(AuditLog(action="scribe_done", obj=f"visit:{visit.id}", summary=str(timings)))
            db.commit()
        except Replaced:
            log.info("sesi scribe %s diganti rekaman ulang; hasil dibuang", session_id)
            db.rollback()
        except Exception as e:
            log.exception("sesi scribe %s gagal", session_id)
            db.rollback()
            ss = db.get(ScribeSession, session_id)
            if ss.status != "replaced":
                ss.status, ss.error, ss.timings = "failed", str(e)[:2000], timings
                ss.model_info = {**(ss.model_info or {}), "llm_usage": llm.usage_report()}
            if ss.status != "replaced" and ss.visit.status == "processing":
                ss.visit.status = "consented"
            db.commit()


def submit(session_factory, session_id: int, settings: Settings, text_transcript: str | None = None):
    return executor.submit(run_session, session_factory, session_id, settings, text_transcript)


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

            ss = next((s for s in reversed(visit.scribe_sessions) if s.status not in ("failed", "replaced", "abandoned")), None)
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
            log.info("Rekomendasi ICD-10 background kunjungan %s selesai.", visit_id)
        except Exception:
            log.exception("Gagal menyusun usulan ICD-10 background untuk kunjungan %s", visit_id)
            db.rollback()
        finally:
            # Append satu record per job, termasuk hasil kosong/gagal. JSON pada
            # sesi bersama bisa saling menimpa bila dua job ICD selesai bersamaan.
            db.add(AuditLog(action="llm_usage_icd", obj=f"visit:{visit_id}", summary=json.dumps({
                "job_id": str(uuid4()), "usage": llm.usage_report(),
            })))
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
        executor.submit(asr.get_model, settings)
        if settings.final_asr_model != settings.asr_model:
            executor.submit(asr.get_model, settings, settings.final_asr_model)
