"""ASR dengan faster-whisper (CTranslate2), berjalan di CPU.

ASR_MODEL bisa nama model bawaan ("small", "medium", "large-v3-turbo") atau path folder
CT2 hasil fine-tune (notebooks/train_asr_v2.ipynb). Dekode audio memakai PyAV bawaan
faster-whisper, jadi webm/opus dari browser bisa langsung diproses tanpa ffmpeg terpasang.
"""
import re
import threading

from app.config import Settings

# Bias kosakata: istilah klinis dan dialek Jawa Timuran yang sering muncul di poli anak.
INITIAL_PROMPT = (
    "Percakapan dokter dengan pasien atau keluarganya di poli rawat jalan, bahasa Indonesia, kadang Jawa. "
    "Demam, panas, sumer, batuk, pilek, mual, muntah, diare, sesak, pusing berputar, ngelu, nyeri dada, "
    "lemes, kejang, mimisan, ruam, biduran, gatal, alergi, tensi, gula darah, parasetamol, amlodipin, "
    "tiga puluh delapan koma lima derajat."
)

_model = None
_model_lock = threading.Lock()


def get_model(s: Settings):
    global _model
    with _model_lock:
        if _model is None:
            from faster_whisper import WhisperModel
            _model = WhisperModel(s.asr_model, device=s.asr_device, compute_type=s.asr_compute_type)
        return _model


def _split_sentences(text: str, start: float, end: float) -> list[tuple[float, float, str]]:
    """Whisper sering menggabung dua giliran bicara dalam satu segmen; pecah per kalimat
    dengan waktu dibagi proporsional panjang teks agar label pembicara lebih tepat."""
    parts = [p.strip() for p in re.split(r"(?<=[.?!])\s+", text.strip()) if p.strip()]
    if len(parts) <= 1:
        return [(start, end, text.strip())]
    total = sum(len(p) for p in parts)
    out, t = [], start
    for p in parts:
        dur = (end - start) * len(p) / total
        out.append((round(t, 2), round(t + dur, 2), p))
        t += dur
    return out


def decode_audio(path: str, sr: int = 16000):
    """Dekode ke float32 mono 16 kHz. Ditulis sendiri karena decode_audio bawaan faster-whisper
    1.2 memanggil av.open(metadata_errors=...) yang sudah dihapus di PyAV 15+."""
    import av
    import numpy as np
    resampler = av.AudioResampler(format="s16", layout="mono", rate=sr)
    chunks = []
    with av.open(path, mode="r") as container:
        stream = container.streams.audio[0]
        try:
            for frame in container.decode(stream):
                for f in resampler.resample(frame):
                    chunks.append(f.to_ndarray().reshape(-1))
        except av.error.FFmpegError:
            # Saat rekaman masih berjalan, potongan terakhir bisa belum lengkap: pakai yang sudah terbaca.
            pass
        for f in resampler.resample(None):
            chunks.append(f.to_ndarray().reshape(-1))
    if not chunks:
        return np.zeros(0, dtype=np.float32)
    return np.concatenate(chunks).astype(np.float32) / 32768.0


def _run(audio, s: Settings, offset: float = 0.0) -> list[dict]:
    segments, _ = get_model(s).transcribe(
        audio, language="id", task="transcribe", beam_size=5, temperature=0.0,
        initial_prompt=INITIAL_PROMPT, condition_on_previous_text=False,
        vad_filter=True, vad_parameters={"min_silence_duration_ms": 400})
    return [{"start": round(seg.start + offset, 2), "end": round(seg.end + offset, 2), "text": seg.text.strip()}
            for seg in segments if seg.text.strip()]


def _to_sentences(raw: list[dict], start_index: int = 0) -> list[dict]:
    out = []
    for seg in raw:
        for st, en, txt in _split_sentences(seg["text"], seg["start"], seg["end"]):
            out.append({"i": start_index + len(out), "start": st, "end": en, "speaker": None, "text": txt})
    return out


def transcribe(path: str, s: Settings) -> tuple[list[dict], dict]:
    audio = decode_audio(path)
    return _to_sentences(_run(audio, s)), {"asr_model": s.asr_model, "duration_s": round(len(audio) / 16000, 1)}


MIN_NEW_AUDIO_S = 24.0   # Whisper selalu memproses jendela 30 dtk: putaran pendek boros CPU dan menumpuk antrean
TAIL_GUARD_S = 1.5       # segmen yang berakhir dekat ujung bisa terpotong kata; tunda ke putaran berikut


def transcribe_incremental(path: str, s: Settings, segments: list[dict], offset: float,
                           final: bool) -> tuple[list[dict], float, float]:
    """ASR selama rekaman berjalan.

    Berkas webm terus bertambah (potongan MediaRecorder disambung). Setiap putaran hanya audio
    setelah `offset` yang ditranskripsi. Segmen terakhir (yang mungkin masih terpotong kalimatnya)
    tidak dikunci kecuali `final`, jadi ditranskripsi ulang di putaran berikutnya bersama lanjutannya.
    Mengembalikan (segmen terkunci, offset baru, durasi audio sejauh ini).
    """
    audio = decode_audio(path)
    duration = len(audio) / 16000
    if not final and duration - offset < MIN_NEW_AUDIO_S:
        return segments, offset, duration
    raw = _run(audio[int(offset * 16000):], s, offset=offset)
    if not final:
        keep = [r for r in raw if r["end"] < duration - TAIL_GUARD_S]
        raw = keep[:-1] if len(keep) == len(raw) and keep else keep
        if raw:
            offset = raw[-1]["end"]
    else:
        offset = duration
    return segments + _to_sentences(raw, start_index=len(segments)), offset, duration


SPEAKER_PREFIX = re.compile(
    r"^\s*(dokter|dok|dr\.?|ibu|bu|ayah|bapak|pak|ortu|orang tua|wali|pasien|anak)\s*:\s*(.+)$", re.I)
_ROLE = {"dokter": "doctor", "dok": "doctor", "dr": "doctor", "dr.": "doctor", "pasien": "patient",
         "anak": "patient"}


def parse_text_transcript(text: str) -> list[dict]:
    """Transkrip teks 'Dokter: ... / Ibu: ...' (skenario uji, atau cadangan saat demo)."""
    out = []
    for line in text.splitlines():
        if not line.strip():
            continue
        m = SPEAKER_PREFIX.match(line)
        if m:
            role = _ROLE.get(m.group(1).lower(), "guardian")
            out.append({"i": len(out), "start": None, "end": None, "speaker": role, "text": m.group(2).strip()})
        else:  # baris tanpa awalan peran: segmen sendiri, peran ditentukan LLM
            out.append({"i": len(out), "start": None, "end": None, "speaker": None, "text": line.strip()})
    return out
