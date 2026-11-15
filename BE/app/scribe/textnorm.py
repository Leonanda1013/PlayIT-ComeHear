"""Normalisasi teks untuk menghitung WER secara adil dan grounding verifikasi klinis.

Tanpa normalisasi, "ini," vs "ini", "38,6" vs "38.6" vs "tiga puluh delapan koma enam",
serta perbedaan kata serapan/dialek lokal (mis. "awakke sumer" vs "badannya demam")
dihitung salah, sehingga WER terlihat lebih buruk dan grounding menurunkan status
ke 'ambigu' hanya karena sinonim serapan.
"""
import re
import unicodedata

_PUNCT = re.compile(r"[^\w\s]")
_SPACE = re.compile(r"\s+")
_ANGKA = {
    "nol": 0, "satu": 1, "dua": 2, "tiga": 3, "empat": 4, "lima": 5, "enam": 6, "tujuh": 7,
    "delapan": 8, "sembilan": 9, "sepuluh": 10, "sebelas": 11, "seratus": 100,
}

# Kamus pemetaan singkatan, ragam percakapan, dan dialek Jawa Timuran ke padanan bahasa baku
_SINGKATAN = {
    # Gelar & sapaan
    "dok": "dokter",
    "dr": "dokter",
    "bu": "ibu",
    "pak": "bapak",

    # Negasi
    "nggak": "tidak",
    "gak": "tidak",
    "ga": "tidak",
    "enggak": "tidak",
    "ndak": "tidak",
    "ora": "tidak",

    # Partikel & ragam cakap santai
    "udah": "sudah",
    "uda": "sudah",
    "aja": "saja",
    "kalo": "kalau",
    "klo": "kalau",
    "cuma": "hanya",
    "banget": "sangat",
    "tapi": "tetapi",
    "trus": "terus",
    "abis": "habis",
    "gimana": "bagaimana",
    "bikin": "membuat",
    "dikasih": "diberi",
    "dikasihkan": "diberikan",

    # Waktu & durasi (Jawa ↔ Indonesia)
    "ket": "sejak",
    "wingi": "kemarin",
    "isuk": "pagi",
    "awan": "siang",
    "bengi": "malam",
    "saiki": "sekarang",
    "dino": "hari",
    "mari": "selesai",
    "sakwise": "setelah",

    # Bagian tubuh & subjek (Jawa ↔ Indonesia)
    "awakke": "badannya",
    "awakne": "badannya",
    "awake": "badannya",
    "awak": "badan",
    "sirahne": "kepalanya",
    "sirah": "kepala",
    "anake": "anaknya",
    "bocah": "anak",
    "arek": "anak",

    # Gejala & kondisi klinis (Jawa ↔ Baku)
    "sumer": "demam",
    "nggreges": "meriang",
    "ngelu": "pusing",
    "lemes": "lemas",
    "mencret": "diare",
    "senep": "mules",
    "mutah": "muntah",
    "watuk": "batuk",
    "sambat": "mengeluh",
    "gatel": "gatal",
    "ngombe": "minum",
    "mangan": "makan",
    "turu": "tidur",
    "pipis": "kencing",

    # Angka dialek Jawa (agar diproses _words_to_digits)
    "siji": "satu",
    "loro": "dua",
    "rong": "dua",
    "telu": "tiga",
    "telung": "tiga",
    "papat": "empat",
    "patang": "empat",
    "limo": "lima",
    "enem": "enam",
    "pitu": "tujuh",
    "wolu": "delapan",
    "songo": "sembilan",
}


def normalize(text: str, expand_slang: bool = True) -> str:
    t = unicodedata.normalize("NFKC", text).lower()
    t = re.sub(r"(\d)[,\.](\d)", r"\1 koma \2", t)  # 38,6 atau 38.6 -> 38 koma 6
    t = t.replace("-", " ")
    t = _PUNCT.sub(" ", t)
    words = _SPACE.sub(" ", t).strip().split()
    if expand_slang:
        words = [_SINGKATAN.get(w, w) for w in words]
    return " ".join(_words_to_digits(words))


def _words_to_digits(words: list[str]) -> list[str]:
    """'tiga puluh delapan' -> '38', 'belas' dan 'puluh' saja; cukup untuk angka klinis umum."""
    out, i = [], 0
    while i < len(words):
        w = words[i]
        if w in _ANGKA:
            n = _ANGKA[w]
            if i + 1 < len(words) and words[i + 1] == "puluh":
                n, i = n * 10, i + 1
                if i + 1 < len(words) and words[i + 1] in _ANGKA and _ANGKA[words[i + 1]] < 10:
                    n, i = n + _ANGKA[words[i + 1]], i + 1
            elif i + 1 < len(words) and words[i + 1] == "belas":
                n, i = n + 10, i + 1
            out.append(str(n))
        else:
            out.append(w)
        i += 1
    return out


def wer(reference: str, hypothesis: str) -> float:
    r, h = normalize(reference).split(), normalize(hypothesis).split()
    if not r:
        return 0.0 if not h else 1.0
    prev = list(range(len(h) + 1))
    for i, rw in enumerate(r, 1):
        cur = [i] + [0] * len(h)
        for j, hw in enumerate(h, 1):
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (rw != hw))
        prev = cur
    return prev[-1] / len(r)
