"""ASR dengan faster-whisper (CTranslate2), berjalan di CPU.

ASR_MODEL bisa nama model bawaan ("small", "medium", "large-v3-turbo") atau path folder
CT2 hasil fine-tune (notebooks/train_asr_v2.ipynb). Dekode audio memakai PyAV bawaan
faster-whisper, jadi webm/opus dari browser bisa langsung diproses tanpa ffmpeg terpasang.
"""
import re
import threading
from pathlib import Path

from app.config import BASE_DIR, Settings

# Prompt awal Whisper: kalimat percakapan klinis alami (bukan daftar kata lepas panjang agar tidak
# memicu halusinasi di jeda hening), memuat ejaan kata yang sering salah dengar di poli umum.
PROMPT_DEWASA = (
    "Konsultasi dokter dan pasien poli umum, bahasa Indonesia campur bahasa Jawa. "
    "Selamat pagi, monggo duduk dulu, Dok. Wonten punopo, ada keluhan apa? "
    "Kulo gerah telung dino, pitung dino, saben dino kepala pusing cenat-cenut, kecapean, pandangan kabur, "
    "demam, batuk berdahak, sesak napas, nyeri ulu hati, mual muntah, diare BAB cair berlendir, lemas. "
    "Tekanan darah, asma tidak ada, mboten wonten, mboten enten, Dok, nanging ngunjuk parasetamol, "
    "amlodipin, metformin, omeprazol, antasida, oralit."
)
# Prompt khusus skenario poli anak (dipakai bila ASR_PROMPT=anak).
PROMPT_ANAK = (
    "Konsultasi dokter anak dengan ibu pasien, bahasa Indonesia campur bahasa Jawa Timuran. "
    "Selamat siang, silakan duduk dulu, Dok. Anak kulo gerah, sumer, nggreges, demam tinggi, "
    "batuk grok-grok berdahak, pilek, sesak napas, ngelu, mual muntah, diare mencret, kejang demam, mimisan, biduran. "
    "Mboten enten, Dok, tetep mangan bubur, dituku di apotek: parasetamol sirup, ibuprofen, amoksisilin, oralit, zink. "
    "Suhu tiga puluh delapan koma sembilan derajat, berat badan tujuh belas setengah kilo."
)
PROMPTS = {"dewasa": PROMPT_DEWASA, "anak": PROMPT_ANAK, "none": None}
INITIAL_PROMPT: str | None = PROMPT_DEWASA


def prompt_for(s: Settings) -> str | None:
    return PROMPTS.get(s.asr_prompt, INITIAL_PROMPT)


# Aturan koreksi fonetik dan istilah klinis/dialek pasca-ASR
PHONETIC_CORRECTIONS: list[tuple[re.Pattern, str]] = [
    # Sapaan dokter yang sering tertukar oleh Whisper ("Tok", "Top", "otok", "dogg", "dong")
    (re.compile(r"\bdogg?\b(?=[\s,\.\?!]|$)", re.I), "dok"),
    (re.compile(r"(?<=,\s)(?:tok|top|otok)(?=[\s,\.\?!]|$)", re.I), "dok"),
    (
        re.compile(
            r"\b(iya|ya|nggak|gak|ga|tidak|bukan|oke|baik|siap|ini|sakit|mual|pusing|sembuh|ada|"
            r"kenapa|gimana|berapa|lama|minggu|hari|bulan|bersing-bersing|kampu|sih|lagi)\s+"
            r"(?:tok|top|otok)(?=[\s,\.\?!]|$)",
            re.I,
        ),
        r"\1 dok",
    ),
    (
        re.compile(
            r"\b(sakit|siap|baik|pusing|mual|demam|batuk|sembuh|ada)\s+dong(?=[\s,\.\?!]|$)",
            re.I,
        ),
        r"\1 dok",
    ),
    (re.compile(r"\bblipistok\b", re.I), "pelipis dok"),
    (re.compile(r"\bmewaltok\b", re.I), "mual dok"),

    # Gejala, anatomi & istilah klinis yang sering meleset
    (re.compile(r"\b(?:tutu[-\s]?tulu|tutu[-\s]?dulu|duduk[-\s]?tulu)\b", re.I), "duduk dulu"),
    (re.compile(r"\blentir\b", re.I), "lendir"),
    (re.compile(r"\btiare\b", re.I), "diare"),
    (re.compile(r"\bmencrit\b", re.I), "mencret"),
    (re.compile(r"\bGabrinya\b", re.I), "BAB-nya"),
    (re.compile(r"\b(?:darah\s+)?patah\s+(?:BAP|BAB)\b", re.I), "darah pada BAB"),
    (re.compile(r"\bpatah\s+(?:BAP|BAB)\b", re.I), "pada BAB"),
    (re.compile(r"\bBAP\b(?=\s*(?:cair|keras|encer|berdarah|berlendir|-nya|nya|\.|\,|$))", re.I), "BAB"),
    (re.compile(r"\bpatuk[-\s]?patuk\b", re.I), "batuk-batuk"),
    (re.compile(r"\bbatunya(?=\s+(?:kering|berdaha[k]?|cair|sudah|udah|muncul|terasa|kambuh|kampu|lama|nggak|tidak))", re.I), "batuknya"),
    (re.compile(r"\bbatu(?=\s+(?:berdaha[k]?|kering|lama|kronis))", re.I), "batuk"),
    (re.compile(r"\bberdaha\b", re.I), "berdahak"),
    (re.compile(r"\bsessana\s*fas\b|\bses[ae]t\s+na[fp]as\b|\bsesak\s+nafas\b", re.I), "sesak napas"),
    (re.compile(r"\bkongreges\b", re.I), "kok nggreges"),
    (re.compile(r"\b(bunyi[,\s]+)(?:mik|nik)[-\s]+(?:mik|nik)\b", re.I), r"\1ngik-ngik"),
    (re.compile(r"\bbersing[-\s]?bersing\b", re.I), "bersin-bersin"),
    (re.compile(r"\bkampu\b", re.I), "kambuh"),
    (re.compile(r"\btekanan\s+daerah\b", re.I), "tekanan darah"),
    (re.compile(r"\b(?:handangan|padangan)(?=\s+kabur)\b", re.I), "pandangan"),
    (re.compile(r"\bcenot[-\s]?cenot\b", re.I), "cenat-cenut"),
    (re.compile(r"\bakamual\b", re.I), "agak mual"),
    (re.compile(r"\b(?:mutah|putah)\b", re.I), "muntah"),
    (re.compile(r"\btercapaian\b", re.I), "kecapean"),
    (re.compile(r"\bkelohan\b", re.I), "keluhan"),
    (re.compile(r"\bgejela\b", re.I), "gejala"),
    (re.compile(r"\bbepak\b", re.I), "bapak"),
    (re.compile(r"\bpusinnya\b", re.I), "pusingnya"),
    (re.compile(r"\bpusin\b", re.I), "pusing"),
    (re.compile(r"\bpolati\s+tur\b", re.I), "pola tidur"),

    # Negasi klinis & dialek Jawa Krama/Ngoko
    (re.compile(r"\basmat\s+kita\s+ada\b", re.I), "asma tidak ada"),
    (
        re.compile(
            r"\bendah(?=\s+(?:pakai|sembuh|ada|bisa|mau|pernah|minum|makan|tidur|keluar|naik|turun|hilang|berkurang|sampai|tahan|kuat|tahu|tau))\b",
            re.I,
        ),
        "ndak",
    ),
    (
        re.compile(
            r"\bhendak(?=\s+(?:sembuh|ada|pernah|tahu|tau|hilang|berkurang|tahan|kuat|kambuh|demam|batuk|sesak|mual|muntah))\b",
            re.I,
        ),
        "ndak",
    ),
    (re.compile(r"\b(?:buat\s+)?ternenten\b", re.I), "mboten enten"),
    (re.compile(r"\bboten\s+enten\b", re.I), "mboten enten"),
    (re.compile(r"\bm?boten\s+wanton\b", re.I), "mboten wonten"),
    (re.compile(r"\bboten\b", re.I), "mboten"),
    (re.compile(r"\bbotan(?=\s*,?\s*(?:kula|kulo|wonten|enten|dok|pak|bu))", re.I), "mboten"),
    (re.compile(r"\bbotek(?=\s+(?:kabur|wonten|enten|sakit|ada|sampai|muntah|putah))", re.I), "mboten"),
    (re.compile(r"\bwontan\b", re.I), "wonten"),
    (re.compile(r"\bkulohiro\b", re.I), "kulo kiro"),
    (re.compile(r"\bsambedino\b", re.I), "saben dino"),
    (re.compile(r"\bpitong(?=\s+dino)\b", re.I), "pitung"),
    (re.compile(r"\btelong(?=\s+dino)\b", re.I), "telung"),
    (re.compile(r"\btetemangan\b", re.I), "tetep mangan"),

    # Obat & istilah harian pasien
    (re.compile(r"\bpara\s+setamol\b", re.I), "parasetamol"),
    (re.compile(r"\b(makan|habis|jajan|beli|nyemil|cemilan)\s+sebelah\b", re.I), r"\1 seblak"),
    (re.compile(r"\bsebelah\s+(pedas|pedes|level|kuah|jeletot|ceker|cilok)\b", re.I), r"seblak \1"),
    (re.compile(r"\blau\b(?=\s*(?:pauk|makan|nasi|ayam|tahu|tempe|ikan|\.|\,|$))", re.I), "lauk"),
    (re.compile(r"\bberatikan\b", re.I), "perhatikan"),
    (re.compile(r"\bmudah\s+di\s*jernah\b", re.I), "mudah dicerna"),
    (re.compile(r"\bmudah\s+dicernah\b", re.I), "mudah dicerna"),
    (re.compile(r"\bdi\s*jernah\b", re.I), "dicerna"),
    (re.compile(r"\bopat\b", re.I), "obat"),
    (re.compile(r"\banti\s*diari\b", re.I), "anti diare"),
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


def _resample_and_filter(container, stream, sr: int, highpass_hz: int):
    import av
    resampler = av.AudioResampler(format="flt", layout="mono", rate=sr)
    abuf = sink = graph = None
    if highpass_hz > 0:
        graph = av.filter.Graph()
        abuf = graph.add_abuffer(format="flt", sample_rate=sr, layout="mono")
        hp = graph.add("highpass", f"f={highpass_hz}")
        sink = graph.add("abuffersink")
        abuf.link_to(hp)
        hp.link_to(sink)
        graph.configure()

    chunks = []

    def _emit(frame):
        if graph is None:
            chunks.append(frame.to_ndarray().reshape(-1))
            return
        abuf.push(frame)
        while True:
            try:
                chunks.append(sink.pull().to_ndarray().reshape(-1))
            except av.error.FFmpegError:
                break

    try:
        for frame in container.decode(stream):
            for f in resampler.resample(frame):
                _emit(f)
    except av.error.FFmpegError:
        # Saat rekaman masih berjalan, potongan terakhir bisa belum lengkap: pakai yang sudah terbaca.
        pass
    for f in resampler.resample(None):
        _emit(f)
    if graph is not None:
        try:
            abuf.push(None)
            while True:
                chunks.append(sink.pull().to_ndarray().reshape(-1))
        except av.error.FFmpegError:
            pass
    return chunks


def preprocess_audio(
    audio,
    sr: int = 16000,
    *,
    target_rms: float = 0.085,
    noise_floor_rms: float = 0.005,
    max_gain: float = 4.5,
    min_gain: float = 0.5,
):
    """Normalisasi kenyaringan bertarget ucapan (speech-gated) + soft peak limiter.

    Suara pasien yang pelan diangkat agar terbaca jelas oleh Silero VAD & Whisper,
    sementara bagian hening di bawah noise_floor_rms tidak diperkuat agar tidak memicu halusinasi.
    """
    import numpy as np

    arr = np.asarray(audio, dtype=np.float32)
    if arr.size == 0 or float(np.max(np.abs(arr))) == 0.0:
        return arr

    # Buang DC offset tanpa menggeser sinyal nol
    arr = arr - np.float32(np.mean(arr))

    frame_len = max(1, int(0.25 * sr))
    n_frames = max(1, (arr.size + frame_len - 1) // frame_len)
    pad = n_frames * frame_len - arr.size
    padded = np.pad(arr, (0, pad)) if pad else arr
    frames = padded.reshape(n_frames, frame_len)
    rms = np.sqrt(np.mean(frames * frames, axis=1) + 1e-12)

    # Hanya segmen di atas noise_floor_rms yang dinaikkan; puncak sangat keras tetap diturunkan.
    desired = np.where(
        rms >= noise_floor_rms,
        np.clip(target_rms / rms, min_gain, max_gain),
        np.minimum(1.0, target_rms / np.maximum(rms, 1e-6)),
    ).astype(np.float32)

    # Haluskan transisi gain antarblok 250 ms supaya tidak ada bunyi klik
    if n_frames > 1:
        kernel = np.array([0.25, 0.5, 0.25], dtype=np.float32)
        desired = np.convolve(np.pad(desired, 1, mode="edge"), kernel, mode="valid")

    centers = (np.arange(n_frames, dtype=np.float64) + 0.5) * frame_len
    gains = np.interp(np.arange(arr.size, dtype=np.float64), centers, desired).astype(np.float32)
    leveled = arr * gains

    # Soft limiter di atas ambang 0.85 untuk mencegah clipping keras pada puncak mendadak
    threshold = np.float32(0.85)
    abs_x = np.abs(leveled)
    over = abs_x > threshold
    if np.any(over):
        headroom = np.float32(0.13)
        compressed = threshold + headroom * np.tanh((abs_x[over] - threshold) / headroom)
        leveled[over] = np.sign(leveled[over]) * compressed

    return np.clip(leveled, -0.99, 0.99).astype(np.float32)


def decode_audio(path: str, sr: int = 16000, *, highpass_hz: int = 80):
    """Dekode ke float32 mono 16 kHz dengan filter high-pass 80 Hz. Ditulis sendiri karena
    decode_audio bawaan faster-whisper 1.2 memanggil av.open(metadata_errors=...) yang dihapus di PyAV 15+."""
    import av
    import numpy as np
    with av.open(path, mode="r") as container:
        stream = container.streams.audio[0]
        chunks = _resample_and_filter(container, stream, sr, highpass_hz)
    if not chunks:
        return np.zeros(0, dtype=np.float32)
    out = np.concatenate(chunks)
    if out.dtype != np.float32:
        out = out.astype(np.float32)
    return out


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


def _decode_for_settings(path: str, s: Settings):
    do_pre = getattr(s, "asr_preprocess", True)
    hp_hz = getattr(s, "asr_highpass_hz", 80) if do_pre else 0
    audio = decode_audio(path, highpass_hz=hp_hz) if hp_hz != 80 else decode_audio(path)
    return preprocess_audio(audio) if do_pre else audio


def transcribe(path: str, s: Settings, model: str | None = None) -> tuple[list[dict], dict]:
    """Transkripsi utuh sekali jalan (dipakai untuk unggahan audio dan transkrip akhir)."""
    name = model or s.asr_model
    audio = _decode_for_settings(path, s)
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
    audio = _decode_for_settings(path, s)
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
