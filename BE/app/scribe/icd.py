"""Usulan ICD-10 dari anamnesis (S) dengan retrieval cerdas + pemilihan LLM.

Peningkatan algoritma retrieval:
- Pemetaan sinonim medis terbalik (reverse mapping) untuk istilah Indonesia/Jawa/Inggris;
- Ekspansi kata kunci otomatis (mis. "kejang" -> convulsion/febrile, "diare" -> diarrhoea/gastroenteritis);
- Pencocokan multi-tier: exact code match, code prefix, exact phrase, whole-word, dan stem match;
- Bobot co-occurrence: kandidat yang mencakup beberapa kata kunci sekaligus mendapat skor eksponensial;
- Kode spesifik (turunan 4-karakter bertitik) diprioritaskan saat skor kata kunci seimbang;
- Post-processing: deduping kode induk vs turunan (A01 dibuang jika A01.0 dipilih) dan validasi katalog resmi.
"""
import csv
import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from app.config import Settings


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
        rows = [IcdRow(r["CODE"].strip(), r["DISPLAY"].strip()) for r in csv.DictReader(f, dialect=dialect)
                if r.get("CODE") and r.get("DISPLAY")]
    return tuple(rows)


def icd_table(s: Settings) -> tuple[IcdRow, ...]:
    path = s.icd10_csv if Path(s.icd10_csv).exists() else s.icd10_seed_csv
    return load_icd(str(path))


# Pemetaan sinonim medis terbalik (reverse mapping): istilah bahasa Indonesia/Jawa/Inggris
# yang dipetakan ke kata kunci pencarian resmi di kamus ICD-10 WHO/SATUSEHAT.
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
    # Penyelarasan ejaan British vs American (diarrhea/diarrhoea, anaemia/anemia)
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

        # Cek sinonim per entri utuh
        for syn in MEDICAL_SYNONYMS.get(clean, ()):
            s_clean = syn.lower().strip()
            if s_clean and s_clean not in seen:
                expanded.append(s_clean)
                seen.add(s_clean)

        # Jika entri terdiri dari beberapa kata, cek tiap kata terpisah
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


def retrieve(rows: tuple[IcdRow, ...], keywords: list[str], limit: int = 50) -> list[IcdRow]:
    all_kws = expand_keywords(keywords)
    if not all_kws:
        return []

    # Pisahkan keyword yang berbentuk kode ICD (mis. "R50", "A01.0") dan keyword teks
    code_kws = [k.upper() for k in all_kws if re.match(r"^[A-Z]\d{2}(\.\d+)?$", k, re.I)]
    text_kws = [k for k in all_kws if not re.match(r"^[A-Z]\d{2}(\.\d+)?$", k, re.I)]

    # Siapkan pola regex untuk text keywords
    text_pats = []
    for k in text_kws:
        stem = _stem(k)
        if stem:
            # Pola: kata utuh dan awalan stem
            text_pats.append((k, stem, re.compile(rf"\b{re.escape(k)}\b"), re.compile(rf"\b{re.escape(stem)}")))

    scored = []
    for row in rows:
        row_code_upper = row.code.upper()
        disp = row.display.lower().replace("oe", "o").replace("ae", "e")

        score = 0.0
        hits = 0

        # 1. Kecocokan langsung kode ICD
        for ck in code_kws:
            if row_code_upper == ck:
                score += 15.0
                hits += 1
            elif row_code_upper.startswith(ck + ".") or ck.startswith(row_code_upper + "."):
                score += 8.0
                hits += 1

        # 2. Kecocokan teks pada display
        matched_kw_stems = set()
        for raw_k, stem, exact_pat, stem_pat in text_pats:
            if " " in raw_k and raw_k in disp:
                # Kecocokan frasa multi-kata utuh (mis. "typhoid fever", "upper respiratory")
                score += 5.0
                hits += 1
                matched_kw_stems.add(stem)
            elif exact_pat.search(disp):
                score += 3.0
                hits += 1
                matched_kw_stems.add(stem)
            elif stem_pat.search(disp):
                score += 1.5
                hits += 1
                matched_kw_stems.add(stem)

        # 3. Bonus coverage (berapa banyak konsep kata kunci berbeda yang berhasil cocok)
        n_unique_matches = len(matched_kw_stems)
        if n_unique_matches > 1:
            score += (n_unique_matches ** 1.5) * 2.0

        # 4. Sedikit bonus untuk kode spesifik (bertitik, mis. A01.0 vs A01)
        if "." in row_code_upper:
            score += 0.2

        if score > 0.0:
            # Urutan: skor tertinggi (-score), lalu display terpendek/paling ringkas, lalu kode
            scored.append((-score, len(row.display), row.code, row))

    scored.sort()
    return [r for *_, r in scored[:limit]]


def postprocess(picks, rows: tuple[IcdRow, ...], k: int = 3) -> list[dict]:
    by_code = {r.code: r for r in rows}
    chosen: list[dict] = []
    for p in sorted(picks, key=lambda p: -p.keyakinan):
        code = p.code.strip().upper()
        if code not in by_code or any(c["code"] == code for c in chosen):
            continue
        deskripsi = getattr(p, "deskripsi_id", "").strip() or by_code[code].display
        chosen.append({"code": code, "display": by_code[code].display, "deskripsi_id": deskripsi,
                       "keyakinan": round(max(0.0, min(1.0, p.keyakinan)), 2), "alasan": p.alasan})
    codes = {c["code"] for c in chosen}
    chosen = [c for c in chosen if not any(o != c["code"] and o.startswith(c["code"] + ".") for o in codes)]
    return chosen[:k]
