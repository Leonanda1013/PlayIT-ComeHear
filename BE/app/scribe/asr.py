"""ASR dengan faster-whisper (CTranslate2), berjalan di CPU.

ASR_MODEL bisa nama model bawaan ("small", "medium", "large-v3-turbo") atau path folder
CT2 hasil fine-tune (notebooks/train_asr_v2.ipynb). Dekode audio memakai PyAV bawaan
faster-whisper, jadi webm/opus dari browser bisa langsung diproses tanpa ffmpeg terpasang.
"""
import re
import threading
from pathlib import Path

from app.config import BASE_DIR, Settings

# Prompt awal Whisper: konteks + kosakata yang sering muncul. Dibuat singkat karena daftar kata yang
# terlalu panjang bisa membuat Whisper "mendengar" istilah itu di bagian hening (halusinasi).
PROMPT_DEWASA = (
    "Percakapan konsultasi dokter dengan pasien dewasa di poli rawat jalan, bahasa Indonesia "
    "kadang campur bahasa Jawa. Sapaan: duduk dulu dok, monggo pinarak. "
    "Keluhan: pusing berputar, sakit kepala cenat-cenut, demam, batuk, "
    "sesak napas, nyeri ulu hati, mual, muntah, BAB cair, diare, lendir, darah pada BAB, seblak, lauk pedas, lemas. "
    "Ungkapan: mboten enten dok, tetep mangan, dituku di apotek. Riwayat darah tinggi, gula darah, maag, "
    "alergi obat. Obat: parasetamol, amlodipin, metformin, omeprazol, obat anti diare, oralit."
)
# Prompt lama untuk skenario poli anak (dipakai bila ASR_PROMPT=anak).
PROMPT_ANAK = (
    "Percakapan konsultasi dokter spesialis anak dengan ibu pasien di poli rawat jalan, "
    "bahasa Indonesia campur bahasa Jawa Timuran. Sapaan: duduk dulu dok, monggo pinarak, silakan duduk. "
    "Keluhan: demam tinggi, sumer, nggreges, panas adem, batuk grok-grok, pilek, mual, "
    "muntah, diare, mencret, feses ada lendir, darah pada BAB, sesak, ngelu, lemes, kejang demam, mimisan, "
    "biduran, ruam gatal, seblak pedas, lauk. "
    "Ungkapan: keluhan mboten enten dok, tetep mangan bubur, dituku nang apotek. "
    "Obat: parasetamol sirup, sanmol, tempra, proris, ibuprofen, amoksisilin, cefixime, oralit, zink, obat anti diare. "
    "Suhu tubuh tiga puluh delapan koma sembilan derajat, berat badan tujuh belas setengah kilo."
)
PROMPTS = {"dewasa": PROMPT_DEWASA, "anak": PROMPT_ANAK, "none": None}
INITIAL_PROMPT: str | None = PROMPT_DEWASA


def prompt_for(s: Settings) -> str | None:
    return PROMPTS.get(s.asr_prompt, INITIAL_PROMPT)


# Aturan koreksi fonetik dan istilah klinis/dialek pasca-ASR
PHONETIC_CORRECTIONS: list[tuple[re.Pattern, str]] = [
    # Voicing & Consonants
    (re.compile(r"\b(?:tutu[-\s]?tulu|tutu[-\s]?dulu|duduk[-\s]?tulu)\b", re.I), "duduk dulu"),
    (re.compile(r"\blentir\b", re.I), "lendir"),
    (re.compile(r"\btiare\b", re.I), "diare"),
    (re.compile(r"\bGabrinya\b", re.I), "BAB-nya"),
    (re.compile(r"\b(?:darah\s+)?patah\s+(?:BAP|BAB)\b", re.I), "darah pada BAB"),
    (re.compile(r"\bpatah\s+(?:BAP|BAB)\b", re.I), "pada BAB"),
    (re.compile(r"\bBAP\b(?=\s*(?:cair|keras|encer|berdarah|berlendir|-nya|nya|\.|\,|$))", re.I), "BAB"),
    (re.compile(r"\b(makan|habis|jajan|beli|nyemil|cemilan)\s+sebelah\b", re.I), r"\1 seblak"),
    (re.compile(r"\bsebelah\s+(pedas|pedes|level|kuah|jeletot|ceker|cilok)\b", re.I), r"seblak \1"),
    (re.compile(r"\blau\b(?=\s*(?:pauk|makan|nasi|ayam|tahu|tempe|ikan|\.|\,|$))", re.I), "lauk"),
    (re.compile(r"\bberatikan\b", re.I), "perhatikan"),
    (re.compile(r"\b(?:buat\s+)?ternenten\b", re.I), "mboten enten"),
    (re.compile(r"\bboten\s+enten\b", re.I), "mboten enten"),
    (re.compile(r"\bdog\b(?=[\s,\.\?!]|$)", re.I), "dok"),
    (re.compile(r"\btetemangan\b", re.I), "tetep mangan"),
    (re.compile(r"\bmudah\s+di\s*jernah\b", re.I), "mudah dicerna"),
    (re.compile(r"\bmudah\s+dicernah\b", re.I), "mudah dicerna"),
    (re.compile(r"\bdi\s*jernah\b", re.I), "dicerna"),
    (re.compile(r"\bopat\b", re.I), "obat"),
    (re.compile(r"\bantidiari\b", re.I), "anti diare"),
    (re.compile(r"\b(obat[a-z]*|sirup|puyer|resep)\s+(?:nya\s+)?dituduh\b", re.I), r"\1 dituku"),
    (re.compile(r"\bdituduh\s+(?:di\s+)?(apotek|toko|warung)\b", re.I), r"dituku di \1"),
    (re.compile(r"\bdi\s+tuduh\s+(?:di\s+)?(apotek|toko|warung)\b", re.I), r"dituku di \1"),
]


def clean_clinical_transcript(text: str) -> str:
    """Membersihkan kesalahan fonetik umum, akronim medis, dan kata serapan dialek lokal."""
    if not text:
        return ""
    for pat, rep in PHONETIC_CORRECTIONS:
        text = pat.sub(rep, text)
    return text


_models: dict[str, object] = {}
_model_lock = threading.Lock()


def get_model(s: Settings, name: str | None = None):
    """Model dimuat sekali per nama (live dan final bisa berbeda) lalu dipakai ulang."""
    raw_key = name or s.asr_model
    if isinstance(raw_key, str):
        raw_key = raw_key.strip().strip("'\"")
        while raw_key.startswith("ASR_MODEL="):
            raw_key = raw_key[len("ASR_MODEL="):].strip().strip("'\"")
    key = raw_key
    with _model_lock:
        if key not in _models:
            from faster_whisper import WhisperModel
            model_path = key
            if (BASE_DIR / key).is_dir():
                model_path = str(BASE_DIR / key)
            elif Path(key).is_dir():
                model_path = str(Path(key).resolve())
            _models[key] = WhisperModel(model_path, device=s.asr_device, compute_type=s.asr_compute_type,
                                        cpu_threads=s.asr_cpu_threads)
        return _models[key]


def _split_sentences(text: str, start: float, end: float) -> list[tuple[float, float, str]]:
    """Whisper sering menggabung dua giliran bicara dalam satu segmen; pecah per kalimat
    dengan waktu dibagi proporsional panjang teks agar label pembicara lebih tepat."""
    text = clean_clinical_transcript(text)
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


def _run(audio, s: Settings, offset: float = 0.0, model: str | None = None, context: str = "") -> list[dict]:
    """Transkripsi satu potongan audio. `context` = kalimat terakhir blok sebelumnya, ditambahkan ke
    prompt awal agar kalimat yang berlanjut antar-blok tetap nyambung."""
    prompt = prompt_for(s)
    if context:
        prompt = f"{prompt or ''} {context[-200:]}".strip()
    segments, _ = get_model(s, model).transcribe(
        audio, language="id", task="transcribe", beam_size=5, temperature=0.0,
        initial_prompt=prompt or None, condition_on_previous_text=False,
        vad_filter=True, vad_parameters={"min_silence_duration_ms": 400, "speech_pad_ms": 200})
    return [{"start": round(seg.start + offset, 2), "end": round(seg.end + offset, 2), "text": clean_clinical_transcript(seg.text.strip())}
            for seg in segments if seg.text.strip()]


def _to_sentences(raw: list[dict], start_index: int = 0) -> list[dict]:
    out = []
    for seg in raw:
        for st, en, txt in _split_sentences(seg["text"], seg["start"], seg["end"]):
            out.append({"i": start_index + len(out), "start": st, "end": en, "speaker": None, "text": txt})
    return out


def transcribe(path: str, s: Settings, model: str | None = None) -> tuple[list[dict], dict]:
    """Transkripsi utuh sekali jalan (dipakai untuk unggahan audio dan transkrip akhir)."""
    name = model or s.asr_model
    audio = decode_audio(path)
    return _to_sentences(_run(audio, s, model=name)), {"asr_model": name, "duration_s": round(len(audio) / 16000, 1)}


MIN_NEW_AUDIO_S = 24.0   # Whisper selalu memproses jendela 30 dtk: putaran pendek boros CPU dan menumpuk antrean
MIN_BLOCK_S = 15.0       # blok terpendek yang dikunci di tengah rekaman
MAX_BLOCK_S = 45.0       # bila tidak ada jeda bicara, blok dipotong paksa agar transkrip tetap maju
TAIL_GUARD_S = 1.5       # ujung audio bisa masih terpotong kata: jangan dipotong terlalu dekat ujung


def _silence_cut(audio, offset: float, duration: float) -> float | None:
    """Cari titik potong di jeda bicara terakhir antara offset+MIN_BLOCK_S dan ujung audio.

    Memakai VAD Silero bawaan faster-whisper. None = belum ada jeda yang cocok (tunggu audio berikutnya).
    """
    from faster_whisper.vad import VadOptions, get_speech_timestamps

    lo, hi = offset + MIN_BLOCK_S, duration - TAIL_GUARD_S
    if hi <= lo:
        return None
    window = audio[int(offset * 16000):int(hi * 16000)]
    speech = get_speech_timestamps(window, VadOptions(min_silence_duration_ms=300))
    if not speech:
        return hi  # seluruhnya hening: aman dipotong
    cuts = [offset + (a["end"] + b["start"]) / 2 / 16000 for a, b in zip(speech, speech[1:])]
    last_end = offset + speech[-1]["end"] / 16000
    if hi - last_end >= 0.3:  # sudah hening di ujung jendela
        cuts.append(last_end + 0.15)
    cuts = [c for c in cuts if lo <= c <= hi]
    if cuts:
        return max(cuts)
    return hi if duration - offset >= MAX_BLOCK_S else None


def incremental_step(audio, s: Settings, segments: list[dict], offset: float,
                     final: bool) -> tuple[list[dict], float]:
    """Satu putaran ASR bertahap pada audio yang sudah didekode. Audio diproses per blok tanpa tumpang
    tindih: blok dipotong di jeda bicara sehingga tidak ada audio yang ditranskripsi dua kali."""
    duration = len(audio) / 16000
    if final:
        cut = duration
    elif duration - offset < MIN_NEW_AUDIO_S:
        return segments, offset
    else:
        cut = _silence_cut(audio, offset, duration)
        if cut is None:
            return segments, offset
    if cut - offset < 0.3:
        return segments, max(offset, cut)
    context = " ".join(seg["text"] for seg in segments[-3:])
    raw = _run(audio[int(offset * 16000):int(cut * 16000)], s, offset=offset, context=context)
    return segments + _to_sentences(raw, start_index=len(segments)), cut


def transcribe_incremental(path: str, s: Settings, segments: list[dict], offset: float,
                           final: bool) -> tuple[list[dict], float, float]:
    """ASR selama rekaman berjalan.

    Berkas webm terus bertambah (potongan MediaRecorder disambung). Setiap putaran mengunci satu blok
    baru (di jeda bicara) setelah `offset`; saat `final`, sisa audio diproses sampai habis.
    Mengembalikan (segmen terkunci, offset baru, durasi audio sejauh ini).
    """
    audio = decode_audio(path)
    segs, new_offset = incremental_step(audio, s, segments, offset, final)
    return segs, new_offset, len(audio) / 16000


SPEAKER_PREFIX = re.compile(
    r"^\s*(dokter|dok|dr\.?|ibu|bu|ayah|bapak|pak|ortu|orang tua|wali|pasien|anak)\s*:\s*(.+)$", re.I)
_ROLE = {"dokter": "doctor", "dok": "doctor", "dr": "doctor", "dr.": "doctor", "pasien": "patient",
         "anak": "patient"}


def parse_text_transcript(text: str) -> list[dict]:
    """Transkrip teks 'Dokter: ... / Ibu: ...' (skenario uji, atau cadangan saat demo)."""
    out = []
    for line in text.splitlines():
        line = clean_clinical_transcript(line.strip())
        if not line:
            continue
        m = SPEAKER_PREFIX.match(line)
        if m:
            role = _ROLE.get(m.group(1).lower(), "guardian")
            out.append({"i": len(out), "start": None, "end": None, "speaker": role, "text": m.group(2).strip()})
        else:  # baris tanpa awalan peran: segmen sendiri, peran ditentukan LLM
            out.append({"i": len(out), "start": None, "end": None, "speaker": None, "text": line})
    return out
