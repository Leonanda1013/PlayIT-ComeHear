"""Menyimpan isian layar konsultasi (S, O-A-P, Verifikasi) ke ClinicalNote.

Setiap langkah hanya mengirim sebagian isian. Hanya kunci yang ADA di form yang diperbarui,
supaya menyimpan O-A-P tidak menghapus S yang sedang disusun AI, dan sebaliknya.
"""
import json
import re

from app.models import ClinicalNote, Visit
from app.scribe.icd import IcdRow
from app.scribe.schemas import SUBJECTIVE_FIELDS

ICD_CODE = re.compile(r"\b([A-Z]\d{2}(?:\.\d{1,2})?)\b")
NUMERIC_VITALS = {  # nama input -> kunci VITALS
    "suhu": "body_temperature", "spo2": "oxygen_saturation", "bb": "body_weight", "tb": "body_height",
    "rr": "respiratory_rate", "nadi": "heart_rate",
}
EXTRA_FIELDS = ("gcs", "kesadaran", "lingkar_perut", "alergi", "instruksi", "evaluasi")
KESADARAN = ["Compos Mentis", "Apatis", "Somnolen", "Sopor", "Koma"]


def _num(raw: str | None) -> float | None:
    raw = (raw or "").replace(",", ".").strip()
    try:
        return float(raw) if raw else None
    except ValueError:
        return None


def parse_codes(raw: str | None) -> list[str]:
    return [m.upper() for m in ICD_CODE.findall((raw or "").upper())]


def apply_form(note: ClinicalNote, visit: Visit, form, rows: dict[str, IcdRow]) -> list[str]:
    """Kembalikan daftar pesan galat validasi (kosong bila semua baik)."""
    errors: list[str] = []

    # --- S ---
    if "summary" in form:
        note.subjective_summary = (form.get("summary") or "").strip()
    if any(f"s_{k}" in form for k in SUBJECTIVE_FIELDS):
        subj = dict(note.subjective or {})
        for k in SUBJECTIVE_FIELDS:
            if f"s_{k}" in form:
                subj[k] = (form.get(f"s_{k}") or "").strip()
        note.subjective = subj

    # --- O ---
    if "suhu" in form:
        vitals = {}
        for name, key in NUMERIC_VITALS.items():
            v = _num(form.get(name))
            if v is not None:
                vitals[key] = v
            elif (form.get(name) or "").strip():
                errors.append(f"Isian {name.upper()} harus berupa angka.")
        tensi = (form.get("tensi") or "").strip()
        if tensi:
            m = re.fullmatch(r"\s*(\d{2,3})\s*/\s*(\d{2,3})\s*", tensi)
            if m:
                vitals["systolic"], vitals["diastolic"] = float(m.group(1)), float(m.group(2))
            else:
                errors.append("Tekanan darah ditulis seperti 120/80.")
        note.vitals = vitals
    if "exam_text" in form:
        note.exam_text = (form.get("exam_text") or "").strip()
    extra = dict(note.extra or {})
    for k in EXTRA_FIELDS:
        if k in form:
            extra[k] = (form.get(k) or "").strip()
    # Isian terstruktur layar O dan A-P (pemeriksaan fisik, luka, penunjang, tindakan, resep racikan, dll.)
    # disimpan utuh agar bisa dibuka ulang; ringkasannya tetap masuk exam_text/plan_text untuk FHIR.
    if "extra_json" in form:
        try:
            parsed = json.loads(form.get("extra_json") or "{}")
        except (TypeError, ValueError):
            parsed = None
        if isinstance(parsed, dict):
            extra.update({str(k): v for k, v in parsed.items()})
        else:
            errors.append("Data tambahan O/A-P tidak valid.")
    note.extra = extra

    # --- A ---
    if "dx_primary" in form:
        raw_sugg = visit.latest_session.icd_suggestions if visit.latest_session else None
        if isinstance(raw_sugg, dict):
            ai_codes = {c["code"] for c in raw_sugg.get("utama", []) if isinstance(c, dict) and "code" in c}
            for grp in raw_sugg.get("sekunder", []):
                items = grp if isinstance(grp, list) else [grp]
                ai_codes.update(c["code"] for c in items if isinstance(c, dict) and "code" in c)
        else:
            ai_codes = {c["code"] for c in (raw_sugg or []) if isinstance(c, dict) and "code" in c}
        codes = parse_codes(form.get("dx_primary"))[:1] + parse_codes(form.get("dx_secondary"))
        diagnoses, seen = [], set()
        for c in codes:
            if c in seen:
                continue
            seen.add(c)
            if c not in rows:
                errors.append(f"Kode ICD-10 {c} tidak ada di tabel ICD SATUSEHAT.")
                continue
            diagnoses.append({"code": c, "display": rows[c].display, "rank": len(diagnoses) + 1,
                              "source": "ai" if c in ai_codes else "dokter"})
        note.diagnoses = diagnoses

    # --- P ---
    if "plan_text" in form:
        note.plan_text = (form.get("plan_text") or "").strip()
    if "rx_present" in form:
        note.prescriptions = []
        if form.get("rx_enabled") == "ya":
            try:
                prn = (form.get("rx_prn") or "").strip()
                note.prescriptions = [{
                    "kfa_code": form.get("rx_kfa"), "dose_value": _num(form.get("rx_dose")),
                    "frequency": 1, "period": _num(form.get("rx_period")),
                    "period_max": _num(form.get("rx_period_max")), "period_unit": "h",
                    "as_needed_text": prn or None, "as_needed_fever": "demam" in prn.lower(),
                    "duration_days": int(form.get("rx_duration") or 1), "quantity": int(form.get("rx_qty") or 1),
                    "route": "oral", "patient_instruction": (form.get("rx_instruction") or "").strip()}]
            except (TypeError, ValueError):
                errors.append("Isian resep terstruktur belum lengkap atau bukan angka.")

    # Rasional klinis (ClinicalImpression.summary) disusun dari diagnosis kerja + evaluasi dokter.
    parts = []
    if note.diagnoses:
        parts.append(f"Diagnosis kerja: {note.diagnoses[0]['code']} {note.diagnoses[0]['display']}.")
    if (note.extra or {}).get("evaluasi"):
        parts.append(note.extra["evaluasi"])
    if "assessment_text" in form:
        note.assessment = (form.get("assessment_text") or "").strip()
    elif "dx_primary" in form or "evaluasi" in form:
        note.assessment = " ".join(parts)
    return errors
