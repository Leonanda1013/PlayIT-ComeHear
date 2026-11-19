"""Uji asap ujung ke ujung lewat HTTP mengikuti alur REST API Headless (antrean -> S -> O-A-P -> Verifikasi -> SATUSEHAT).

  DATABASE_URL=sqlite:///./smoke.db LLM_PROVIDERS=mock SATUSEHAT_MODE=mock python scripts/smoke_e2e.py
"""
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
    r = c.post("/login", data={"email": email, "password": settings.demo_password})
    assert r.status_code == 200, f"Login gagal: {r.status_code} {r.text[:500]}"
    data = r.json()
    assert data["status"] == "ok" and data.get("token")
    assert "session" in c.cookies


def main():
    with TestClient(app) as c:
        login(c, "perawat@klinikbungamelati.id")
        assert c.get("/api/me").json()["name"] == "Siti Rahmawati"
        rooms = c.get("/api/lokasi").json()
        assert [(room["name"], room["poli"]) for room in rooms] == [
            ("Bilik Konsultasi 01", "Poli Umum"), ("Bilik Konsultasi 02", "Poli Umum")]
        doctors = c.get("/api/practitioners").json()
        assert {dr["name"]: dr["default_location_id"] for dr in doctors} == {
            "dr. James Pratama": rooms[0]["id"], "dr. Kemal Suhendra": rooms[1]["id"]}
        res_demo = c.post("/pendaftaran/demo").json()
        assert res_demo["status"] == "ok"
        patient = c.get("/pendaftaran").json()["patients"][0]
        kemal = next(dr for dr in doctors if dr["name"] == "dr. Kemal Suhendra")
        assert c.post("/lokasi", json={"location_id": rooms[0]["id"]}).status_code == 200
        registration = c.post("/pendaftaran/kunjungan", json={
            "patient_id": patient["id"], "location_id": rooms[1]["id"], "practitioner_id": kemal["id"],
        })
        assert registration.status_code == 200
        new_visit = registration.json()["visit"]
        assert new_visit["location_id"] == rooms[1]["id"]

        login(c, "kemal@klinikbungamelati.id")
        kemal_queue = c.get("/antrean").json()
        assert kemal_queue["doctor"]["name"] == "dr. Kemal Suhendra"
        assert kemal_queue["location"]["id"] == rooms[1]["id"]
        assert new_visit["id"] in {v["id"] for v in kemal_queue["rows"]}

        login(c, "james@klinikbungamelati.id")
        queue_res = c.get("/antrean").json()
        assert queue_res["status"] == "ok"
        assert queue_res["doctor"]["name"] == "dr. James Pratama"
        assert queue_res["location"]["id"] == rooms[0]["id"]
        assert len(queue_res["rows"]) > 0
        vid = queue_res["rows"][0]["id"]
        other_visit = kemal_queue["rows"][0]["id"]
        assert c.post(f"/visits/{other_visit}/panggil").status_code == 403
        assert c.post(f"/visits/{other_visit}/soap", json={"action": "save"}).status_code == 403

        r_panggil = c.post(f"/visits/{vid}/panggil").json()
        assert r_panggil["status"] == "ok"

        queue_res2 = c.get("/antrean").json()
        current_rows = [r for r in queue_res2["rows"] if r["state"] == "saat_ini"]
        assert any(r["id"] == vid for r in current_rows), f"Visit {vid} tidak berstatus saat_ini: {current_rows}"

        r = c.post(f"/visits/{vid}/transcript-text", data={"transcript": "Dokter: tes"})
        assert r.status_code == 403, "harus ditolak sebelum ada persetujuan"

        consent_res = c.post(f"/visits/{vid}/consent", data={
            "decision": "setuju", "given_by_name": "Pasien Demo", "relation": "pasien"}).json()
        assert consent_res.get("decision") == "setuju"

        r_trans = c.post(f"/visits/{vid}/transcript-text", data={"transcript": TRANSKRIP}).json()
        assert r_trans["status"] == "ok"

        for _ in range(360):
            st = c.get(f"/visits/{vid}/scribe").json()
            if st["status"] in ("done", "failed"):
                break
            time.sleep(0.5)
        assert st["status"] == "done", st
        assert st["summary"] and st["icd"], st

        consult_s = c.get(f"/visits/{vid}/s").json()
        assert consult_s["status"] == "ok"
        icd_data = st["icd"]
        code = icd_data["utama"][0]["code"] if isinstance(icd_data, dict) else icd_data[0]["code"]

        r = c.post(f"/visits/{vid}/soap", data={
            "step": "oap", "action": "to_verify", "suhu": "36,8", "tensi": "120/80", "spo2": "98", "bb": "65",
            "tb": "180", "rr": "20", "nadi": "82", "gcs": "15 (E4V5M6)", "kesadaran": "Compos Mentis",
            "lingkar_perut": "74", "alergi": "Tidak ada riwayat alergi obat",
            "dx_primary": f"{code} — x", "dx_secondary": "", "plan_text": "- Betahistine 6 mg 3x1",
            "rx_present": "1", "instruksi": "- Edukasi manuver Brandt-Daroff",
            "evaluasi": "Pasien memahami rencana terapi."})
        assert r.status_code == 200 and r.json()["action"] == "to_verify"

        verify = c.get(f"/visits/{vid}/verifikasi").json()
        assert verify["status"] == "ok"
        assert verify["note"]["vitals"].get("systolic") == 120.0

        r = c.post(f"/visits/{vid}/soap", data={"step": "verifikasi", "action": "approve"})
        assert r.status_code == 400, "tanpa centang konfirmasi harus ditolak"

        r = c.post(f"/visits/{vid}/soap", data={"step": "verifikasi", "action": "approve", "confirm": "ya"})
        assert r.status_code == 200 and r.json()["action"] == "approved"

        for _ in range(240):
            resume = c.get(f"/visits/{vid}/resume").json()
            sub = resume.get("submission")
            if sub and sub.get("status") == "SENT":
                break
            time.sleep(0.25)
        else:
            raise SystemExit(f"bundle tidak terkirim: {resume}")

        assert c.post(f"/visits/{vid}/soap", data={"action": "save"}).status_code == 409

        q_selesai = c.get("/antrean?tab=selesai").json()
        assert any(r["id"] == vid for r in q_selesai["rows"])

        login(c, "perawat@klinikbungamelati.id")
        dasbor = c.get("/dasbor").json()
        assert dasbor["status"] == "ok"
        assert "correction_ratio" in dasbor

        assert c.get("/riwayat").status_code == 200
        assert c.get("/pendaftaran").status_code == 200

        icd_codes = [c['code'] for c in (st['icd']['utama'] if isinstance(st['icd'], dict) else st['icd'])]
        print(f"OK: kunjungan {vid} terkirim (SATUSEHAT_MODE={settings.satusehat_mode}, "
              f"LLM={settings.llm_providers}), ICD usulan {icd_codes}")


if __name__ == "__main__":
    main()
