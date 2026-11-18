import pytest

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
    assert normalize("Suhu 38.6 derajat") == "suhu 38 koma 6 derajat"
    assert normalize("tiga puluh delapan koma enam") == "38 koma 6"
    assert normalize("Awakke sumer ket wingi") == "badannya demam sejak kemarin"
    assert normalize("sirahne ngelu") == "kepalanya pusing"
    assert wer("Demam, sudah tiga hari.", "demam udah 3 hari") == 0.0
    assert wer("badannya demam sejak kemarin", "awakke sumer ket wingi") == 0.0
    assert abs(wer("anak saya demam", "anak saya diam") - 1 / 3) < 1e-9


def test_parse_text_transcript_roles():
    segs = parse_text_transcript(TRANSKRIP)
    assert [s["speaker"] for s in segs] == ["doctor", "guardian"] * 3
    assert segs[1]["i"] == 1


def test_icd_retrieval_ranks_symptom_codes_and_dedupes(settings):
    rows = load_icd(str(settings.icd10_csv))
    found = [r.code for r in retrieve(rows, ["fever", "headache", "typhoid"])]
    assert "R50.9" in found and "R51" in found and "A01.0" in found
    picks = [IcdPick(code="A01", deskripsi_id="", keyakinan=0.7, alasan=""),
             IcdPick(code="A01.0", deskripsi_id="", keyakinan=0.6, alasan=""),
             IcdPick(code="X99.9", deskripsi_id="", keyakinan=0.9, alasan="dikarang")]
    assert [p["code"] for p in postprocess(picks, rows)] == ["A01.0"]


def test_icd_synonym_expansion_and_code_search(settings):
    rows = load_icd(str(settings.icd10_csv))
    # Test Indonesian reverse mapping: "diare" / "mencret" -> A09
    diare_found = [r.code for r in retrieve(rows, ["diare", "mencret"])]
    assert "A09" in diare_found
    # Test Indonesian reverse mapping: "biduran" -> L50.9 (Urticaria)
    urticaria_found = [r.code for r in retrieve(rows, ["biduran", "gatal"])]
    assert "L50.9" in urticaria_found
    # Test direct code search: "A01"
    code_found = [r.code for r in retrieve(rows, ["A01"])]
    assert "A01" in code_found and "A01.0" in code_found


def test_pipeline_text_to_draft_with_mock(session_factory, db, visit_with_note, settings, monkeypatch):
    import app.scribe.pipeline as pl

    original_extract = pl.extract_subjective

    def extract_with_keywords(segments, llm):
        result, model = original_extract(segments, llm)
        result["kata_kunci_icd10_en"] = ["fever", "headache"]
        return result, model

    monkeypatch.setattr(pl, "extract_subjective", extract_with_keywords)
    monkeypatch.setattr(pl, "icd_keywords", lambda *_: pytest.fail("kata kunci ICD sudah tersedia"))
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
        if isinstance(ss.icd_suggestions, dict):
            assert ss.icd_suggestions.get("utama") and all(c["code"] for c in ss.icd_suggestions["utama"])
        else:
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


def test_postprocess_four_mandatory_filters(settings):
    from app.scribe.icd import JUMLAH_KANDIDAT, KECUALIKAN_AWALAN_KODE
    assert JUMLAH_KANDIDAT == 50

    rows = load_icd(str(settings.icd10_csv))
    # Test 4 filter wajib:
    # a. Buang kode invalid (tidak di CSV)
    # b. Buang kode external cause V, W, X, Y
    # c. Buang kode induk jika turunannya ada di grup yang sama (R10 vs R10.1)
    # d. Buang kode dari sekunder jika sudah muncul di utama, serta hindari duplikat antar-grup sekunder
    utama_raw = [
        IcdPick(code="R10", deskripsi_id="Nyeri perut induk", keyakinan=0.7, alasan="induk"),
        IcdPick(code="R10.1", deskripsi_id="Nyeri perut atas", keyakinan=0.8, alasan="spesifik"),
        IcdPick(code="INVALID_XYZ", deskripsi_id="Palsu", keyakinan=0.99, alasan="tidak di csv"),
        IcdPick(code="V01", deskripsi_id="Kecelakaan pejalan kaki", keyakinan=0.95, alasan="eksternal V"),
        IcdPick(code="W54", deskripsi_id="Gigitan anjing", keyakinan=0.9, alasan="eksternal W"),
        IcdPick(code="X99.9", deskripsi_id="Serangan benda tajam", keyakinan=0.85, alasan="eksternal X"),
        IcdPick(code="Y01", deskripsi_id="Dorongan benda tumpul", keyakinan=0.8, alasan="eksternal Y"),
    ]
    sekunder_raw = [
        # Grup 1: R10.1 sudah ada di utama -> dibuang; K29.7 valid -> disimpan
        [
            IcdPick(code="R10.1", deskripsi_id="Duplikat utama", keyakinan=0.75, alasan="duplikat utama"),
            IcdPick(code="K29.7", deskripsi_id="Gastritis", keyakinan=0.7, alasan="sekunder 1"),
        ],
        # Grup 2: K29.7 sudah ada di grup 1 -> dibuang; E11.9 valid -> disimpan; E11 induk vs E11.9 -> E11 dibuang
        [
            IcdPick(code="K29.7", deskripsi_id="Duplikat grup 1", keyakinan=0.65, alasan="duplikat"),
            IcdPick(code="E11", deskripsi_id="Diabetes induk", keyakinan=0.6, alasan="induk"),
            IcdPick(code="E11.9", deskripsi_id="Diabetes tanpa komplikasi", keyakinan=0.68, alasan="spesifik"),
        ],
    ]

    res = postprocess(utama_raw, sekunder_raw, rows=rows)
    assert isinstance(res, dict)
    assert "utama" in res and "sekunder" in res

    # Cek hasil utama: hanya R10.1 (R10 tereliminasi oleh c; invalid tereliminasi oleh a; V/W/X/Y oleh b)
    utama_codes = [x["code"] for x in res["utama"]]
    assert "R10.1" in utama_codes
    assert "R10" not in utama_codes
    assert "INVALID_XYZ" not in utama_codes
    assert not any(c.startswith(("V", "W", "X", "Y")) for c in utama_codes)

    # Cek hasil sekunder: list datar maks 3 kode
    # K29.7 disimpan; R10.1 dibuang karena duplikat utama; E11.9 disimpan; E11 dibuang karena ada E11.9
    sec_codes = [x["code"] for x in res["sekunder"]]
    assert sec_codes == ["K29.7", "E11.9"]
    assert len(res["sekunder"]) <= 3

    # Cek pemrosesan sekunder bila diberikan sebagai list datar langsung
    sekunder_flat = [
        IcdPick(code="R10.1", deskripsi_id="Duplikat utama", keyakinan=0.75, alasan="duplikat utama"),
        IcdPick(code="K29.7", deskripsi_id="Gastritis", keyakinan=0.7, alasan="sekunder 1"),
        IcdPick(code="K29.7", deskripsi_id="Duplikat", keyakinan=0.65, alasan="duplikat"),
        IcdPick(code="E11", deskripsi_id="Diabetes induk", keyakinan=0.6, alasan="induk"),
        IcdPick(code="E11.9", deskripsi_id="Diabetes tanpa komplikasi", keyakinan=0.68, alasan="spesifik"),
    ]
    res_flat = postprocess(utama_raw, sekunder_flat, rows=rows)
    assert [x["code"] for x in res_flat["sekunder"]] == ["K29.7", "E11.9"]
    assert len(res_flat["sekunder"]) <= 3


def test_suggest_icd_and_pick_stateless_per_request(settings):
    from app.scribe.extract import icd_pick, suggest_icd
    from app.scribe.llm import LLM
    from app.scribe.mock_llm import mock_generate

    rows = load_icd(str(settings.icd10_csv))
    llm = LLM(settings, mock=mock_generate)

    # Panggilan 1: Pasien Demam
    subj1 = {
        "keluhan_utama": {"nilai": "Demam tinggi sejak 2 hari"},
        "riwayat_penyakit_sekarang": {"nilai": "Disertai sakit kepala dan mual"},
        "gejala_disangkal": ["mimisan"],
        "rangkuman_s": "Pasien demam tinggi sejak 2 hari disertai sakit kepala dan mual.",
    }
    obj1 = {"suhu": "38.9 C", "tekanan_darah": "120/80"}
    res1, info1 = suggest_icd(subj1, rows, llm, objective=obj1)
    assert "utama" in res1 and "sekunder" in res1
    assert len(res1["utama"]) > 0
    assert info1["candidates"] > 0

    # Panggilan 2: Pasien Batuk dan Sesak
    subj2 = {
        "keluhan_utama": {"nilai": "Batuk berdahak dan sesak napas"},
        "riwayat_penyakit_sekarang": {"nilai": "Sesak memberat saat berbaring"},
        "gejala_disangkal": ["demam"],
        "rangkuman_s": "Pasien batuk berdahak dan sesak napas memberat saat berbaring.",
    }
    obj2 = "Pemeriksaan dada: ronki basah halus basal bilateral. Frekuensi napas 28x/m."
    res2, info2 = suggest_icd(subj2, rows, llm, objective=obj2)
    assert "utama" in res2 and "sekunder" in res2
    assert len(res2["utama"]) > 0

    # Pastikan panggilan 2 tidak tercampur data panggilan 1 (stateless)
    kws1 = set(info1["keywords"])
    kws2 = set(info2["keywords"])
    assert "fever" in kws1 or any("fev" in k for k in kws1)
    assert "cough" in kws2 or any("cough" in k for k in kws2)
    # Kode utama tidak boleh sama jika keluhannya bertolak belakang
    assert res1["utama"][0]["code"] != res2["utama"][0]["code"]


def test_background_trigger_suggest_icd_on_save_soap(db, doctor, visit_with_note, settings, session_factory, monkeypatch):
    import time
    from fastapi.testclient import TestClient
    from app.main import app, _sign, get_db
    import app.main as main_mod

    monkeypatch.setattr(main_mod, "SessionLocal", session_factory)
    monkeypatch.setattr(main_mod, "settings", settings)

    def override_get_db():
        with session_factory() as s:
            yield s

    app.dependency_overrides[get_db] = override_get_db
    try:
        client = TestClient(app)
        token = _sign(doctor.id)
        auth_header = {"Authorization": f"Bearer {token}"}

        vid = visit_with_note.id
        # 1. Simpan Subjektif dengan action 'to_oap' (Lanjut ke Objektif)
        r = client.post(f"/visits/{vid}/soap", json={
            "step": "s",
            "action": "to_oap",
            "summary": "Pasien mengeluh demam tinggi sejak 2 hari disertai nyeri kepala.",
            "s_keluhan_utama": "Demam tinggi sejak 2 hari",
            "s_riwayat_penyakit_sekarang": "Demam disertai pusing dan nyeri kepala",
        }, headers=auth_header)
        assert r.status_code == 200

        # Tunggu sebentar hingga worker background selesai
        time.sleep(0.3)

        # Ambil konsultasi untuk memeriksa usulan ICD
        consult = client.get(f"/visits/{vid}", headers=auth_header).json()
        assert consult["status"] == "ok"
        sugg = consult["session"]["icd_suggestions"]
        assert isinstance(sugg, dict)
        assert "utama" in sugg and len(sugg["utama"]) > 0

        # 2. Simpan Objektif dengan action 'to_ap' (Lanjut ke Asesmen)
        r2 = client.post(f"/visits/{vid}/soap", json={
            "step": "o",
            "action": "to_ap",
            "suhu": "39.1",
            "tensi": "120/80",
            "exam_text": "Suhu tubuh febris 39.1 C. Faring sedikit hiperemis.",
        }, headers=auth_header)
        assert r2.status_code == 200

        time.sleep(0.3)

        # Ambil lagi konsultasi: usulan diperbarui dengan menyertakan objektif
        consult2 = client.get(f"/visits/{vid}", headers=auth_header).json()
        sugg2 = consult2["session"]["icd_suggestions"]
        assert isinstance(sugg2, dict)
        assert "utama" in sugg2 and len(sugg2["utama"]) > 0

        # 3. Pemicu eksplisit via /suggest-icd endpoint
        r3 = client.post(f"/visits/{vid}/suggest-icd", json={
            "subjective": {"keluhan_utama": "Batuk kering"},
            "objective": "Ronki negatif",
        }, headers=auth_header)
        assert r3.status_code == 200
    finally:
        app.dependency_overrides.clear()


