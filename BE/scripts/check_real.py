"""Cek koneksi asli: Gemini dan SATUSEHAT sandbox. Tidak pernah mencetak rahasia.

  python scripts/check_real.py            # LLM + token + baca data master sandbox
  python scripts/check_real.py --send     # juga kirim 1 bundle uji ke sandbox (membuat data dummy baru)
"""
import argparse
import json
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import get_settings  # noqa: E402
from app.fhir.builder import build_bundle  # noqa: E402
from app.fhir.precheck import check_bundle  # noqa: E402
from app.satusehat.client import SatusehatClient, outcome_codes, parse_entry_ids  # noqa: E402
from app.scribe.asr import parse_text_transcript  # noqa: E402
from app.scribe.extract import extract_subjective, label_speakers, suggest_icd  # noqa: E402
from app.scribe.icd import icd_table  # noqa: E402
from app.scribe.llm import LLM  # noqa: E402

TRANSKRIP = """Siang Bu, silakan duduk. Ini adik Raka ya, keluhannya apa Bu?
Siang Dok. Ini Raka ket wingi isuk awakke sumer panas tinggi banget Dok, terus anaknya sambat sirahne ngelu, badannya lemes nggak mau main.
Di rumah udah dikasih obat apa aja Bu? Ada mimisan, gusi berdarah, atau muntah nggak?
Kemarin malam sempat saya kasih tempelan kompres demam aja Dok, belum berani kasih obat minum. Mimisan nggak ada, cuma tadi pagi sempat mual mau muntah pas disuapin bubur.
Sebelumnya Raka pernah sakit kayak gini atau ada alergi obat nggak Bu?
Nggak pernah Dok, baru kali ini. Kalau alergi obat kayaknya nggak ada, tapi kalau makan udang kadang gatal-gatal kulitnya."""

OK, FAIL, SKIP = "[OK]", "[GAGAL]", "[LEWAT]"
sys.stdout.reconfigure(encoding="utf-8")


def check_llm(s):
    print("\n=== LLM ===")
    if not s.gemini_api_key:
        print(f"{SKIP} Gemini: API key kosong")
        return
    llm = LLM(s.model_copy(update={"llm_providers": "gemini"}))
    segs = parse_text_transcript(TRANSKRIP)  # tanpa label: uji juga penandaan pembicara
    try:
        t0 = time.perf_counter()
        segs, _ = label_speakers(segs, llm)
        t1 = time.perf_counter()
        subj, m2 = extract_subjective(segs, llm)
        t2 = time.perf_counter()
        icd, meta = suggest_icd(subj, icd_table(s), llm)
        t3 = time.perf_counter()
    except Exception as e:
        print(f"{FAIL} Gemini: {e}")
        return
    print(f"{OK} Gemini ({m2}) pembicara {t1 - t0:.1f}s, S {t2 - t1:.1f}s, ICD {t3 - t2:.1f}s")
    print("   pembicara:", [x["speaker"] for x in segs])
    for k in ("keluhan_utama", "riwayat_penyakit_sekarang", "riwayat_alergi", "riwayat_pengobatan"):
        f = subj[k]
        print(f"   {k}: [{f['status']}, grounding {f['grounding']}] {f['nilai']}")
    print("   alergi:", [(a["zat"], a["kategori"], a["kepastian"]) for a in subj["alergi_terstruktur"]])
    print("   disangkal:", subj["gejala_disangkal"])
    print("   rangkuman:", subj["rangkuman_s"])
    print("   ICD kata kunci:", meta.get("keywords"), "| kandidat:", meta.get("candidates"))
    for c in icd:
        print(f"   ICD {c['code']} {c['display']} ({c['keyakinan']}) - {c['alasan']}")


def check_satusehat(s, send: bool):
    print("\n=== SATUSEHAT sandbox ===")
    if not (s.satusehat_client_id and s.satusehat_client_secret):
        print(f"{SKIP} client_id/secret kosong")
        return
    c = SatusehatClient(s)
    try:
        c._get_token()
        print(f"{OK} token terbit, berlaku ±{int(c._token_exp - time.time())} detik")
    except Exception as e:
        print(f"{FAIL} token: {e} (cek SATUSEHAT_AUTH_URL dan kredensial)")
        return
    for path in (f"/Organization/{s.satusehat_org_id}", "/Location/b22b4bc9-abbc-4cde-80e8-089ec10bcaea",
                 "/Patient/P02478375538", "/Practitioner/100009880728"):
        r = c._request("GET", path)
        name = r.json().get("name") if r.status_code == 200 else None
        print(f"{OK if r.status_code == 200 else FAIL} GET {path} -> {r.status_code} {str(name)[:60] if name else ''}")
    if not send:
        print(f"{SKIP} kirim bundle (jalankan dengan --send)")
        return
    now = datetime.now(timezone.utc)
    code = f"CHK-{now:%Y%m%d%H%M%S}"
    snap = {
        "visit": {"code": code, "arrived_at": (now - timedelta(minutes=40)).isoformat(),
                  "started_at": (now - timedelta(minutes=30)).isoformat(), "ended_at": (now - timedelta(minutes=5)).isoformat()},
        "patient": {"ihs_number": "P02478375538"}, "practitioner": {"satusehat_id": "100009880728"},
        "location": {"satusehat_id": "b22b4bc9-abbc-4cde-80e8-089ec10bcaea", "name": "Ruang Poli Anak",
                     "service_type_code": "394537008", "service_type_display": "Pediatrics"},
        "subjective_summary": "Demam sejak kemarin pagi, nyeri kepala, lemas, mual. Alergi udang (gatal).",
        "vitals": {"body_temperature": 38.9, "body_weight": 17.5, "heart_rate": 118, "respiratory_rate": 26,
                   "oxygen_saturation": 98},
        "diagnoses": [{"code": "R50.9", "display": "Fever, unspecified", "rank": 1}],
        "assessment": "Demam akut hari ke-2, tanda bahaya tidak ada.",
        "prescriptions": [{"kfa_code": "93001926", "dose_value": 7.5, "frequency": 1, "period": 4, "period_max": 6,
                           "period_unit": "h", "as_needed_text": "demam", "as_needed_fever": True,
                           "duration_days": 3, "quantity": 1, "patient_instruction": "7,5 ml tiap 4-6 jam bila demam"}],
        "approved_at": now.isoformat(),
    }
    bundle = build_bundle(snap, s.satusehat_org_id)
    assert not check_bundle(bundle), check_bundle(bundle)
    r = c.post_bundle(bundle)
    if r.status_code in (200, 201):
        print(f"{OK} bundle {code}: HTTP {r.status_code}")
        for (t, rid), e in zip(parse_entry_ids(r.body), bundle["entry"]):
            print(f"   {e['resource']['resourceType']:<18} -> {t} {rid}")
        r2 = c.post_bundle(bundle)
        codes, _ = outcome_codes(r2.body)
        print(f"{OK if r2.status_code >= 400 else FAIL} kirim ulang identik -> HTTP {r2.status_code} {sorted(codes)}")
        ident = bundle["entry"][0]["resource"]["identifier"][0]
        print(f"{OK} rekonsiliasi: Encounter via identifier -> {c.find_encounter(ident['system'], ident['value'])}")
    else:
        codes, text = outcome_codes(r.body)
        print(f"{FAIL} bundle ditolak HTTP {r.status_code} {sorted(codes)}: {text}")
        Path("last_rejected_bundle.json").write_text(json.dumps(r.body, indent=2, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--send", action="store_true")
    a = ap.parse_args()
    s = get_settings()
    check_llm(s)
    check_satusehat(s, a.send)
