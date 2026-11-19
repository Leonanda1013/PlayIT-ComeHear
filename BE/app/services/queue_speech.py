import io
import wave
from functools import lru_cache
from pathlib import Path

MODEL_PATH = Path(__file__).resolve().parents[2] / "models" / "piper" / "id_ID-news_tts-medium.onnx"
DIGITS = ("nol", "satu", "dua", "tiga", "empat", "lima", "enam", "tujuh", "delapan", "sembilan")


@lru_cache(maxsize=1)
def load_voice():
    from piper import PiperVoice

    return PiperVoice.load(MODEL_PATH)


@lru_cache(maxsize=32)
def announcement_wav(queue_no: int, destination: str) -> bytes:
    number = " ".join(DIGITS[int(digit)] for digit in f"{queue_no:03d}")
    message = f"Panggilan kepada antrean nomor {number}. Silakan menuju {destination}."
    output = io.BytesIO()
    with wave.open(output, "wb") as wav_file:
        load_voice().synthesize_wav(message, wav_file)
    return output.getvalue()
