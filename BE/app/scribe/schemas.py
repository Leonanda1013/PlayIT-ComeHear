"""Kontrak keluaran scribe v0.2 (mengikuti Proposal Final: AI hanya menyusun S + usulan ICD-10).

Perbaikan dari eksplorasi Nisa:
- sumber ditautkan ke indeks segmen transkrip (source_ids), bukan hanya kutipan bebas;
- kutipan diperiksa ulang oleh kode (grounding) sehingga isian tanpa bukti diturunkan statusnya;
- alergi juga dipecah per alergen agar bisa dipetakan ke AllergyIntolerance;
- pertinent negatives (gejala yang disangkal) dicatat terpisah.
"""
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field, field_validator

SUBJECTIVE_FIELDS = {
    "keluhan_utama": "Keluhan utama",
    "riwayat_penyakit_sekarang": "Riwayat penyakit sekarang",
    "riwayat_penyakit_dahulu": "Riwayat penyakit dahulu",
    "riwayat_alergi": "Riwayat alergi",
    "riwayat_pengobatan": "Obat/tindakan sebelum datang",
}


class Speaker(str, Enum):
    doctor = "doctor"
    patient = "patient"
    guardian = "guardian"


class SpeakerLabel(BaseModel):
    i: int
    speaker: Speaker


class SpeakerLabels(BaseModel):
    labels: list[SpeakerLabel]


class FieldStatus(str, Enum):
    jelas = "jelas"
    ambigu = "ambigu"
    tidak_ditemukan = "tidak_ditemukan"


class SubjectiveField(BaseModel):
    nilai: str | None = Field(description="Ringkasan klinis bahasa Indonesia baku. null jika tidak dibahas.")
    source_ids: list[int] = Field(description="Indeks segmen transkrip [i] yang menjadi bukti. Kosong jika tidak ada.")
    kutipan: str | None = Field(description="Kutipan persis dari segmen sumber. null jika tidak ada.")
    status: FieldStatus
    alasan_ambigu: str | None = Field(description="Diisi bila status ambigu, mis. 'ibu ragu: kayaknya'.")


class Allergy(BaseModel):
    zat: str = Field(description="Alergen, mis. 'udang', 'amoksisilin'")
    kategori: str = Field(description="food | medication | environment | biologic")
    reaksi: str | None
    kepastian: str = Field(description="confirmed bila disebut jelas, unconfirmed bila ragu")
    source_ids: list[int]


class SubjectiveExtraction(BaseModel):
    keluhan_utama: SubjectiveField
    riwayat_penyakit_sekarang: SubjectiveField
    riwayat_penyakit_dahulu: SubjectiveField
    riwayat_alergi: SubjectiveField
    riwayat_pengobatan: SubjectiveField
    alergi_terstruktur: list[Allergy]
    gejala_disangkal: list[str] = Field(description="Gejala yang ditanyakan dan dijawab tidak ada, mis. 'mimisan'")
    rangkuman_s: str = Field(description="Satu paragraf bagian Subjective SOAP, bahasa Indonesia baku, tanpa nama pasien.")


class ExtractionWithSpeakers(SubjectiveExtraction):
    """Satu panggilan LLM untuk label pembicara + bagian S (hemat satu putaran ±15-20 detik)."""
    pembicara: list[SpeakerLabel] = Field(description="Label pembicara untuk SETIAP indeks segmen [i]")


class IcdKeywords(BaseModel):
    istilah_asli: list[str] = Field(description="Gejala sebagaimana diucapkan (Indonesia/Jawa)")
    istilah_baku: list[str] = Field(description="Istilah medis Indonesia baku, mis. 'demam', 'nyeri kepala'")
    english_keywords: list[str] = Field(description="3-8 kata kunci Inggris gaya ICD-10 WHO, mis. 'fever', 'headache', 'dengue'")


class IcdPick(BaseModel):
    code: str
    deskripsi_id: str = Field(description="Terjemahan Indonesia untuk layar dokter")
    keyakinan: float = Field(description="0.0-1.0, perkiraan model (bukan akurasi terukur)")
    alasan: str = Field(description="Alasan singkat berdasarkan anamnesis saja")


class IcdPicks(BaseModel):
    picks: list[IcdPick]


class IcdRerankResult(BaseModel):
    utama: list[IcdPick] = Field(
        default_factory=list,
        description="1-3 usulan kode ICD-10 untuk diagnosis utama terbaik dari daftar kandidat, diurutkan dari yang paling sesuai."
    )
    sekunder: list[list[IcdPick]] = Field(
        default_factory=list,
        description="Daftar 0 atau lebih grup diagnosa sekunder yang terindikasi (mis. komorbid/penyakit penyerta), masing-masing 1-3 pilihan kode. Kosongkan [] jika tidak ada indikasi diagnosa sekunder."
    )

    @field_validator("sekunder", mode="before")
    @classmethod
    def norm_sekunder(cls, v: Any):
        if not isinstance(v, list):
            return []
        out = []
        for item in v:
            if isinstance(item, dict) and "pilihan" in item:
                out.append(item["pilihan"])
            elif isinstance(item, list):
                out.append(item)
            elif item:
                out.append([item])
        return out
