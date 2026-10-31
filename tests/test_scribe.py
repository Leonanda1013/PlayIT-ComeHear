from app.models import ScribeSession, Visit
from app.scribe.asr import parse_text_transcript
from app.scribe.icd import load_icd, postprocess, retrieve
from app.scribe.pipeline import run_session
from app.scribe.schemas import IcdPick
from app.scribe.textnorm import normalize, wer

TRANSKRIP = """Dokter: Siang Bu, keluhannya apa?
Ibu: Ini Raka ket wingi isuk awakke sumer panas tinggi banget Dok, terus sirahne ngelu.
Dokter: Ada muntah atau mimisan?
Ibu: Mimisan nggak ada Dok, cuma tadi pagi mual mau muntah.
Dokter: Ada alergi obat?
Ibu: Kayaknya nggak ada Dok, tapi kalau makan udang gatal-gatal."""


def test_wer_normalization_is_fair():
    assert normalize("Suhu 38,6 derajat, Dok!") == "suhu 38 koma 6 derajat dokter"
    assert normalize("tiga puluh delapan koma enam") == "38 koma 6"
    assert wer("Demam, sudah tiga hari.", "demam udah 3 hari") == 0.0
    assert abs(wer("anak saya demam", "anak saya diam") - 1 / 3) < 1e-9


def test_parse_text_transcript_roles():
    segs = parse_text_transcript(TRANSKRIP)
    assert [s["speaker"] for s in segs] == ["doctor", "guardian"] * 3
    assert segs[1]["i"] == 1


def test_icd_retrieval_ranks_symptom_codes_and_dedupes(settings):
    rows = load_icd(str(settings.icd10_seed_csv))
    found = [r.code for r in retrieve(rows, ["fever", "headache", "typhoid"])]
    assert "R50.9" in found and "R51" in found and "A01.0" in found
    picks = [IcdPick(code="A01", deskripsi_id="", keyakinan=0.7, alasan=""),
             IcdPick(code="A01.0", deskripsi_id="", keyakinan=0.6, alasan=""),
             IcdPick(code="X99.9", deskripsi_id="", keyakinan=0.9, alasan="dikarang")]
    assert [p["code"] for p in postprocess(picks, rows)] == ["A01.0"]


def test_pipeline_text_to_draft_with_mock(session_factory, db, visit_with_note, settings):
    visit_with_note.note.subjective = {}
    ss = ScribeSession(visit_id=visit_with_note.id, status="queued")
    db.add(ss)
    db.commit()
    run_session(session_factory, ss.id, settings, text_transcript=TRANSKRIP)
    with session_factory() as s:
        ss = s.get(ScribeSession, ss.id)
        assert ss.status == "done", ss.error
        assert len(ss.transcript) == 6
        assert ss.extraction["keluhan_utama"]["grounding"] == 1.0
        assert ss.icd_suggestions and all(c["code"] for c in ss.icd_suggestions)
        v = s.get(Visit, visit_with_note.id)
        assert v.status == "draft"
        assert "sumer" in v.note.subjective["keluhan_utama"]


def test_incremental_asr_holds_back_tail_and_finishes(monkeypatch, settings):
    import numpy as np

    from app.scribe import asr
    audio = {"len": 30.0}
    monkeypatch.setattr(asr, "decode_audio", lambda path: np.zeros(int(audio["len"] * 16000), dtype=np.float32))

    def fake_run(chunk, s, offset=0.0):
        end = offset + len(chunk) / 16000
        t, out = offset, []
        while t + 4 <= end:
            out.append({"start": t, "end": t + 4, "text": f"kalimat {int(t)}."})
            t += 4
        return out
    monkeypatch.setattr(asr, "_run", fake_run)

    segs, off, dur = asr.transcribe_incremental("x", settings, [], 0.0, final=False)
    assert dur == 30.0 and off == 24.0  # segmen 24-28 bisa berlanjut di ujung audio: ditunda
    assert [s["i"] for s in segs] == [0, 1, 2, 3, 4, 5]
    audio["len"] = 40.0
    same, off2, _ = asr.transcribe_incremental("x", settings, segs, off, final=False)
    assert same == segs and off2 == off  # belum cukup audio baru
    final, off3, _ = asr.transcribe_incremental("x", settings, segs, off, final=True)
    assert off3 == 40.0 and [s["text"] for s in final][-2:] == ["kalimat 32.", "kalimat 36."]
    assert [s["i"] for s in final] == list(range(len(final)))


def test_live_path_persists_speaker_labels(session_factory, db, visit_with_note, settings):
    """Regresi: label pembicara hilang bila transkrip dari ASR bertahap diubah di tempat."""
    segs = [{"i": i, "start": None, "end": None, "speaker": None, "text": t}
            for i, t in enumerate(["Keluhannya apa Bu?", "Anak saya demam tiga hari Dok."])]
    ss = ScribeSession(visit_id=visit_with_note.id, status="queued", audio_path="x.webm", transcript=segs,
                       model_info={"live": {"offset": 99.0, "asr_s": 1.0}})
    db.add(ss)
    db.commit()
    import app.scribe.pipeline as pl
    orig = pl.asr.transcribe_incremental
    pl.asr.transcribe_incremental = lambda path, s, segments, offset, final: (segments, offset, 10.0)
    try:
        run_session(session_factory, ss.id, settings)
    finally:
        pl.asr.transcribe_incremental = orig
    with session_factory() as s:
        got = s.get(ScribeSession, ss.id)
        assert got.status == "done", got.error
        assert [x["speaker"] for x in got.transcript] == ["doctor", "guardian"]
