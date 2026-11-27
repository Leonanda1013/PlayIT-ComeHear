"""LLM tiruan deterministik untuk uji alur tanpa API key. Bukan untuk demo hasil klinis."""
import json
import re

from app.scribe.schemas import (ExtractionWithSpeakers, FieldStatus, IcdKeywords, IcdPick, IcdPicks, IcdRerankResult, SpeakerLabel, SpeakerLabels,
                                SubjectiveExtraction, SubjectiveField)

_LINE = re.compile(r"^\[(\d+)\] ([^:]+): (.*)$")
_KW = {"demam": "fever", "panas": "fever", "sumer": "fever", "kepala": "headache", "ngelu": "headache",
       "batuk": "cough", "muntah": "vomiting", "mual": "nausea", "mencret": "diarrhoea", "diare": "diarrhoea",
       "gatal": "urticaria", "ruam": "rash"}


def _segments(prompt: str):
    out = []
    text = prompt.split("TRANSKRIP:\n", 1)[1] if "TRANSKRIP:\n" in prompt else prompt
    for line in text.splitlines():
        m = _LINE.match(line)
        if m:
            out.append((int(m.group(1)), m.group(2), m.group(3)))
    return out


def _field(segs, words):
    for i, who, text in segs:
        if who != "DOKTER" and any(w in text.lower() for w in words):
            return SubjectiveField(nilai=text, source_ids=[i], kutipan=text, status=FieldStatus.jelas,
                                   alasan_ambigu=None)
    return SubjectiveField(nilai=None, source_ids=[], kutipan=None, status=FieldStatus.tidak_ditemukan,
                           alasan_ambigu=None)


def mock_generate(prompt: str, schema):
    if schema is SpeakerLabels:
        labels = []
        text = prompt.split("TRANSKRIP:\n", 1)[1] if "TRANSKRIP:\n" in prompt else prompt
        for line in text.splitlines():
            m = re.match(r"^\[(\d+)\] (.*)$", line)
            if m:
                t = m.group(2)
                who = "guardian" if re.search(r"\bdok\b", t, re.I) and "?" not in t else "doctor"
                labels.append(SpeakerLabel(i=int(m.group(1)), speaker=who))
        return SpeakerLabels(labels=labels)
    if schema in (SubjectiveExtraction, ExtractionWithSpeakers):
        segs = _segments(prompt)
        ku = _field(segs, ["demam", "panas", "sumer", "batuk", "muntah", "mencret", "sakit"])
        extra = {}
        if schema is ExtractionWithSpeakers:
            extra["pembicara"] = [SpeakerLabel(i=i, speaker="doctor" if "?" in t else "guardian") for i, _, t in segs]
        return schema(**extra,
            keluhan_utama=ku, riwayat_penyakit_sekarang=ku,
            riwayat_penyakit_dahulu=_field(segs, ["pernah", "sebelumnya"]),
            riwayat_alergi=_field(segs, ["alergi"]),
            riwayat_pengobatan=_field(segs, ["kasih", "minum obat", "kompres"]),
            alergi_terstruktur=[], gejala_disangkal=[],
            rangkuman_s=" ".join(t for _, w, t in segs if w != "DOKTER"))
    if schema is IcdKeywords:
        text = prompt.lower()
        kws = sorted({v for k, v in _KW.items() if k in text}) or ["fever"]
        return IcdKeywords(istilah_asli=[], istilah_baku=[], english_keywords=kws)
    if schema is IcdPicks:
        cands = json.loads(prompt.split("KANDIDAT:\n", 1)[1])
        return IcdPicks(picks=[IcdPick(code=c["code"], deskripsi_id=c["display"], keyakinan=0.5 - n * 0.1,
                                       alasan="mock") for n, c in enumerate(cands[:3])])
    if schema is IcdRerankResult:
        cands = []
        if "KANDIDAT (KODE | NAMA):\n" in prompt:
            cand_text = prompt.split("KANDIDAT (KODE | NAMA):\n", 1)[1]
            for line in cand_text.splitlines():
                line = line.strip()
                if not line:
                    continue
                if "|" in line:
                    parts = line.split("|", 1)
                    cands.append({"code": parts[0].strip(), "display": parts[1].strip()})
        elif "KANDIDAT:\n" in prompt:
            try:
                cands = json.loads(prompt.split("KANDIDAT:\n", 1)[1])
            except Exception:
                pass
        utama = [
            IcdPick(code=c["code"], deskripsi_id=c.get("display") or c["code"], keyakinan=round(0.8 - n * 0.1, 2),
                    alasan="mock diagnosis utama")
            for n, c in enumerate(cands[:3])
        ]
        rpd_line = next((ln.split(":", 1)[1].strip() for ln in prompt.splitlines() if ln.startswith("RPD:")), "")
        has_rpd = bool(rpd_line and rpd_line != "-" and not re.match(r"^(tidak|belum|nggak|ga|disangkal|nihil)", rpd_line, re.I))
        has_sec = has_rpd or "dehydration" in prompt.lower() or "volume depletion" in prompt.lower()
        sekunder = []
        if has_sec and len(cands) > 3:
            sekunder = [
                IcdPick(code=c["code"], deskripsi_id=c.get("display") or c["code"], keyakinan=round(0.6 - n * 0.1, 2),
                        alasan="mock diagnosis sekunder")
                for n, c in enumerate(cands[3:6])
            ]
        return IcdRerankResult(utama=utama, sekunder=sekunder)
    raise ValueError(f"mock tidak mendukung {schema}")
