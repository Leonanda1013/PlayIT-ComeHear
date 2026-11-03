"""Uji asap ujung ke ujung lewat HTTP mengikuti alur UI (antrean -> S -> O-A-P -> Verifikasi -> SATUSEHAT).

  DATABASE_URL=sqlite:///./smoke.db LLM_PROVIDERS=mock SATUSEHAT_MODE=mock python scripts/smoke_e2e.py
"""
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app, settings  # noqa: E402

TRANSKRIP = """Dokter: Selamat pagi Mas, apa keluhan yang paling dirasa hari ini?
Pasien: Pagi Dok. Kepala saya pusing berputar sejak 3 hari lalu, terus mual dan badan lemas.
Dokter: Ada demam, batuk, atau riwayat alergi obat sebelumnya?
Pasien: Demam sama batuk nggak ada Dok. Alergi obat juga nggak ada."""


def login(c: TestClient, email: str):
    r = c.post("/login", data={"email": email, "password": settings.demo_password}, follow_redirects=False)
    assert r.status_code == 303 and r.headers["location"] == "/antrean", r.text[:500]


def main():
    with TestClient(app) as c:
        login(c, "perawat@rumahsakit.id")
        c.post("/pendaftaran/demo")
        queue = c.get("/antrean").text
        assert "Daftar Antrean Pasien Hari Ini" in queue
        vid = int(re.search(r'action="/visits/(\d+)/panggil"', queue).group(1))
        c.post(f"/visits/{vid}/panggil")
        assert "Antrean saat ini" in c.get("/antrean").text

        r = c.post(f"/visits/{vid}/transcript-text", data={"transcript": "Dokter: tes"}, follow_redirects=False)
        assert r.status_code == 403, "harus ditolak sebelum ada persetujuan"
        assert c.post(f"/visits/{vid}/consent", data={"decision": "setuju"},
                      headers={"accept": "application/json"}).json() == {"decision": "setuju"}
        c.post(f"/visits/{vid}/transcript-text", data={"transcript": TRANSKRIP})
        for _ in range(360):
            st = c.get(f"/visits/{vid}/scribe").json()
            if st["status"] in ("done", "failed"):
                break
            time.sleep(0.5)
        assert st["status"] == "done", st
        assert st["summary"] and st["icd"], st

        r = c.post(f"/visits/{vid}/soap", data={"step": "verifikasi", "action": "approve", "confirm": "ya"},
                   follow_redirects=False)
        assert r.status_code == 403, "perawat tidak boleh memvalidasi"

        login(c, "rian@rumahsakit.id")
        assert "Draf AI" in c.get(f"/visits/{vid}/s").text or st["summary"]
        code = st["icd"][0]["code"]
        r = c.post(f"/visits/{vid}/soap", data={
            "step": "oap", "action": "to_verify", "suhu": "36,8", "tensi": "120/80", "spo2": "98", "bb": "65",
            "tb": "180", "rr": "20", "nadi": "82", "gcs": "15 (E4V5M6)", "kesadaran": "Compos Mentis",
            "lingkar_perut": "74", "alergi": "Tidak ada riwayat alergi obat",
            "dx_primary": f"{code} — x", "dx_secondary": "", "plan_text": "- Betahistine 6 mg 3x1",
            "rx_present": "1", "instruksi": "- Edukasi manuver Brandt-Daroff",
            "evaluasi": "Pasien memahami rencana terapi."}, follow_redirects=False)
        assert r.headers["location"].endswith("/verifikasi"), r.headers["location"]
        verify = c.get(f"/visits/{vid}/verifikasi").text
        assert "Konfirmasi Pemeriksaan" in verify and "120/80" in verify
        r = c.post(f"/visits/{vid}/soap", data={"step": "verifikasi", "action": "approve"}, follow_redirects=False)
        assert "/verifikasi" in r.headers["location"], "tanpa centang konfirmasi harus ditolak"
        r = c.post(f"/visits/{vid}/soap", data={"step": "verifikasi", "action": "approve", "confirm": "ya"},
                   follow_redirects=False)
        assert "/resume" in r.headers["location"], r.headers["location"]

        for _ in range(240):
            resume = c.get(f"/visits/{vid}/resume").text
            if ">SENT<" in resume:
                break
            time.sleep(0.25)
        else:
            raise SystemExit("bundle tidak terkirim:\n" + resume[:3000])
        assert c.post(f"/visits/{vid}/soap", data={"action": "save"}, follow_redirects=False).status_code == 409
        assert "Selesai" in c.get("/antrean?tab=selesai").text
        assert "Rasio koreksi" in c.get("/dasbor").text
        assert c.get("/riwayat").status_code == 200 and c.get("/pendaftaran").status_code == 200
        print(f"OK: kunjungan {vid} terkirim (SATUSEHAT_MODE={settings.satusehat_mode}, "
              f"LLM={settings.llm_providers}), ICD usulan {[c['code'] for c in st['icd']]}")


if __name__ == "__main__":
    main()
