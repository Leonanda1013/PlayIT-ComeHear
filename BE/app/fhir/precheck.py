"""Pra-periksa bundle sebelum dikirim.

Sandbox SATUSEHAT longgar pada nilai tetapi ketat pada format rujukan (10119, 10120,
10391, 10393) dan keberadaan target (reference_not_found). Error itu ditangkap di sini
supaya tidak menghabiskan percobaan kirim.
"""
import re
from datetime import datetime, timezone

from app.fhir.codes import DRUGS

UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
IHS_RE = re.compile(r"^P\d{8,}$")
ICD_RE = re.compile(r"^[A-Z]\d{2}(\.\d{1,2})?$")


def check_snapshot(snap: dict, org_id: str) -> list[str]:
    errors = []
    now = datetime.now(timezone.utc)
    times = {}
    for key in ("arrived_at", "started_at", "ended_at"):
        raw = snap["visit"].get(key)
        if not raw:
            if key == "arrived_at":
                errors.append("Waktu kedatangan/pemeriksaan aktual belum tercatat.")
            continue
        try:
            dt = datetime.fromisoformat(raw)
            dt = dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)
            times[key] = dt
            if dt > now:
                errors.append(f"Waktu {key} masih di masa depan; periksa tanggal kunjungan.")
        except ValueError:
            errors.append(f"Format waktu {key} tidak valid.")
    if times.get("arrived_at") and times.get("started_at") and times["arrived_at"] > times["started_at"]:
        errors.append("Waktu kedatangan lebih akhir daripada mulai pemeriksaan.")
    if times.get("started_at") and times.get("ended_at") and times["started_at"] > times["ended_at"]:
        errors.append("Waktu mulai pemeriksaan lebih akhir daripada selesai.")
    if not IHS_RE.match(snap["patient"].get("ihs_number") or ""):
        errors.append("Pasien belum punya nomor IHS SATUSEHAT (cari lewat NIK dulu).")
    if not (snap["practitioner"].get("satusehat_id") or "").strip():
        errors.append("Dokter belum punya ID Practitioner SATUSEHAT.")
    if not UUID_RE.match(snap["location"].get("satusehat_id") or ""):
        errors.append("ID Location SATUSEHAT kosong atau bukan UUID.")
    if not UUID_RE.match(org_id or ""):
        errors.append("SATUSEHAT_ORG_ID kosong atau bukan UUID.")
    dx = snap.get("diagnoses") or []
    if not dx:
        errors.append("Belum ada diagnosis yang dikonfirmasi dokter.")
    if dx and not any(d["rank"] == 1 for d in dx):
        errors.append("Tidak ada diagnosis primer (rank 1).")
    for d in dx:
        if not ICD_RE.match(d.get("code") or ""):
            errors.append(f"Kode ICD-10 tidak valid: {d.get('code')!r}")
    for rx in snap.get("prescriptions") or []:
        if rx.get("kfa_code") not in DRUGS:
            errors.append(f"Obat tanpa kode KFA terdaftar: {rx.get('kfa_code')!r}")
        if not rx.get("dose_value") or not rx.get("period"):
            errors.append("Resep belum lengkap (dosis atau frekuensi kosong).")
    return errors


def check_bundle(bundle: dict) -> list[str]:
    """Semua rujukan urn:uuid harus menunjuk entri di bundle yang sama."""
    errors = []
    urls = {e["fullUrl"] for e in bundle["entry"]}

    def walk(node, path):
        if isinstance(node, dict):
            ref = node.get("reference")
            if isinstance(ref, str):
                if ref.startswith("urn:uuid:") and ref not in urls:
                    errors.append(f"{path}: rujukan {ref} tidak ada di bundle")
                if ref.endswith("/") or ref.endswith("/None") or "{{" in ref:
                    errors.append(f"{path}: rujukan kosong {ref!r}")
            for k, v in node.items():
                walk(v, f"{path}.{k}")
        elif isinstance(node, list):
            for i, v in enumerate(node):
                walk(v, f"{path}[{i}]")

    for i, e in enumerate(bundle["entry"]):
        walk(e["resource"], f"entry[{i}].{e['resource']['resourceType']}")
    return errors
