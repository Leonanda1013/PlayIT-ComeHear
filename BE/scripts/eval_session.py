"""Bandingkan transkrip ASR sebuah sesi scribe dengan naskah acuan.

  python scripts/eval_session.py data/naskah_uji/naskah_01_demam.txt            # sesi terbaru
  python scripts/eval_session.py data/naskah_uji/naskah_01_demam.txt --session 7

Mencetak WER/CER ternormalisasi, ketepatan label pembicara (bila naskah berawalan peran),
dan daftar kata yang salah supaya istilah medis/Jawa yang sering keliru terlihat.
"""
import argparse
import difflib
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.stdout.reconfigure(encoding="utf-8")

from app.config import get_settings  # noqa: E402
from app.scribe.asr import parse_text_transcript  # noqa: E402
from app.scribe.textnorm import normalize, wer  # noqa: E402


def cer(ref: str, hyp: str) -> float:
    r, h = normalize(ref), normalize(hyp)
    return 1 - difflib.SequenceMatcher(None, r, h, autojunk=False).ratio() if r else 0.0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("reference")
    ap.add_argument("--session", type=int)
    a = ap.parse_args()

    db_path = get_settings().database_url.removeprefix("sqlite:///")
    con = sqlite3.connect(db_path)
    q = "select id, transcript, timings, model_info from scribe_sessions where status='done' and audio_path is not null"
    row = con.execute(q + (" and id=?" if a.session else " order by id desc limit 1"),
                      (a.session,) if a.session else ()).fetchone()
    if not row:
        raise SystemExit("Tidak ada sesi audio yang selesai.")
    import json
    sid, transcript, timings, info = row[0], json.loads(row[1]), json.loads(row[2] or "{}"), json.loads(row[3] or "{}")
    ref_segs = parse_text_transcript(Path(a.reference).read_text(encoding="utf-8"))
    ref = " ".join(s["text"] for s in ref_segs)
    hyp = " ".join(s["text"] for s in transcript)

    print(f"Sesi {sid} | model {info.get('asr_model')} | audio {info.get('duration_s')} dtk | "
          f"ASR {timings.get('asr_s')} dtk | total {timings.get('total_s')} dtk")
    print(f"WER ternormalisasi: {100 * wer(ref, hyp):.1f}%   (target proposal <= 15-20%)")
    print(f"CER (perkiraan)   : {100 * cer(ref, hyp):.1f}%")

    # Label pembicara: cocokkan tiap segmen hipotesis ke kalimat acuan yang paling mirip.
    if all(s.get("speaker") for s in ref_segs):
        hit = 0
        for s in transcript:
            best = max(ref_segs, key=lambda r: difflib.SequenceMatcher(None, normalize(r["text"]), normalize(s["text"])).ratio())
            hit += best["speaker"] == s.get("speaker")
        print(f"Label pembicara   : {hit}/{len(transcript)} segmen cocok dengan naskah")

    r, h = normalize(ref).split(), normalize(hyp).split()
    print("\nKesalahan kata (acuan -> hasil ASR):")
    for op, i1, i2, j1, j2 in difflib.SequenceMatcher(None, r, h, autojunk=False).get_opcodes():
        if op != "equal":
            print(f"  {op:<8} {' '.join(r[i1:i2]) or '-':<35} -> {' '.join(h[j1:j2]) or '-'}")
    print("\nTranskrip ASR per segmen:")
    for s in transcript:
        print(f"  [{s['i']}] {s.get('speaker') or '?':<9} {s['text']}")


if __name__ == "__main__":
    main()
