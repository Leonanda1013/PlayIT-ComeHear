# Pembagian tugas refactor lapisan LLM ComeHear

Diperbarui: **23 November 2026**.

Rencana ini menggantikan pembagian tugas luas pada versi sebelumnya. Acuan: peninjauan source pada 22 November 2026 (commit `080cbcc`), tanggapan Claude yang dilampirkan, dan kesepakatan terbaru di chat. Checkbox mencatat status pekerjaan yang sudah diverifikasi. A1–A5 kini diimplementasikan; B1–B4 tetap menjadi pekerjaan Kemal. Rincian implementasi dan batas verifikasi ada pada bagian 9.

## 1. Keputusan dan lingkup

- **Claude menjadi provider aktif untuk penggunaan saat ini:** `LLM_PROVIDERS=claude`.
- Adapter **Gemini dan OpenAI** tetap tersedia untuk pergantian provider berikutnya, tetapi tidak menjadi fallback otomatis dalam konfigurasi aktif tersebut.
- Pemanggilan publik tetap `LLM.generate(system, prompt, schema) -> (objek_pydantic, nama_model)`.
- Metadata token menggunakan jalur terpisah dari tuple publik agar pemanggil di `extract.py` tidak perlu diubah.
- Registry menentukan urutan provider dari konfigurasi. Fallback lintas provider hanya berjalan jika beberapa provider secara eksplisit dikonfigurasi.
- Mock tetap untuk tes; kegagalan Claude pada konfigurasi aktif tidak diam-diam menghasilkan keluaran mock.

**Masuk lingkup:** registry sederhana, adapter Claude/OpenAI, pemeliharaan adapter Gemini, konfigurasi, metadata token, tes tanpa API, dan evaluasi kecil.

**Tetap memakai bentuk sekarang:** `extract.py`, prompt, schema klinis, frontend, endpoint, database, ASR, dan SATUSEHAT. `pipeline.py` hanya mendapat perubahan kecil untuk menyimpan metadata pemakaian LLM pada kolom JSON yang sudah ada, tanpa migrasi database.

**Di luar pekerjaan ini:** modularisasi besar backend/FE, perubahan rekaman/recovery, koreksi submission SATUSEHAT, resume cetak, pemrosesan identitas, perubahan consent, perbaikan transaksi/finalisasi, fine-tuning ASR, dan framework pembungkus seperti LiteLLM. Temuan audit sebelumnya tetap memerlukan penanganan terpisah; bukan syarat penyelesaian refactor adapter ini.

## 2. Kontrak yang disepakati sebelum bekerja paralel

| Bagian | Kesepakatan |
| --- | --- |
| Input adapter | `system`, `prompt`, kelas schema Pydantic. |
| Hasil internal | Data tervalidasi, nama provider/model, dan metadata usage. Definisi persis dibuat pada A1. |
| Hasil publik `LLM.generate()` | Tetap dua nilai: `(data, nama_model)`. |
| Usage | Input/output token bila tersedia; nilai tidak diketahui ditandai `null`, bukan nol. |
| Error | Bedakan konfigurasi/kredensial, gangguan sementara, dan output invalid; gunakan kontrak error bersama. |
| Retry | Terbatas, dengan timeout/deadline yang jelas; perhitungkan retry SDK agar tidak berlipat tanpa batas. |
| Kompatibilitas | Pertahankan `LLM.providers` dan `LLM.use_mock` selama `extract.py` masih memakainya untuk memilih schema. |
| Metadata | Dikumpulkan per instance/job LLM, bukan counter global lintas pasien. Pemanggilan baru tidak boleh membawa usage sesi lain. |

Kontrak internal boleh memuat token, tetapi jangan mengubah tuple publik menjadi tiga nilai. Jangan merapikan ketergantungan mock/schema dalam pekerjaan ini karena akan memperluas perubahan ke `extract.py`.

## 3. Pembagian tugas dan kepemilikan file

Semua path berikut relatif terhadap root repositori. File bertanda baru adalah usulan lokasi yang disepakati pada persiapan.

| ID | PIC | Tugas | File yang dimiliki |
| --- | --- | --- | --- |
| A1 | Kamu | Kontrak adapter, error, metadata usage, dan registry | `BE/app/scribe/llm.py`, `BE/app/scribe/llm_types.py` (baru). |
| A2 | Kamu | Adapter Claude dan kompatibilitas Gemini | `BE/app/scribe/llm_claude.py` (baru), bagian Gemini/facade di `llm.py`. |
| A3 | Kamu | Konfigurasi seluruh provider dan dependensi | `BE/app/config.py`, `BE/.env.example`, `BE/requirements.txt`. |
| A4 | Kamu | Pengumpulan usage dan penyimpanan metadata sesi | `BE/app/scribe/llm.py`, perubahan kecil `BE/app/scribe/pipeline.py`. |
| A5 | Kamu | Tes registry, Claude, dan regresi Gemini | `BE/tests/test_llm_registry.py`, `BE/tests/test_llm_claude.py` (baru), `BE/tests/test_llm_retry.py` yang sudah ada bila diperlukan. |
| B1 | Kemal | Adapter OpenAI | `BE/app/scribe/llm_openai.py` (baru). |
| B2 | Kemal | Tes adapter OpenAI | `BE/tests/test_llm_openai.py` (baru). |
| B3 | Kemal | Kasus evaluasi dan jawaban acuan | `BE/data/naskah_uji/llm/` (baru). |
| B4 | Kemal | Skrip evaluasi provider | `BE/scripts/eval_llm.py` (baru). |

**Aturan batas file:** Kemal tidak mengedit `llm.py`, `llm_types.py`, `config.py`, `.env.example`, `requirements.txt`, atau `pipeline.py`. Kamu tidak mengedit adapter/tes OpenAI, fixture evaluasi, atau skrip evaluasi milik Kemal selama pengerjaan paralel. Kebutuhan perubahan kontrak/config disampaikan ke kamu sebagai pemiliknya.

## 4. Checklist tugas kamu

### A1 — Kontrak dan registry

- [x] Tetapkan tipe hasil internal adapter, metadata usage, dan error bersama di `llm_types.py`.
- [x] Ganti pemilihan provider melalui percabangan khusus dengan registry sederhana; pertahankan jalur mock.
- [x] Pertahankan signature publik dan atribut yang masih dibaca `extract.py`.
- [x] Nama provider tidak dikenal menghasilkan error jelas. Provider tanpa key mengikuti aturan skip yang disepakati, dengan pesan aman; jika tidak ada provider aktif, proses harus gagal jelas.
- [x] Bekukan nama field konfigurasi yang dibutuhkan Kemal sebelum pekerjaan adapter dimulai.

**Selesai jika:** kontrak dapat diimpor adapter terpisah tanpa impor melingkar dan pemanggil lama tetap menerima dua nilai. A1 adalah persiapan bersama, bukan pekerjaan yang dilakukan bersamaan dengan perubahan kontrak oleh Kemal.

### A2 — Claude dan pemeliharaan Gemini

- [x] Implementasikan Claude melalui SDK resmi; validasi respons terhadap schema Pydantic yang diberikan pemanggil.
- [x] Tangani respons kosong/tidak lengkap, penolakan, output invalid, dan error provider sesuai kontrak A1.
- [x] Verifikasi metode structured output, parameter, nama model, dan retry terhadap dokumentasi resmi SDK/model saat implementasi. Jangan langsung menyalin asumsi `effort`, `temperature`, atau nama model dari lampiran.
- [x] Pertahankan perilaku Gemini yang ada: urutan model, cooldown, timeout, dan retry terbatas; sesuaikan hanya yang diperlukan oleh kontrak internal.
- [x] Tidak mengubah prompt klinis untuk mengejar hasil provider tertentu pada PR adapter.

**Selesai jika:** Claude menghasilkan objek tervalidasi dan identitas model; tes regresi membuktikan perilaku Gemini tetap berjalan.

### A3 — Konfigurasi dan dependensi

- [x] Tambahkan field konfigurasi Claude dan OpenAI beserta nama model/key; pertahankan konfigurasi Gemini.
- [x] Tambahkan dependensi SDK `anthropic` dan `openai` yang diperlukan.
- [x] Jadikan Claude pilihan aktif/default yang didokumentasikan: `LLM_PROVIDERS=claude`. Key tetap di environment lokal, tidak di-commit.
- [x] Jelaskan konfigurasi alternatif untuk Gemini/OpenAI sebagai pilihan eksplisit, bukan fallback aktif bawaan.
- [x] Prioritaskan OpenAI resmi. Dukungan `base_url` khusus boleh disiapkan, tetapi kompatibilitas Ollama/OpenRouter/vLLM/LM Studio tidak dijanjikan dalam tahap ini.

**Selesai jika:** konfigurasi Claude, Gemini, dan OpenAI tersedia tanpa edit prompt/pipeline; konfigurasi aktif Claude tidak memanggil provider lain saat gagal. Adapter OpenAI sendiri tetap menunggu B1 Kemal.

### A4 — Metadata penggunaan token

- [x] Kumpulkan metadata setiap panggilan, termasuk task/model, token tersedia, dan durasi yang diperlukan.
- [x] Tentukan definisi total yang dilaporkan: pisahkan usage yang diketahui dari attempt gagal yang usage-nya tidak tersedia. Jangan menyebut total tersebut sebagai biaya lengkap bila ada usage yang hilang.
- [x] Sediakan cara membaca usage per instance LLM yang juga dapat dipakai skrip Kemal.
- [x] Simpan report scribe pada `ScribeSession.model_info["llm_usage"]`. Report ICD background menjadi baris `AuditLog` tersendiri agar job paralel tidak saling menimpa JSON sesi; tidak ada migrasi database.
- [x] Sertakan jalur rekomendasi ICD background yang menggunakan instance LLM sendiri, tanpa mencampur/menimpa metadata job lain.
- [x] Jangan mencatat prompt, transkrip, atau API key di log usage.

**Selesai jika:** tuple publik tetap sama, metadata antarjob terpisah, dan usage yang tidak diketahui tidak ditampilkan sebagai nol.

### A5 — Tes lapisan bersama

- [x] Uji pemilihan Claude saja, urutan fallback yang dikonfigurasi, nama tidak dikenal, provider tanpa key, dan seluruh provider gagal.
- [x] Uji respons Claude valid, tidak lengkap, error, dan gagal validasi memakai fake SDK.
- [x] Pastikan konfigurasi Claude saja tidak fallback ke Gemini/OpenAI/mock.
- [x] Pertahankan tes retry/cooldown Gemini; sesuaikan assertion internal hanya jika diperlukan.
- [x] Uji kompatibilitas tuple publik dan isolasi metadata usage.

**Selesai jika:** tes unit tidak memanggil jaringan dan tidak membutuhkan key asli.

## 5. Checklist tugas Kemal

### B1 — Adapter OpenAI

- [ ] Implementasikan adapter mengikuti kontrak A1 dan field konfigurasi A3 yang sudah dibekukan.
- [ ] Gunakan SDK resmi OpenAI dan prioritaskan endpoint resmi.
- [ ] Validasi hasil terhadap schema Pydantic; tangani error/penolakan/hasil tidak lengkap secara eksplisit.
- [ ] Kembalikan metadata usage bila tersedia; pakai nilai tidak diketahui saat tidak tersedia.
- [ ] Jika `base_url` khusus disediakan, jangan menganggap semua server mendukung structured output yang sama. Dukungan server lokal dapat dikerjakan terpisah.

**Selesai jika:** adapter bisa diuji sendiri tanpa mengubah facade `llm.py` dan tanpa API sungguhan. Kamu yang mendaftarkannya ke registry saat integrasi.

### B2 — Tes OpenAI

- [ ] Uji sukses, timeout, rate limit, output invalid, dan usage tidak tersedia dengan fake SDK.
- [ ] Pastikan identitas provider/model serta metadata sesuai kontrak bersama.
- [ ] Jangan menulis ulang registry/config atau mengubah tes Claude/Gemini.

**Selesai jika:** adapter mempunyai tes mandiri dan tidak bergantung pada urutan eksekusi provider lain.

### B3 — Set evaluasi kecil

- [ ] Siapkan 5–10 transkrip sintetis/role-play; jangan otomatis menganggap semua draf yang sudah tersimpan aman dipakai.
- [ ] Sertakan negasi, alergi, obat/dosis, informasi kurang, ketidakpastian, dan pembicara berbeda.
- [ ] Simpan jawaban acuan S, label pembicara, serta kode/kandidat ICD yang dapat diterima; minta peninjauan dokter/pembimbing.
- [ ] Jangan menilai kesetaraan klinis hanya dengan kecocokan kalimat. Sediakan penilaian manual untuk fakta yang benar/hilang/tambahan.

**Selesai jika:** format fixture konsisten dan kasus yang sama dapat digunakan ulang setelah pergantian model.

### B4 — Skrip evaluasi

- [ ] Buat skrip yang memilih provider/model dan kasus secara eksplisit, mengikuti pola script evaluasi yang ada.
- [ ] Pisahkan evaluasi transkrip → S dari konteks klinis acuan → usulan ICD agar kesalahan S tidak mengaburkan evaluasi ICD.
- [ ] Laporkan kelengkapan/fakta tambahan, negasi, label pembicara, ICD top-3, waktu, token, dan kegagalan.
- [ ] Gunakan akses metadata dari A4 setelah tersedia; sebelum integrasi, bangun pengujian skrip dengan fake LLM/fixture.
- [ ] Estimasi biaya hanya jika harga dan usage tersedia; catat sumber/tanggal harga dan keterbatasan token retry. Jangan hardcode angka dari chat lama.
- [ ] Untuk tahap ini, jalankan uji API nyata pada Claude saja. Gemini/OpenAI cukup fake SDK; evaluasi berbayar lain dapat menyusul.
- [ ] Skrip tidak menulis database aplikasi, mengirim SATUSEHAT, atau menjalankan training.

**Selesai jika:** satu perintah menghasilkan laporan per kasus yang dapat dibandingkan, dengan konfigurasi dan versi prompt/model tercatat.

## 6. Urutan kerja paralel dan titik integrasi

| Tahap | Kamu | Kemal | Dependensi / hasil |
| --- | --- | --- | --- |
| Persiapan | A1 + kerangka A3 untuk seluruh provider. | Meninjau kontrak dan mulai B3. | Commit bersama berisi tipe, error, nama konfigurasi, dan bentuk akses metadata yang direncanakan. |
| Paralel | A2, penyelesaian A3, A4, A5. | B1, B2, B3, B4 dengan fake LLM bila perlu. | File implementasi dan tes berbeda. Perubahan kontrak hanya melalui pemilik A1. |
| Integrasi | Daftarkan adapter OpenAI setelah B1/B2 selesai; satukan penyimpanan metadata. | Hubungkan skrip evaluasi ke facade dan akses usage yang sudah selesai. | Tahap ini berurutan; integrasi bukan pekerjaan edit bersama pada file yang sama. |
| Pemeriksaan akhir | Uji aplikasi dengan konfigurasi Claude saja. | Jalankan evaluasi Claude dan periksa hasilnya. | Review silang, tes regresi, dan laporan hasil. |

- Gunakan branch terpisah dari commit persiapan yang sama, misalnya `codex/llm-claude-core` dan `codex/llm-openai-evaluation`.
- Kamu menjadi integrator file bersama; Kemal mengirim PR adapter/evaluasi yang hanya menyentuh file miliknya.
- Perubahan notebook/training Kemal tetap berada di pekerjaan lain agar tidak masuk PR adapter.
- Jangan menjanjikan bebas konflik hanya dari branch berbeda. Kepemilikan file dan kontrak yang dibekukan mengurangi benturan; hasil merge tetap diperiksa.
- Checklist pada dokumen ini diperbarui satu integrator saat merge agar dokumen tidak menjadi file konflik baru.

## 7. Kriteria selesai bersama

- [ ] Aplikasi memakai Claude melalui `LLM_PROVIDERS=claude`.
- [x] Pemanggilan publik tetap menghasilkan dua nilai dan seluruh schema klinis tetap memakai bentuk sekarang.
- [ ] Adapter Gemini dan OpenAI tersedia serta lolos tes fake SDK, tanpa aktif sebagai fallback bawaan.
- [x] Fallback hanya mengikuti daftar provider yang secara eksplisit dikonfigurasi.
- [x] Retry/timeout terbatas dan kegagalan tidak menghasilkan sukses atau mock palsu.
- [x] Metadata token per job tersimpan tanpa perubahan schema database, tanpa secret/transkrip pada log.
- [x] Tes lama yang relevan dan tes adapter baru lulus; tes yang tidak dapat selesai dilaporkan terpisah.
- [ ] Evaluasi kecil Claude menghasilkan laporan untuk ditinjau; kualitas rendah tidak otomatis diselesaikan dengan perubahan prompt dalam scope ini.
- [x] Tidak ada perubahan frontend, route, ASR, FHIR, atau struktur database dalam PR adapter.

## 8. Baseline dari pemeriksaan sebelumnya

Ini hasil pemeriksaan **22 November 2026**, bukan pemeriksaan ulang pada pembaruan dokumen ini:

- FE typecheck/build lewat binary lokal lulus; bundle JS sekitar 607,73 kB sebelum gzip memunculkan warning.
- FE lint lewat binary lokal selesai dengan exit 0 dan 19 warning.
- BE: **36 tes lulus, 1 deselected**, dengan `tests/test_e2e.py` dikecualikan dan `test_background_trigger_suggest_icd_on_save_soap` tidak dijalankan.
- Dua tes HTTP belum mempunyai baseline lulus. Percobaan diagnostik tertahan pada inisialisasi event loop Windows/`socketpair` di TestClient sebelum request masuk aplikasi; perlu diuji ulang pada lingkungan yang mendukungnya.
- Hasil unit/fake SDK tidak membuktikan kualitas Claude atau keberhasilan panggilan API nyata; keduanya diperiksa pada integrasi/evaluasi.

**Langkah berikutnya:** kontrak A1 dan konfigurasi A3 sudah tersedia. Kemal dapat mulai B1–B4 dengan batas file pada bagian 3 dan kontrak konkret pada bagian 9.

## 9. Hasil implementasi A1–A5 — 23 November 2026

Bagian kamu sudah diimplementasikan dan diuji tanpa panggilan API berbayar. Bagian B1–B4 Kemal belum dikerjakan.

- Kontrak konkret: `Provider.generate(system, prompt, schema) -> ProviderResult(data, model, attempts)` di `BE/app/scribe/llm_types.py`. `LLM.generate()` publik tetap mengembalikan `(data, nama_model)`.
- Tiap request dicatat sebagai `Attempt(provider, model, duration_s, status, usage, error_kind)`. `TokenUsage` memisahkan input, output, cache-read, cache-creation, dan thinking bila tersedia. Error memakai `LLMError(kind=..., attempts=...)` dengan jenis `configuration`, `transient`, `invalid_output`, atau `permanent`.
- `llm.usage_report()` menghasilkan snapshot JSON independen dengan `calls`, `totals`, `unknown_usage_attempts`, `complete`, dan `skipped_providers`. Total hanya menjumlahkan token yang diketahui; bukan estimasi biaya lengkap.
- Report scribe tersimpan pada `ScribeSession.model_info["llm_usage"]`, termasuk saat proses gagal. Report ICD background tersimpan append-only pada `AuditLog(action="llm_usage_icd", obj="visit:<id>")`; JSON `summary` berisi `job_id` unik dan `usage`, termasuk hasil saran kosong/gagal. Ini menghindari pembaruan bersamaan pada JSON metadata sesi.
- Claude memakai `client.messages.parse(output_format=schema)`, model default `claude-sonnet-5-5`, tanpa parameter temperature/effort khusus model. Retry SDK dimatikan; secara default adapter mencoba maksimal dua request, timeout 45 detik per request, dan jeda retry 1 detik hanya untuk gangguan sementara. Output ditolak/terpotong/invalid tidak diulang otomatis.
- Gemini mempertahankan daftar model, cooldown, timeout, dan satu retry tambahan setelah model fallback; metadata ditambahkan tanpa mengubah prompt klinis.
- Default konfigurasi, `.env.example`, dan `LLM_PROVIDERS` pada `.env` lokal sudah memilih `claude`. Nilai konfigurasi lokal lain dipertahankan. `ANTHROPIC_API_KEY` lokal belum terisi saat pemeriksaan; aktivasi API nyata masih memerlukan key tersebut dan restart backend.
- `anthropic>=2.8,<3` dan `openai>=2,<3` ditambahkan ke requirements. SDK Anthropic terpasang dan diuji menggunakan transport tiruan; SDK OpenAI belum dipasang/digunakan pada lingkungan ini karena B1 masih menunggu Kemal.
- Tes regresi tanpa dua tes HTTP yang sebelumnya tertahan runtime dijalankan dengan SQLite eksplisit, LLM mock, dan SATUSEHAT mock. **67 lulus, 1 deselected** dalam 21,25 detik; `tests/test_e2e.py` dikecualikan dan satu tes HTTP background tidak dijalankan karena kendala runtime sebelumnya. Syntax compile pada file Python yang berubah juga lulus. Perintah: `.venv/Scripts/python -m pytest tests --ignore=tests/test_e2e.py -k "not background_trigger_suggest_icd_on_save_soap" -q` dari folder `BE`.

### Kontrak integrasi untuk Kemal

1. Buat `BE/app/scribe/llm_openai.py` dengan kelas `OpenAIProvider`, atribut `name = "openai"`, constructor `__init__(settings)`, dan metode `generate()` sesuai kontrak di atas. Registry sudah memuat kelas tersebut secara lazy ketika `openai` dipilih; Kemal tidak perlu mengedit `llm.py`.
2. Gunakan `settings.openai_api_key`, `settings.openai_model`, `settings.openai_base_url`, `settings.llm_timeout_s`, dan `settings.llm_max_retries`. Model OpenAI sengaja belum diberi default; pilih secara eksplisit ketika B1 dikerjakan.
3. Import tipe/error dari `app.scribe.llm_types`, bukan dari facade registry. Kembalikan objek Pydantic tervalidasi dan seluruh attempt yang diketahui, termasuk attempt gagal sebelum fallback/retry.
4. `LLM_PROVIDERS=openai` saat ini menghasilkan error konfigurasi yang jelas karena adapter belum ada. Tes integrasi memakai adapter tiruan membuktikan file Kemal dapat dipasang tanpa perubahan registry.
5. Evaluasi B4 dapat membaca `llm.usage_report()` langsung tanpa database. Jangan menyamakan token yang tidak tersedia dengan nol atau menganggap cache/thinking antarprovider memiliki semantik billing yang sama.

Referensi implementasi: [Claude structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs), [Python SDK dan retry/timeout](https://platform.claude.com/docs/en/cli-sdks-libraries/sdks/python). Tidak ada prompt, schema klinis, frontend, endpoint, ASR, atau struktur database yang diubah.
