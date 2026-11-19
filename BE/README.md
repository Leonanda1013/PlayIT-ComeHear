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
dalam panggilan ekstraksi S. Kata kunci ICD dari hasil itu dipakai kembali untuk pencarian kode;
panggilan Gemini tambahan hanya diperlukan jika kata kuncinya kosong. Jika semua model Gemini
gagal sementara (429/5xx), backend mencoba sekali lagi setelah jeda singkat.

Rekaman 98 detik (CPU i5-12450H, whisper-small, Gemini): S tampil 17–25 detik setelah Selesai,
sebelumnya 144 detik. Ukur ulang dengan `scripts/simulate_live.py <berkas.webm>`.

## Menjalankan

```bash
python -m venv .venv
.venv/Scripts/pip install -r requirements.txt
.venv/Scripts/python -m piper.download_voices id_ID-news_tts-medium --download-dir models/piper
cp .env.example .env        # lalu isi
.venv/Scripts/python -m uvicorn app.main:app --port 8000
```

Buka http://localhost:8000 dan masuk dengan email `rian@rumahsakit.id` (dokter), `perawat@rumahsakit.id`,
atau `admin@rumahsakit.id`; kata sandi = `DEMO_PASSWORD`. Antrean demo hari ini bisa diisi dari tombol
"Isi antrean demo" di halaman antrean atau Pendaftaran.

Pengumuman antrean menggunakan model neural Piper Bahasa Indonesia yang diunduh sekali
ke `BE/models/piper`. Setelah diunduh, sintesis berjalan di backend tanpa layanan suara eksternal.

Alur layar (mengikuti desain UI): **Antrean** (Panggil → Isi SOAP) → **S** (persetujuan rekam, rekam,
transkrip, draf S) → **O-A-P** (tanda vital, diagnosis ICD-10 dengan usulan AI, plan, Inst/Impl, evaluasi)
→ **Verifikasi** (konfirmasi dokter, Validasi dan Simpan → kirim SATUSEHAT) → **Resume**.

Database lama dari versi sebelum UI baru: jalankan sekali `.venv/Scripts/python scripts/upgrade_demo.py`
(menambah kolom baru tanpa menghapus data, lalu mengisi antrean demo).

### Supabase PostgreSQL

1. Dari folder `BE`, isi `DATABASE_URL` di `.env` dengan URI PostgreSQL Supabase dari **Database → Connect**. Variabel ini wajib; server tidak memakai SQLite sebagai fallback. `.env` diabaikan Git. Isi juga `SECRET_KEY` dan `DEMO_PASSWORD`.
2. Untuk database yang sudah berisi data, jalankan `.venv/Scripts/python scripts/test_db_connection.py --inspect-only` lebih dulu. Perintah ini hanya membaca koneksi serta menunjukkan tabel dan kolom yang belum ada.
3. Jika migrasi diperlukan, buat backup lalu jalankan `.venv/Scripts/python scripts/test_db_connection.py`. Perintah ini membuat tabel, menambah kolom, dan melakukan seed pada database baru. Startup server juga melakukan inisialisasi yang sama.

NIK pasien dilindungi oleh validasi API dan indeks unik database. Pemeriksaan `--inspect-only` juga
menampilkan jumlah NIK ganda dan keberadaan indeks tersebut sebelum migrasi dijalankan.

### Pembagian akses backend

| Area | Dokter | Admin/t rekam medis |
|---|---:|---:|
| Antrean dokter, panggil pasien, SOAP, scribe/audio, ICD/KFA, persetujuan | Ya | Tidak |
| Pendaftaran, koreksi identitas pasien, konfirmasi kedatangan | Tidak | Ya |
| Pantau/koreksi/kirim ulang SATUSEHAT dan dasbor operasional | Tidak | Ya |
| Resume dan riwayat kunjungan | Ya | Ya |

Koreksi identitas SATUSEHAT memakai `POST /submissions/{id}/correct-identity`. Endpoint ini membangun
bundle revisi baru dan menyimpan hubungan ke submission lama. `POST /submissions/{id}/requeue` hanya
memakai bundle lama untuk gangguan sementara. Sesi rekaman yang terputus dapat diperiksa melalui
`GET /visits/{id}/recording-recovery`, lalu dilanjutkan atau ditutup dengan endpoint `resume`/`abandon`.
Endpoint persetujuan mewajibkan `decision` (`setuju`/`tolak`), `given_by_name`, dan `relation`; setiap
perubahan disimpan pada `consent_history` bersama versi teks dan petugas pencatat.

Untuk sandbox, set `ENABLE_DEMO_SEED=false`, gunakan `SECRET_KEY` acak minimal 32 karakter, isi kredensial
SATUSEHAT, batasi `CORS_ORIGINS`, dan aktifkan `SECURE_COOKIES` saat API dilayani melalui HTTPS.

Versi Scribe/ICD-10 saat ini memerlukan `data/icd10_satusehat.csv` dengan kolom `CODE,DISPLAY,VERSION`. File ini dibaca dari disk, bukan dari tabel PostgreSQL; tanpa file tersebut, pencarian ICD-10 dan pipeline Scribe gagal.

| Variabel `.env` | Untuk |
|---|---|
| `LLM_PROVIDERS` | `gemini` untuk API atau `mock` untuk uji alur, bukan hasil klinis. |
| `GEMINI_API_KEY` | Kunci API Gemini. Jangan pernah ditulis di notebook atau repo. |
| `GEMINI_MODELS` | Urutan fallback: `gemini-3.6-flash,gemini-3.5-flash-lite,gemini-3.5-flash`. Model yang baru gagal sementara diletakkan paling akhir selama cooldown. |
| `SATUSEHAT_MODE` | `mock` (tanpa internet) atau `sandbox` (isi `SATUSEHAT_CLIENT_ID/SECRET`; cocokkan URL dengan environment Postman). |
| `ASR_MODEL` | `small`/`medium`/`large-v3-turbo`, atau path folder CT2 hasil `notebooks/train_asr_v2.ipynb`. |

Katalog ICD-10 lengkap: taruh `icd10_satusehat.csv` (kolom `CODE,DISPLAY,VERSION`, dari eksplorasi Nisa) di
`data/`.

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
