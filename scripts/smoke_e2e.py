"""Uji asap ujung ke ujung lewat HTTP (mock LLM + mock SATUSEHAT, tanpa internet).

Jalankan dengan environment terisolasi, mis.:
  DATABASE_URL=sqlite:///./smoke.db LLM_PROVIDERS=mock SATUSEHAT_MODE=mock python scripts/smoke_e2e.py
Alur: login perawat -> daftar kunjungan -> persetujuan -> transkrip teks -> pipeline ->
login dokter -> review + vital + diagnosis + resep -> setujui -> worker kirim -> SENT.
"""
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app, settings  # noqa: E402

TRANSKRIP = """Dokter: Siang Bu, silakan duduk. Keluhannya apa?
Ibu: Ini Raka ket wingi isuk awakke sumer panas tinggi banget Dok, terus sirahne ngelu, lemes nggak mau main.
Dokter: Di rumah sudah dikasih obat apa? Ada mimisan atau muntah?
Ibu: Kemarin malam cuma saya kompres Dok. Mimisan nggak ada, tadi pagi mual mau muntah.
Dokter: Pernah sakit seperti ini? Ada alergi?
Ibu: Belum pernah Dok. Alergi obat kayaknya nggak ada, tapi kalau makan udang gatal-gatal."""


def login(c: TestClient, username: str):
    r = c.post("/login", data={"username": username, "password": settings.demo_password}, follow_redirects=False)
    assert r.status_code == 303, r.text


def main():
    with TestClient(app) as c:
        login(c, "perawat")
        page = c.get("/").text
        pid = re.search(r'name="patient_id"[^>]*>\s*<option value="(\d+)"', page).group(1)
        r = c.post("/visits", data={"patient_id": pid, "practitioner_id": 1, "location_id": 1}, follow_redirects=False)
        vid = int(r.headers["location"].rsplit("/", 1)[1])

        r = c.post(f"/visits/{vid}/transcript-text", data={"transcript": "Dokter: tes"}, follow_redirects=False)
        assert r.status_code == 403, "harus ditolak sebelum ada persetujuan"
        c.post(f"/visits/{vid}/consent", data={"given_by_name": "Ibu Demo", "relation": "ibu", "agree": "ya"})
        c.post(f"/visits/{vid}/transcript-text", data={"transcript": TRANSKRIP})
        for _ in range(360):
            if "s-done" in c.get(f"/visits/{vid}").text:
                break
            time.sleep(0.5)
        else:
            raise SystemExit("pipeline tidak selesai")

        r = c.post(f"/visits/{vid}/review", data={"summary": "x", "action": "approve"}, follow_redirects=False)
        assert r.status_code == 403, "perawat tidak boleh menyetujui"  # ditolak di approve_and_queue
        login(c, "dokter")
        review = c.get(f"/visits/{vid}/review").text
        assert "Bukti [" in review, "kutipan sumber harus tampil"
        codes = re.findall(r'name="dx_code" value="([^"]+)"', review)
        form = {f"s_{k}": v for k, v in re.findall(r'name="s_(\w+)" rows="2">([^<]*)<', review)}
        form.update({
            "summary": "Demam sejak kemarin pagi disertai nyeri kepala, lemas, mual. Riwayat alergi udang (gatal).",
            "vital_body_temperature": "38,9", "vital_body_weight": "17.5",
            "dx_code": codes[:1], "dx_primary": codes[0], "assessment": "Demam akut hari ke-2.",
            "rx_enabled": "ya", "rx_kfa": "93001926", "rx_dose": "7,5", "rx_period": "4", "rx_period_max": "6",
            "rx_prn": "demam", "rx_duration": "3", "rx_qty": "1",
            "rx_instruction": "Parasetamol 7,5 ml tiap 4-6 jam bila demam", "action": "approve"})
        r = c.post(f"/visits/{vid}/review", data=form, follow_redirects=False)
        assert "/status" in r.headers["location"], r.headers["location"]

        for _ in range(240):
            status = c.get(f"/visits/{vid}/status").text
            if "s-SENT" in status:
                break
            time.sleep(0.25)
        else:
            raise SystemExit("bundle tidak terkirim:\n" + status[:3000])
        assert c.post(f"/visits/{vid}/review", data=form, follow_redirects=False).status_code == 409
        dash = c.get("/dashboard").text
        assert "Rasio koreksi" in dash
        print(f"OK: kunjungan {vid} terkirim (SATUSEHAT_MODE={settings.satusehat_mode}, LLM={settings.llm_providers}), ICD usulan {codes}")


if __name__ == "__main__":
    main()
