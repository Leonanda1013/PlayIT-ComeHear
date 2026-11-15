"""Label pembicara, ekstraksi S, dan usulan ICD-10 dengan LLM."""
import json

from rapidfuzz import fuzz

from app.scribe.icd import IcdRow, postprocess, retrieve
from app.scribe.llm import LLM
from app.scribe.schemas import (SUBJECTIVE_FIELDS, ExtractionWithSpeakers, FieldStatus, IcdKeywords, IcdPicks,
                                SpeakerLabels, SubjectiveExtraction)
from app.scribe.textnorm import normalize

SYSTEM = (
    "Kamu adalah AI medical scribe untuk poli rawat jalan di Indonesia. Kamu hanya menyusun draf dari "
    "transkrip; dokter yang memeriksa dan memutuskan. Jangan pernah menambah informasi yang tidak "
    "diucapkan. Transkrip bisa bercampur bahasa Jawa (mis. 'sumer/panas' = demam, 'ngelu' = pusing/nyeri "
    "kepala, 'mencret' = diare, 'ket wingi' = sejak kemarin, 'isuk' = pagi, 'lemes' = lemas).\n"
    "Aturan Toleransi ASR: Transkrip dihasilkan oleh Speech-to-Text yang mungkin salah mengeja istilah lokal atau medis.\n"
    "Contoh koreksi cerdas:\n"
    "- 'sumber' / 'semer' pada konteks badan panas -> pahami sebagai 'sumer' (demam ringan).\n"
    "- 'ngeluh' / 'sirah ngeluh' -> pahami sebagai 'ngelu' (pusing / sakit kepala).\n"
    "- 'para setamol' / 'para setan mol' -> 'parasetamol'.\n"
    "- 'grog grog' -> 'batuk grok-grok' (berdahak).\n"
    "Terjemahkan maksud klinisnya ke dalam bahasa Indonesia baku di draf SOAP."
)

ROLE_ID = {"doctor": "DOKTER", "patient": "PASIEN", "guardian": "ORANG TUA", None: "?"}

EXAMPLE_TRANSCRIPT = (
    "[0] DOKTER: Selamat pagi Bu, silakan duduk. Keluhannya apa ya Bu?\n"
    "[1] ORANG TUA: Pagi Dok. Ini anak saya badannya panas sumer sejak dua hari lalu, terus batuk grok-grok berdahak.\n"
    "[2] DOKTER: Ada muntah, diare, atau mimisan tidak Bu?\n"
    "[3] ORANG TUA: Mimisan sama muntah nggak ada Dok. Cuma tadi pagi sempat mual sedikit pas mau makan bubur.\n"
    "[4] DOKTER: Sebelumnya pernah sakit seperti ini? Ada riwayat alergi obat atau makanan?\n"
    "[5] ORANG TUA: Belum pernah sakit begini Dok. Alergi obat tidak ada, tapi kalau makan udang kulitnya langsung bentol biduran gatal.\n"
    "[6] DOKTER: Di rumah sudah sempat dikasih obat apa saja Bu?\n"
    "[7] ORANG TUA: Baru saya kasih parasetamol sirup satu sendok sama kompres hangat di dahi."
)

EXAMPLE_JSON_BASE = {
    "keluhan_utama": {
        "nilai": "Demam sumer dan batuk berdahak sejak 2 hari lalu",
        "source_ids": [1],
        "kutipan": "Ini anak saya badannya panas sumer sejak dua hari lalu, terus batuk grok-grok berdahak.",
        "status": "jelas",
        "alasan_ambigu": None,
    },
    "riwayat_penyakit_sekarang": {
        "nilai": "Demam sumer sejak 2 hari yang lalu disertai batuk berdahak grok-grok dan rasa mual saat makan. Keluhan muntah dan mimisan disangkal.",
        "source_ids": [1, 3],
        "kutipan": "batuk grok-grok berdahak... sempat mual sedikit pas mau makan bubur.",
        "status": "jelas",
        "alasan_ambigu": None,
    },
    "riwayat_penyakit_dahulu": {
        "nilai": "Tidak ada riwayat sakit serupa sebelumnya",
        "source_ids": [5],
        "kutipan": "Belum pernah sakit begini Dok.",
        "status": "jelas",
        "alasan_ambigu": None,
    },
    "riwayat_alergi": {
        "nilai": "Alergi obat disangkal; alergi makanan berupa udang dengan manifestasi biduran dan gatal",
        "source_ids": [5],
        "kutipan": "Alergi obat tidak ada, tapi kalau makan udang kulitnya langsung bentol biduran gatal.",
        "status": "jelas",
        "alasan_ambigu": None,
    },
    "riwayat_pengobatan": {
        "nilai": "Parasetamol sirup 1 sendok dan kompres hangat",
        "source_ids": [7],
        "kutipan": "Baru saya kasih parasetamol sirup satu sendok sama kompres hangat di dahi.",
        "status": "jelas",
        "alasan_ambigu": None,
    },
    "alergi_terstruktur": [
        {
            "zat": "udang",
            "kategori": "food",
            "reaksi": "biduran gatal",
            "kepastian": "confirmed",
            "source_ids": [5],
        }
    ],
    "gejala_disangkal": ["muntah", "mimisan"],
    "rangkuman_s": (
        "Pasien anak mengeluh demam sumer dan batuk berdahak sejak 2 hari yang lalu, disertai keluhan mual saat makan. "
        "Pasien sudah diberikan parasetamol sirup dan kompres hangat di rumah. Keluhan muntah dan mimisan disangkal. "
        "Riwayat penyakit serupa sebelumnya disangkal. Pasien memiliki riwayat alergi makanan berupa udang dengan "
        "reaksi biduran dan gatal; riwayat alergi obat disangkal."
    ),
}

EXAMPLE_SPEAKERS = [
    {"i": 0, "speaker": "doctor"},
    {"i": 1, "speaker": "guardian"},
    {"i": 2, "speaker": "doctor"},
    {"i": 3, "speaker": "guardian"},
    {"i": 4, "speaker": "doctor"},
    {"i": 5, "speaker": "guardian"},
    {"i": 6, "speaker": "doctor"},
    {"i": 7, "speaker": "guardian"},
]


def _few_shot_block(need_speakers: bool) -> str:
    ex = dict(EXAMPLE_JSON_BASE)
    if need_speakers:
        ex = {"pembicara": EXAMPLE_SPEAKERS, **ex}
    ex_json = json.dumps(ex, ensure_ascii=False, indent=2)
    return (
        "CONTOH ACUAN 1-SHOT (Gunakan sebagai standar pemisahan gejala, pertinent negatives, dan kutipan persis):\n"
        f"TRANSKRIP CONTOH:\n{EXAMPLE_TRANSCRIPT}\n\n"
        f"OUTPUT JSON CONTOH:\n{ex_json}\n\n"
        "---\n\n"
    )


def render_transcript(segments: list[dict]) -> str:
    return "\n".join(f"[{s['i']}] {ROLE_ID.get(s.get('speaker'), '?')}: {s['text']}" for s in segments)


def label_speakers(segments: list[dict], llm: LLM) -> tuple[list[dict], str | None]:
    """Diarization berbasis isi percakapan. Untuk MVP satu mikrofon ini lebih andal daripada
    pemisahan akustik, karena peran (dokter vs orang tua) terlihat dari cara bicara."""
    if all(s.get("speaker") for s in segments):
        return segments, None
    prompt = (
        "Tentukan pembicara setiap segmen transkrip konsultasi poli anak berikut. Pilihan: doctor "
        "(dokter: bertanya, memeriksa, menjelaskan), guardian (orang tua/pendamping: menjawab tentang anak), "
        "patient (anak sendiri). Kembalikan label untuk SEMUA indeks.\n\n"
        + "\n".join(f"[{s['i']}] {s['text']}" for s in segments))
    labels, model = llm.generate(SYSTEM, prompt, SpeakerLabels)
    by_i = {lb.i: lb.speaker.value for lb in labels.labels}
    for s in segments:
        s["speaker"] = by_i.get(s["i"], s.get("speaker"))
    return segments, model


def extract_subjective(segments: list[dict], llm: LLM) -> tuple[dict, str]:
    """Bagian S. Bila pembicara belum diketahui (rekaman audio), label pembicara diminta dalam
    panggilan yang sama, sehingga hanya satu putaran ke LLM."""
    need_speakers = not all(s.get("speaker") for s in segments)
    speaker_rule = (
        "9. Isi `pembicara` untuk SETIAP indeks: doctor (bertanya, memeriksa, menjelaskan), guardian "
        "(orang tua/keluarga/pendamping yang menjawab untuk pasien), patient (pasien sendiri). Tentukan dulu peran "
        "ini, lalu pakai untuk menyusun anamnesis.\n" if need_speakers else "")
    few_shot = _few_shot_block(need_speakers)
    prompt = (
        "Susun bagian SUBJECTIVE (anamnesis) SOAP dari transkrip berikut. Abaikan pemeriksaan fisik, "
        "diagnosis, dan resep: itu diisi dokter.\n"
        "Aturan:\n"
        "1. Setiap isian wajib menyertakan source_ids (indeks [i]) dan kutipan persis dari segmen itu.\n"
        "2. Tidak dibahas -> nilai null, source_ids [], kutipan null, status tidak_ditemukan.\n"
        "3. Pasien/pendamping ragu ('kayaknya', 'lupa', 'mungkin') -> status ambigu dan isi alasan_ambigu.\n"
        "4. Disebut jelas -> status jelas.\n"
        "5. Tulis nilai dalam bahasa Indonesia baku; terjemahkan istilah Jawa. Sertakan durasi bila disebut.\n"
        "6. Jangan menyebut nama pasien di rangkuman_s.\n"
        "7. alergi_terstruktur hanya untuk alergen yang dilaporkan ADA (pasti atau diduga). Alergi yang "
        "disangkal ('alergi obat nggak ada') JANGAN dibuat entri; cukup tulis di riwayat_alergi.\n"
        "8. gejala_disangkal hanya gejala yang jelas dijawab tidak ada; gejala yang hampir terjadi "
        "('mual mau muntah') bukan disangkal.\n"
        f"{speaker_rule}\n"
        f"{few_shot}"
        f"TRANSKRIP:\n{render_transcript(segments)}")
    result, model = llm.generate(SYSTEM, prompt, ExtractionWithSpeakers if need_speakers else SubjectiveExtraction)
    if need_speakers:
        by_i = {lb.i: lb.speaker.value for lb in result.pembicara}
        for seg in segments:
            seg["speaker"] = by_i.get(seg["i"], seg.get("speaker"))
    data = ground(result, segments)
    data.pop("pembicara", None)
    return data, model


def ground(result: SubjectiveExtraction, segments: list[dict]) -> dict:
    """Periksa ulang dengan kode: kutipan harus benar-benar ada di segmen sumber."""
    texts = {s["i"]: s["text"] for s in segments}
    data = result.model_dump(mode="json")
    for key in SUBJECTIVE_FIELDS:
        f = data[key]
        f["source_ids"] = [i for i in f["source_ids"] if i in texts]
        if f["status"] == FieldStatus.tidak_ditemukan.value or not f["nilai"]:
            f.update(nilai=None, status=FieldStatus.tidak_ditemukan.value)
            f["grounding"] = None
            continue
        source = " ".join(texts[i] for i in f["source_ids"])
        score = fuzz.partial_ratio(normalize(f["kutipan"] or ""), normalize(source)) if source else 0
        f["grounding"] = round(score / 100, 2)
        if score < 80:
            f["status"] = FieldStatus.ambigu.value
            f["alasan_ambigu"] = "Bukti di transkrip tidak ditemukan atau tidak cocok; periksa ulang."
    for a in data["alergi_terstruktur"]:
        a["source_ids"] = [i for i in a["source_ids"] if i in texts]
    return data


def icd_keywords(text: str, llm: LLM) -> list[str]:
    """Bisa dijalankan dari transkrip mentah, bersamaan dengan ekstraksi S."""
    kw, _ = llm.generate(SYSTEM, (
        "Ubah keluhan pasien berikut menjadi kata kunci pencarian ICD-10 WHO (bahasa Inggris, kata dasar). "
        "Sertakan gejala (fever, headache, cough, vomiting, diarrhoea) dan kemungkinan penyakit yang "
        "relevan. Abaikan gejala yang disangkal.\n\n" + text), IcdKeywords)
    return kw.english_keywords


def icd_pick(summary: str, keywords: list[str], rows: tuple[IcdRow, ...], llm: LLM) -> tuple[list[dict], dict]:
    candidates = retrieve(rows, keywords)
    if not candidates or not summary.strip():
        return [], {"keywords": keywords, "candidates": len(candidates)}
    cand_json = json.dumps([{"code": r.code, "display": r.display} for r in candidates], ensure_ascii=False)
    picks, _ = llm.generate(SYSTEM, (
        "Pilih maksimal 3 kode ICD-10 sebagai USULAN AWAL untuk dokter, hanya dari daftar KANDIDAT. "
        "Dasarnya hanya anamnesis (belum ada pemeriksaan fisik/lab), jadi kode gejala (bab R) boleh "
        "dipilih bila penyakit belum bisa dipastikan. Pilih kode paling spesifik; jangan memilih kode "
        "induk sekaligus turunannya. Jangan menyebut gejala yang tidak ada di anamnesis.\n\n"
        f"ANAMNESIS: {summary}\n\nKANDIDAT:\n{cand_json}"), IcdPicks)
    return postprocess(picks.picks, rows), {"keywords": keywords, "candidates": len(candidates)}


def suggest_icd(subjective: dict, rows: tuple[IcdRow, ...], llm: LLM) -> tuple[list[dict], dict]:
    summary = subjective.get("rangkuman_s") or ""
    if not summary.strip():
        return [], {}
    return icd_pick(summary, icd_keywords("ANAMNESIS: " + summary, llm), rows, llm)
