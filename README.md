# ComeHear: AI Medical Scribe + SIM terintegrasi SATUSEHAT

Prototipe untuk PLAY IT! Hackathon DeepTech 2026, mengikuti Proposal Final
(`DAFTAR EKSPLORASI TAHAP AWAL (6).pdf`). AI hanya menyusun **Subjektif (S)** dan **usulan ICD-10**;
Objective, Assessment, dan Plan diisi dokter. Tidak ada data yang dikirim sebelum dokter menyetujui.

```
suara ──► ASR (faster-whisper) ──► label pembicara (LLM) ──► ekstraksi S + bukti (LLM, dicek ulang kode)
      ──► usulan ICD-10 (retrieval CSV + LLM) ──► layar review dokter (S, O, A, P)
      ──► Setujui: snapshot beku ──► Bundle FHIR R4 ──► outbox + worker ──► SATUSEHAT (sandbox)
```

### Kecepatan

ASR berjalan **selama** rekaman: browser mengirim potongan audio tiap 5 detik, server mentranskripsi
tiap ±24 detik audio baru (`MIN_NEW_AUDIO_S`). Setelah Selesai ditekan, layar review langsung terbuka:
dokter mengisi O, lalu S dan usulan ICD disisipkan tanpa memuat ulang halaman. Label pembicara ikut
dalam panggilan ekstraksi S, dan kata kunci ICD dicari paralel.

Rekaman 98 detik (CPU i5-12450H, whisper-small, Gemini): S tampil 17–25 detik setelah Selesai,
sebelumnya 144 detik. Ukur ulang dengan `scripts/simulate_live.py <berkas.webm>`.

## Menjalankan

```bash
python -m venv .venv
.venv/Scripts/pip install -r requirements.txt
cp .env.example .env        # lalu isi
.venv/Scripts/python -m uvicorn app.main:app --port 8000
```

Buka http://localhost:8000, masuk dengan `perawat` / `dokter` / `admin` (kata sandi = `DEMO_PASSWORD`).

| Variabel `.env` | Untuk |
|---|---|
| `LLM_PROVIDERS` | `gemini,anthropic` (dicoba berurutan). `mock` hanya untuk uji alur, bukan hasil klinis. |
| `GEMINI_API_KEY`, `ANTHROPIC_API_KEY` | Kunci API LLM. Jangan pernah ditulis di notebook atau repo. |
| `SATUSEHAT_MODE` | `mock` (tanpa internet) atau `sandbox` (isi `SATUSEHAT_CLIENT_ID/SECRET`; cocokkan URL dengan environment Postman). |
| `ASR_MODEL` | `small`/`medium`/`large-v3-turbo`, atau path folder CT2 hasil `notebooks/train_asr_v2.ipynb`. |

Tabel ICD-10 lengkap: taruh `icd10_satusehat.csv` (kolom `CODE,DISPLAY,VERSION`, dari eksplorasi Nisa) di
`data/`. Tanpa file itu dipakai `data/icd10_seed.csv` (±40 kode umum poli anak).

## Uji

```bash
.venv/Scripts/python -m pytest -q
```

Mencakup: bentuk bundle sama dengan mini-bundle yang terbukti 201 di sandbox, gerbang persetujuan dokter,
pra-periksa (IHS, ICD, rujukan), retry timeout, rekonsiliasi duplikat 20002 saat respons hilang,
rujukan rusak → NEEDS_ATTENTION, normalisasi WER, retrieval ICD, dan uji asap HTTP ujung ke ujung.

## Struktur

| Path | Isi |
|---|---|
| `app/main.py` | Rute web: login, kunjungan, persetujuan rekam, unggah audio, review, status kirim, dasbor |
| `app/models.py` | Tabel: visits, consents, scribe_sessions, clinical_notes, review_edits, satusehat_submissions (outbox), resource_map, audit_log |
| `app/scribe/` | ASR, label pembicara, ekstraksi S + grounding, ICD-10, penyedia LLM, normalisasi WER |
| `app/fhir/` | Pembentuk Bundle (Encounter, Condition, Observation, ClinicalImpression, MedicationRequest) dan pra-periksa |
| `app/satusehat/client.py` | Klien OAuth2 + kirim bundle + cari Encounter/pasien; `MockSatusehat` untuk uji |
| `app/sync/worker.py` | Status QUEUED → SENDING → SENT / RETRY_WAIT / NEEDS_ATTENTION / RECONCILING |
| `notebooks/train_asr_v2.ipynb` | Latih ulang Whisper (Kaggle): WER ternormalisasi, baseline vs sesudah, data klinis sintetis |

## Metrik proposal dan di mana diukur

| Target | Sumber angka |
|---|---|
| WER ≤ 15–20% | `notebooks/train_asr_v2.ipynb` sel 9 (`wer_report.csv`), normalisasi = `app/scribe/textnorm.py` |
| F1 ekstraksi ≥ 0,80 | Belum: perlu 20–30 skenario + kunci jawaban dr. Danang |
| Koreksi dokter ≤ 20% per isian | Dasbor → tabel `review_edits` (nilai AI vs final saat disetujui) |
| Waktu dokumentasi −20–30% | Dasbor → waktu proses per tahap; waktu manual diukur saat uji pengguna |

## Batasan yang diketahui

- AllergyIntolerance belum masuk bundle (alergi disimpan terstruktur, tetapi butuh kode SNOMED alergen).
- Katalog obat baru satu produk KFA yang terbukti (Paracetamol sirup 93001926).
- LOINC nadi, laju napas, SpO2 belum pernah dikirim ke sandbox (ditandai * di layar).
- Koreksi setelah SENT belum didukung (cara update resource di SATUSEHAT belum dieksplorasi).
- Sebut "terintegrasi dengan sandbox SATUSEHAT", bukan produksi.
