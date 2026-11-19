"""Evaluasi Whisper secara offline: bandingkan WER beberapa konfigurasi pada audio + naskah acuan yang sama.

Tidak memakai server, database, maupun LLM. Contoh:

  python scripts/eval_asr.py data/naskah_uji/naskah_01_demam.txt data/audio/ANAK-*.webm
  python scripts/eval_asr.py naskah.txt rekaman.webm --model large-v3-turbo --prompts dewasa --modes full

--modes  live = meniru aplikasi saat ini (potongan ±24 dtk tanpa konteks antarpotongan)
         full = transkripsi utuh sekali jalan setelah rekaman selesai
--prompts anak | dewasa | none (prompt awal Whisper)
"""
import argparse
import difflib
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.stdout.reconfigure(encoding="utf-8")

from app.config import get_settings  # noqa: E402
from app.scribe import asr  # noqa: E402
from app.scribe.textnorm import normalize, wer  # noqa: E402

SR = 16000


def cer(ref: str, hyp: str) -> float:
    r, h = normalize(ref), normalize(hyp)
    return 1 - difflib.SequenceMatcher(None, r, h, autojunk=False).ratio() if r else 0.0


def run_full(audio, s) -> str:
    return " ".join(seg["text"] for seg in asr._run(audio, s))


def run_live(audio, s, report: list | None = None) -> str:
    """Tiru aplikasi: tiap 5 dtk audio bertambah dan asr.incremental_step dipanggil (logika yang sama
    dengan server). `report` diisi lama putaran terakhir = waktu tunggu dokter setelah "Selesai"."""
    segments, offset, total, t = [], 0.0, len(audio) / SR, 5.0
    while True:
        final = t >= total
        start = time.perf_counter()
        segments, offset = asr.incremental_step(audio[: int(min(t, total) * SR)], s, segments, offset, final)
        if final:
            if report is not None:
                report.append(time.perf_counter() - start)
            break
        t += 5.0
    return " ".join(seg["text"] for seg in segments)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("reference")
    ap.add_argument("audio", nargs="+")
    ap.add_argument("--model", default=None, help="default: ASR_MODEL dari .env")
    ap.add_argument("--prompts", default="anak,dewasa,none")
    ap.add_argument("--modes", default="live,full")
    ap.add_argument("--show", action="store_true", help="cetak transkrip hasil")
    a = ap.parse_args()

    s = get_settings()
    if a.model:
        s = s.model_copy(update={"asr_model": a.model})
    ref = " ".join(seg["text"] for seg in asr.parse_text_transcript(Path(a.reference).read_text(encoding="utf-8")))
    t0 = time.perf_counter()
    asr.get_model(s)
    print(f"Model {s.asr_model} ({s.asr_compute_type}, {s.asr_device}) dimuat {time.perf_counter() - t0:.1f} dtk\n")

    results: dict[tuple[str, str], list[tuple[float, float, float]]] = {}
    for path in a.audio:
        audio = asr.decode_audio(path)
        dur = len(audio) / SR
        print(f"== {Path(path).name} ({dur:.0f} dtk)")
        for prompt in a.prompts.split(","):
            if prompt not in asr.PROMPTS:
                continue
            s = s.model_copy(update={"asr_prompt": prompt})
            for mode in a.modes.split(","):
                t = time.perf_counter()
                tail: list[float] = []
                hyp = run_live(audio, s, tail) if mode == "live" else run_full(audio, s)
                el = time.perf_counter() - t
                w, c = wer(ref, hyp), cer(ref, hyp)
                results.setdefault((prompt, mode), []).append((w, c, el / dur))
                wait = f"  tunggu setelah Selesai {tail[0]:4.1f} dtk" if tail else f"  tunggu setelah Selesai {el:4.1f} dtk"
                print(f"   prompt={prompt:<6} mode={mode:<4}  WER {100 * w:5.1f}%  CER {100 * c:5.1f}%  total CPU {el:5.1f} dtk ({el / dur:.2f}x durasi){wait}")
                if a.show:
                    print("     ", hyp)
    print("\nRata-rata:")
    for (prompt, mode), rows in sorted(results.items(), key=lambda kv: sum(r[0] for r in kv[1]) / len(kv[1])):
        n = len(rows)
        print(f"   prompt={prompt:<6} mode={mode:<4}  WER {100 * sum(r[0] for r in rows) / n:5.1f}%  "
              f"CER {100 * sum(r[1] for r in rows) / n:5.1f}%  kecepatan {sum(r[2] for r in rows) / n:.2f}x durasi audio")


if __name__ == "__main__":
    main()
