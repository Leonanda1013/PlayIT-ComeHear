"""Usulan ICD-10 dari anamnesis (S) dengan retrieval + pemilihan LLM.

Perbaikan dari notebook Nisa:
- kandidat diurutkan menurut skor kecocokan kata kunci, bukan urutan baris CSV
  (dulu .head(40) membuang kode gejala bab R seperti R50.9 dan R51);
- kode hasil LLM divalidasi ulang terhadap CSV (tidak bisa mengarang kode);
- induk dan turunan tidak muncul bersamaan (A01 dibuang bila A01.0 dipilih).
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


def _stem(kw: str) -> str:
    kw = kw.lower().strip()
    # diarrhea/diarrhoea, anaemia/anemia: cocokkan awalan agar ejaan Inggris/Amerika sama-sama kena
    return kw.replace("oe", "o").replace("ae", "e")[: max(4, len(kw) - 2)] if len(kw) > 5 else kw


def retrieve(rows: tuple[IcdRow, ...], keywords: list[str], limit: int = 50) -> list[IcdRow]:
    stems = [_stem(k) for k in keywords if k.strip()]
    if not stems:
        return []
    pats = [re.compile(rf"\b{re.escape(s)}") for s in stems]
    scored = []
    for row in rows:
        disp = row.display.lower().replace("oe", "o").replace("ae", "e")
        hits = sum(1 for p in pats if p.search(disp))
        if hits:
            # lebih banyak kata kunci cocok lebih baik; display pendek (umum) didahulukan
            scored.append((-hits, len(row.display), row.code, row))
    scored.sort()
    return [r for *_, r in scored[:limit]]


def postprocess(picks, rows: tuple[IcdRow, ...], k: int = 3) -> list[dict]:
    by_code = {r.code: r for r in rows}
    chosen: list[dict] = []
    for p in sorted(picks, key=lambda p: -p.keyakinan):
        code = p.code.strip().upper()
        if code not in by_code or any(c["code"] == code for c in chosen):
            continue
        chosen.append({"code": code, "display": by_code[code].display, "deskripsi_id": p.deskripsi_id,
                       "keyakinan": round(max(0.0, min(1.0, p.keyakinan)), 2), "alasan": p.alasan})
    codes = {c["code"] for c in chosen}
    chosen = [c for c in chosen if not any(o != c["code"] and o.startswith(c["code"] + ".") for o in codes)]
    return chosen[:k]
