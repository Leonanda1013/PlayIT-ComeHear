"""Simulasikan rekaman langsung dari berkas webm: kirim potongan tiap 5 detik ke server yang berjalan,
lalu ukur waktu dari 'Selesai' sampai bagian S dan usulan ICD tampil.

  python scripts/simulate_live.py data/audio/rekaman.webm [--url http://localhost:8000] [--speed 1.0]
"""
import argparse
import sys
import time
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.stdout.reconfigure(encoding="utf-8")
from app.config import get_settings  # noqa: E402
from app.scribe.asr import decode_audio  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("audio")
    ap.add_argument("--url", default="http://localhost:8000")
    ap.add_argument("--speed", type=float, default=1.0, help=">1 mempercepat simulasi")
    a = ap.parse_args()
    data = Path(a.audio).read_bytes()
    duration = len(decode_audio(a.audio)) / 16000
    n_chunks = max(1, round(duration / 5))
    size = -(-len(data) // n_chunks)

    c = httpx.Client(base_url=a.url, follow_redirects=False, timeout=60)
    pw = get_settings().demo_password
    c.post("/login", data={"username": "dokter", "password": pw})
    vid = int(c.post("/visits", data={"patient_id": 1, "practitioner_id": 1, "location_id": 1})
              .headers["location"].rsplit("/", 1)[1])
    c.post(f"/visits/{vid}/consent", data={"given_by_name": "Simulasi", "relation": "ibu", "agree": "ya"})
    print(f"Kunjungan {vid}: audio {duration:.0f} dtk, {n_chunks} potongan")

    sid = None
    for n in range(n_chunks):
        time.sleep(5 / a.speed)
        for attempt in range(3):  # sama seperti recorder.js: ulangi bila koneksi terputus
            try:
                r = c.post(f"/visits/{vid}/audio-chunk", data={"seq": n, **({"session_id": sid} if sid else {})},
                           files={"chunk": (f"c{n}.webm", data[n * size:(n + 1) * size], "audio/webm")})
                break
            except httpx.TransportError:
                time.sleep(0.8)
        r.raise_for_status()
        sid = r.json()["session_id"]
    t0 = time.perf_counter()
    c.post(f"/visits/{vid}/audio-finish", data={"session_id": sid}).raise_for_status()
    s_at = None
    while True:
        p = c.get(f"/visits/{vid}/review/panels").json()
        if p["s_html"] and s_at is None:
            s_at = time.perf_counter() - t0
            print(f"Bagian S tampil {s_at:.1f} dtk setelah Selesai")
        if p["status"] in ("done", "failed"):
            print(f"Status {p['status']} {time.perf_counter() - t0:.1f} dtk setelah Selesai; segmen {p['n_segments']}")
            if p["error"]:
                print("Galat:", p["error"])
            break
        time.sleep(0.5)
    print(c.get(f"/api/sessions/{sid}").json()["timings"])


if __name__ == "__main__":
    main()
