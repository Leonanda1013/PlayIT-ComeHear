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


def speech_start(samples, sample_rate: int) -> int:
    window_size = sample_rate // 100  # 10 ms
    search_end = min(len(samples), sample_rate // 4)
    for start in range(0, search_end - window_size + 1, window_size):
        window = samples[start:start + window_size]
        if (window ** 2).mean() >= 0.03 ** 2:
            # Leave 10 ms before speech to preserve the leading consonant.
            return max(0, start - window_size)
    return 0


@lru_cache(maxsize=4)
def announcement_bell(sample_rate: int) -> bytes:
    import numpy as np

    note_duration = 0.40
    note_spacing = round(0.24 * sample_rate)
    time = np.arange(round(note_duration * sample_rate)) / sample_rate
    envelope = 0.38 * np.exp(-time / 0.12)
    envelope *= np.minimum(time / 0.006, 1.0)
    envelope *= np.minimum((note_duration - time) / 0.035, 1.0)

    frequencies = (523.25, 659.25, 523.25, 392.00)
    bell = np.zeros(time.size + (len(frequencies) - 1) * note_spacing)
    for index, frequency in enumerate(frequencies):
        phase = 2 * np.pi * frequency * time
        tone = np.sin(phase) + 0.18 * np.sin(2.76 * phase)
        start = index * note_spacing
        bell[start:start + time.size] += tone * envelope

    return np.round(bell * 32767).astype("<i2").tobytes()


@lru_cache(maxsize=32)
def announcement_wav(queue_no: int, destination: str) -> bytes:
    from piper import SynthesisConfig

    number = " ".join(DIGITS[int(digit)] for digit in f"{queue_no:03d}")
    message = f"kepada antrean nomor {number}. Silakan menuju {destination}."
    voice = load_voice()
    config = SynthesisConfig(length_scale=1.25)
    chunks = iter(voice.synthesize(f"Panggilan {message}", syn_config=config))
    first = next(chunks)
    frame_size = first.sample_width * first.sample_channels
    bell = announcement_bell(first.sample_rate)
    pause = bytes(round(0.20 * first.sample_rate) * frame_size)
    repeat_pause = bytes(round(0.40 * first.sample_rate) * frame_size)
    start = speech_start(first.audio_float_array, first.sample_rate)

    output = io.BytesIO()
    with wave.open(output, "wb") as wav_file:
        wav_file.setframerate(first.sample_rate)
        wav_file.setsampwidth(first.sample_width)
        wav_file.setnchannels(first.sample_channels)
        wav_file.writeframesraw(bell)
        wav_file.writeframesraw(pause)
        wav_file.writeframesraw(first.audio_int16_bytes[start * frame_size:])
        for chunk in chunks:
            wav_file.writeframesraw(chunk.audio_int16_bytes)
        wav_file.writeframesraw(repeat_pause)
        for chunk in voice.synthesize(f"Sekali lagi, panggilan {message}", syn_config=config):
            wav_file.writeframesraw(chunk.audio_int16_bytes)
        wav_file.writeframesraw(pause)
        wav_file.writeframesraw(bell)
    return output.getvalue()
