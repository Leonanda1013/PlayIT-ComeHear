"""Katalog & Mesin Pencarian Cerdas ICD-10 untuk SATUSEHAT.

Fitur:
- Pembaca katalog resmi ICD-10 SATUSEHAT (load_icd, icd_table);
- Pemetaan sinonim medis terbalik (Indonesian/Javanese -> istilah resmi ICD-10 WHO/SATUSEHAT);
- Indeks TF-IDF lokal dengan pencocokan awalan (prefix match) & direct code matching;
- Pengecualian otomatis kode penyebab eksternal (V, W, X, Y) agar tidak menjadi usulan diagnosis primer;
- Post-processing: deduping kode induk vs turunan spesifik (mis. A01 dibuang jika A01.0 terpilih).
"""
import csv
import math
import re
from collections import defaultdict
from dataclasses import dataclass
from functools import lru_cache
from typing import Any

from app.config import Settings

# Pengecualian awalan kode penyebab eksternal (Bab XX ICD-10: V01-Y98)
KECUALIKAN_AWALAN_KODE = ("V", "W", "X", "Y")
JUMLAH_KANDIDAT = 50

STOPWORDS = {
    "and", "the", "with", "without", "other", "not", "elsewhere", "classified",
    "due", "for", "from", "site", "type", "specified", "unspecified",
}


@dataclass(frozen=True)
class IcdRow:
    code: str
    display: str


@lru_cache
def load_icd(path: str) -> tuple[IcdRow, ...]:
    with open(path, encoding="utf-8-sig", newline="") as f:
        sample = f.read(4096)
        f.seek(0)
        dialect = csv.Sniffer().sniff(sample, delimiters=",;\t")
        rows = [
            IcdRow(r["CODE"].strip(), r["DISPLAY"].strip())
            for r in csv.DictReader(f, dialect=dialect)
            if r.get("CODE") and r.get("DISPLAY")
        ]
    return tuple(rows)


def icd_table(s: Settings) -> tuple[IcdRow, ...]:
    return load_icd(str(s.icd10_csv))


# Pemetaan sinonim medis terbalik: istilah bahasa Indonesia/Jawa/sehari-hari
# ke kata kunci resmi di katalog ICD-10 SATUSEHAT / WHO.
MEDICAL_SYNONYMS: dict[str, tuple[str, ...]] = {
    # Demam & Infeksi Sistemik
    "fever": ("fever", "febris", "pyrexia"),
    "demam": ("fever", "febris"),
    "panas": ("fever",),
    "sumer": ("fever",),
    "typhoid": ("typhoid", "paratyphoid", "enteric"),
    "tipes": ("typhoid", "paratyphoid"),
    "tifus": ("typhoid", "paratyphoid"),
    "dengue": ("dengue", "haemorrhagic"),
    "dbd": ("dengue", "haemorrhagic"),
    "dhf": ("dengue", "haemorrhagic"),
    "malaria": ("malaria",),
    "measles": ("measles", "morbilli"),
    "campak": ("measles", "morbilli"),
    "varicella": ("varicella", "chickenpox"),
    "cacar": ("varicella", "chickenpox"),

    # Saluran Pernapasan (Respiratori)
    "cough": ("cough", "respiratory", "bronchitis"),
    "batuk": ("cough", "bronchitis"),
    "flu": ("nasopharyngitis", "common cold", "rhinitis"),
    "pilek": ("nasopharyngitis", "common cold", "rhinitis"),
    "cold": ("nasopharyngitis", "common cold"),
    "ispa": ("upper respiratory", "nasopharyngitis"),
    "urti": ("upper respiratory", "nasopharyngitis"),
    "pneumonia": ("pneumonia", "bronchopneumonia"),
    "paru": ("pneumonia", "bronchitis"),
    "bronchitis": ("bronchitis", "bronchiolitis"),
    "bronchiolitis": ("bronchiolitis", "bronchitis"),
    "asthma": ("asthma", "bronchospasm"),
    "asma": ("asthma", "dyspnoea"),
    "sesak": ("dyspnoea", "dyspnea", "asthma", "respiratory"),
    "dyspnoea": ("dyspnoea", "dyspnea", "respiratory"),
    "dyspnea": ("dyspnoea", "dyspnea", "respiratory"),
    "pharyngitis": ("pharyngitis", "tonsillitis", "sore throat"),
    "tonsillitis": ("tonsillitis", "pharyngitis"),
    "radang": ("pharyngitis", "tonsillitis", "infection"),
    "tenggorokan": ("pharyngitis", "tonsillitis"),

    # Saluran Pencernaan (Gastrointestinal)
    "diarrhoea": ("diarrhoea", "diarrhea", "gastroenteritis"),
    "diarrhea": ("diarrhoea", "diarrhea", "gastroenteritis"),
    "diare": ("diarrhoea", "diarrhea", "gastroenteritis"),
    "mencret": ("diarrhoea", "diarrhea", "gastroenteritis"),
    "gastroenteritis": ("gastroenteritis", "diarrhoea", "diarrhea"),
    "vomiting": ("vomiting", "nausea"),
    "muntah": ("vomiting", "nausea"),
    "nausea": ("nausea", "vomiting"),
    "mual": ("nausea", "vomiting"),
    "gastritis": ("gastritis", "dyspepsia", "stomach"),
    "maag": ("gastritis", "dyspepsia"),
    "abdominal": ("abdominal pain", "colitis", "gastritis"),
    "perut": ("abdominal pain", "gastroenteritis", "gastritis"),
    "senep": ("abdominal pain", "colitis"),
    "mules": ("abdominal pain", "gastroenteritis"),
    "constipation": ("constipation",),
    "sembelit": ("constipation",),
    "konstipasi": ("constipation",),

    # Neurologi & Gejala Umum
    "headache": ("headache", "cephalgia"),
    "pusing": ("headache", "cephalgia"),
    "ngelu": ("headache", "cephalgia"),
    "convulsion": ("convulsion", "convulsions", "seizure", "seizures", "febrile"),
    "convulsions": ("convulsion", "convulsions", "seizure", "seizures", "febrile"),
    "seizure": ("convulsion", "convulsions", "seizure", "seizures", "febrile"),
    "kejang": ("convulsion", "convulsions", "seizure", "febrile"),
    "step": ("convulsion", "convulsions", "febrile"),
    "fatigue": ("fatigue", "malaise"),
    "lemas": ("fatigue", "malaise"),
    "lemes": ("fatigue", "malaise"),
    "malaise": ("malaise", "fatigue"),
    "anorexia": ("anorexia", "feeding"),
    "nafsu makan": ("anorexia",),

    # Kulit & Alergi
    "allergy": ("allergy", "allergic", "urticaria", "adverse"),
    "alergi": ("allergy", "allergic", "urticaria", "adverse"),
    "urticaria": ("urticaria", "allergy", "dermatitis"),
    "biduran": ("urticaria", "allergy"),
    "gatal": ("urticaria", "pruritus", "dermatitis"),
    "pruritus": ("urticaria", "pruritus", "dermatitis"),
    "rash": ("rash", "eruption", "exanthem", "dermatitis"),
    "ruam": ("rash", "eruption", "exanthem", "dermatitis"),
    "dermatitis": ("dermatitis", "eczema", "rash"),
    "eczema": ("dermatitis", "eczema"),

    # THT & Mata
    "otitis": ("otitis media", "ear"),
    "telinga": ("otitis media",),
    "conjunctivitis": ("conjunctivitis", "eye"),
    "mata": ("conjunctivitis",),

    # Saluran Kemih & Lainnya
    "uti": ("urinary tract infection", "urinary"),
    "isk": ("urinary tract infection", "urinary"),
    "urinary": ("urinary tract infection", "urinary"),
    "kencing": ("urinary tract infection", "urinary"),
    "dehydration": ("volume depletion", "dehydration"),
    "dehidrasi": ("volume depletion", "dehydration"),
}


def _stem(kw: str) -> str:
    kw = kw.lower().strip()
    kw = kw.replace("oe", "o").replace("ae", "e")
    return kw[: max(4, len(kw) - 2)] if len(kw) > 5 else kw


def expand_keywords(keywords: list[str]) -> list[str]:
    """Ekspansi kata kunci pencarian menggunakan kamus sinonim medis dan pemecahan frasa."""
    expanded: list[str] = []
    seen: set[str] = set()

    for kw in keywords:
        clean = kw.strip().lower()
        if not clean:
            continue
        if clean not in seen:
            expanded.append(clean)
            seen.add(clean)

        for syn in MEDICAL_SYNONYMS.get(clean, ()):
            s_clean = syn.lower().strip()
            if s_clean and s_clean not in seen:
                expanded.append(s_clean)
                seen.add(s_clean)

        words = clean.split()
        if len(words) > 1:
            for w in words:
                if w not in seen:
                    expanded.append(w)
                    seen.add(w)
                for syn in MEDICAL_SYNONYMS.get(w, ()):
                    s_clean = syn.lower().strip()
                    if s_clean and s_clean not in seen:
                        expanded.append(s_clean)
                        seen.add(s_clean)

    return expanded


def tokenisasi(teks: str) -> list[str]:
    return [t for t in re.findall(r"[a-z]+", teks.lower()) if len(t) >= 3 and t not in STOPWORDS]


class IndeksICD10:
    """Indeks pencarian cepat untuk katalog ICD-10 menggunakan inverted index TF-IDF."""

    def __init__(self, rows: tuple[IcdRow, ...]):
        pasangan = [
            (r.code.strip(), r.display.strip())
            for r in rows
            if r.code and r.display and not r.code.strip().upper().startswith(KECUALIKAN_AWALAN_KODE)
        ]
        self.kode = [k for k, _ in pasangan]
        self.display = [d for _, d in pasangan]
        self.inverted = defaultdict(set)
        self.n_token = []
        for i, teks in enumerate(self.display):
            toks = tokenisasi(teks)
            self.n_token.append(max(1, len(toks)))
            for t in set(toks):
                self.inverted[t].add(i)
        n = len(self.display)
        self.idf = {t: 1.0 + math.log((n + 1) / (len(ids) + 1)) for t, ids in self.inverted.items()}
        self.vocab = list(self.inverted)

    def _cocok(self, qt: str):
        if len(qt) < 5:
            vocab_cocok = [qt] if qt in self.inverted else []
        else:
            awalan = qt[: max(5, len(qt) - 3)]
            vocab_cocok = [v for v in self.vocab if v.startswith(awalan)]
        baris = set()
        for v in vocab_cocok:
            baris |= self.inverted[v]
        return baris, max((self.idf[v] for v in vocab_cocok), default=0.0)

    def cari(self, keywords: list[str], top_n: int = JUMLAH_KANDIDAT) -> list[tuple[str, str]]:
        skor = defaultdict(float)
        for kw in keywords:
            kw_clean = kw.strip().upper()
            # Kecocokan langsung jika kata kunci berupa kode ICD (mis. "A01", "R50.9")
            if re.match(r"^[A-Z]\d{2}(\.\d+)?$", kw_clean):
                for i, c in enumerate(self.kode):
                    if c == kw_clean:
                        skor[i] += 25.0
                    elif c.startswith(kw_clean + ".") or kw_clean.startswith(c + "."):
                        skor[i] += 15.0
                continue

            qtoks = list(dict.fromkeys(tokenisasi(kw)))
            if not qtoks:
                continue
            hasil_tok = [self._cocok(qt) for qt in qtoks]
            semua = set.intersection(*(b for b, _ in hasil_tok)) if len(qtoks) > 1 else set()
            for baris, bobot in hasil_tok:
                for i in (baris & semua if semua else baris):
                    skor[i] += bobot
            for i in semua:
                skor[i] += 2.0

        urut = sorted(skor, key=lambda i: skor[i] / (self.n_token[i] ** 0.5), reverse=True)[:top_n]
        return [(self.kode[i], self.display[i]) for i in urut]


@lru_cache(maxsize=4)
def get_icd_index(rows: tuple[IcdRow, ...]) -> IndeksICD10:
    return IndeksICD10(rows)

_indeks_dari_rows = get_icd_index


def retrieve(rows: tuple[IcdRow, ...], keywords: list[str], limit: int = 50) -> list[IcdRow]:
    """Pencarian kandidat ICD-10 dengan ekspansi sinonim dan perankingan TF-IDF."""
    all_kws = expand_keywords(keywords)
    if not all_kws:
        return []
    idx = get_icd_index(rows)
    kandidat = idx.cari(all_kws, top_n=limit)
    by_code = {r.code: r for r in rows}
    return [by_code[code] for code, _ in kandidat if code in by_code]


def postprocess(
    utama: Any = None,
    sekunder: Any = None,
    rows: tuple[IcdRow, ...] | None = None,
    k: int = 3,
) -> dict[str, list] | list[dict]:
    """Filter usulan ICD-10 dengan 4 aturan wajib:
    a. Buang kode yang tidak ada di rows (katalog CSV).
    b. Buang kode penyebab eksternal berawalan V, W, X, Y.
    c. Buang kode induk (misal R10) jika turunannya (misal R10.1) terpilih dalam grup yang sama.
    d. Buang kode dari sekunder jika sudah muncul di utama (serta hindari duplikat antar-grup sekunder).

    Mendukung format masukan terpisah (utama, sekunder, rows), objek hasil rerank,
    maupun pemanggilan kompatibilitas lama (picks, rows).
    """
    # Deteksi pemanggilan lama postprocess(picks, rows)
    if rows is None and isinstance(sekunder, (tuple, list)):
        if not sekunder or isinstance(sekunder[0], IcdRow) or hasattr(sekunder[0], "code"):
            rows = tuple(sekunder)
            sekunder = None

    # Normalisasi bila masukan utama berupa dict atau objek model (IcdRerankResult)
    if isinstance(utama, dict):
        if "sekunder" in utama and sekunder is None:
            sekunder = utama.get("sekunder")
        utama = utama.get("utama", [])
    elif hasattr(utama, "utama") and hasattr(utama, "sekunder"):
        if sekunder is None:
            sekunder = getattr(utama, "sekunder", [])
        utama = getattr(utama, "utama", [])

    rows_tuple = rows or ()
    # Aturan a & b: Hanya kode yang ada di rows dan BUKAN berawalan V, W, X, Y
    by_code = {
        r.code.strip().upper(): r
        for r in rows_tuple
        if r.code and not r.code.strip().upper().startswith(KECUALIKAN_AWALAN_KODE)
    }

    def _clean_item(p) -> dict | None:
        if isinstance(p, dict):
            code = str(p.get("code") or "").strip().upper()
            deskripsi = str(p.get("deskripsi_id") or "").strip()
            alasan = str(p.get("alasan") or "").strip()
            try:
                keyakinan = float(p.get("keyakinan", 0.0))
            except (ValueError, TypeError):
                keyakinan = 0.0
        else:
            code = str(getattr(p, "code", "") or "").strip().upper()
            deskripsi = str(getattr(p, "deskripsi_id", "") or "").strip()
            alasan = str(getattr(p, "alasan", "") or "").strip()
            try:
                keyakinan = float(getattr(p, "keyakinan", 0.0))
            except (ValueError, TypeError):
                keyakinan = 0.0

        if not code or code not in by_code:
            return None

        row = by_code[code]
        return {
            "code": code,
            "display": row.display,
            "deskripsi_id": deskripsi or row.display,
            "keyakinan": round(max(0.0, min(1.0, keyakinan)), 2),
            "alasan": alasan,
        }

    def _dedupe_parent_child(items: list[dict]) -> list[dict]:
        # Aturan c: Buang kode induk (misal R10) jika turunannya (misal R10.1) terpilih dalam grup yang sama
        codes_in_group = {it["code"] for it in items}
        result = []
        for it in items:
            code = it["code"]
            has_child = any(o != code and o.startswith(code + ".") for o in codes_in_group)
            if not has_child:
                result.append(it)
        return result

    # 1. Proses grup UTAMA
    raw_utama = list(utama or [])
    cleaned_utama: list[dict] = []
    seen_in_utama: set[str] = set()

    for it in sorted(raw_utama, key=lambda x: -getattr(x, "keyakinan", 0.0) if not isinstance(x, dict) else -float(x.get("keyakinan", 0.0))):
        cl = _clean_item(it)
        if cl and cl["code"] not in seen_in_utama:
            seen_in_utama.add(cl["code"])
            cleaned_utama.append(cl)

    chosen_utama = _dedupe_parent_child(cleaned_utama)[:k]
    seen_codes = {c["code"] for c in chosen_utama}

    # Jika sekunder tidak diberikan (pemanggilan lama), kembalikan list utama saja
    if sekunder is None:
        return chosen_utama

    # 2. Proses grup-grup SEKUNDER
    chosen_sekunder: list[list[dict]] = []
    raw_groups = list(sekunder)
    for grp in raw_groups:
        if hasattr(grp, "pilihan"):
            items = getattr(grp, "pilihan") or []
        elif isinstance(grp, dict) and "pilihan" in grp:
            items = grp.get("pilihan") or []
        elif isinstance(grp, (list, tuple)):
            items = grp
        else:
            items = [grp] if grp else []

        cleaned_group: list[dict] = []
        seen_in_group: set[str] = set()

        for it in sorted(items, key=lambda x: -getattr(x, "keyakinan", 0.0) if not isinstance(x, dict) else -float(x.get("keyakinan", 0.0))):
            cl = _clean_item(it)
            if not cl:
                continue
            code = cl["code"]
            # Aturan d: Buang kode dari sekunder jika sudah muncul di utama
            # serta hindari duplikat antar-grup sekunder
            if code in seen_codes or code in seen_in_group:
                continue
            seen_in_group.add(code)
            cleaned_group.append(cl)

        # Aturan c: Buang kode induk jika turunannya terpilih dalam grup yang sama
        final_group = _dedupe_parent_child(cleaned_group)[:k]
        if final_group:
            seen_codes.update(c["code"] for c in final_group)
            chosen_sekunder.append(final_group)

    return {
        "utama": chosen_utama,
        "sekunder": chosen_sekunder,
    }
