# ComeHear · DESIGN.md

Panduan desain dan handoff untuk prototipe desktop **ComeHear — AI Medical Scribe**. Acuan dokumen ini adalah page **Prototipe ComeHear - PenguasaLimit** di file **Play IT**, ditinjau 15 November 2026. [Buka page Figma][figma]

Dokumen ini mencatat tampilan dan interaksi yang ada, menetapkan aturan untuk desain lanjutan, dan menginventarisasi frame, dialog, komponen, serta aset referensi di page tersebut. Bagian **Catatan handoff** menandai selisih antara canvas dan perilaku yang diharapkan. Nama dan tanggal pasien pada prototipe adalah data contoh dan tidak perlu disalin ke implementasi.

- [Tujuan dan konteks layanan](#1-tujuan-dan-konteks-layanan)
- [Kerangka tampilan dan gaya](#2-kerangka-tampilan-dan-gaya)
- [Layar Dokter](#3-layar-dokter)
- [Layar Perekam Medis](#4-layar-perekam-medis)
- [Akun dan navigasi](#5-akun-overlay-dan-navigasi-lintas-peran)
- [Aturan desain lanjutan](#6-aturan-desain-lanjutan)
- [Catatan handoff](#7-catatan-handoff-dari-canvas)
- [Inventaris canvas](#8-inventaris-canvas)
- [Style warna lokal](#9-style-warna-lokal)

## 1. Tujuan dan konteks layanan

ComeHear mendukung alur dari pendaftaran kunjungan hingga dokumentasi SOAP, validasi dokter, riwayat, dan pemantauan pengiriman rekam medis.

| Peran | Pekerjaan utama | Batas akses pada desain |
| --- | --- | --- |
| Dokter | Memanggil pasien, mengisi SOAP, meninjau draf AI, memvalidasi rekam medis, melihat riwayat | Keputusan klinis dan finalisasi dilakukan oleh dokter. Draf hasil ekstraksi tetap dapat ditinjau. |
| Petugas Rekam Medis | Mendaftarkan pasien dan kunjungan, mengonfirmasi kedatangan, melihat riwayat, memantau SATUSEHAT | Detail SOAP dan diagnosis tampil hanya baca. Perbaikan data klinis masuk kembali ke dokter yang berwenang. |

**Data layanan.** Gunakan **Klinik Bunga Melati**, **Poli Umum**, dan **Bilik Konsultasi 03** sebagai contoh yang konsisten. **Umum 03** adalah bentuk pendek pada pemilih bilik. Dokter dapat berbeda antar kunjungan. Pakai nama, nomor RM, tanggal, poli, dan dokter yang konsisten saat satu kunjungan muncul di beberapa layar. Bedakan tanggal layanan, tanggal kunjungan, dan waktu sinkronisasi.

**Alur antarperan.** Pendaftaran → konfirmasi kedatangan → antrean dokter → SOAP → validasi → riwayat dan pemantauan pengiriman. Pisahkan status **kunjungan**, **draf/finalisasi SOAP**, dan **sinkronisasi SATUSEHAT**. Sebuah kunjungan dapat berstatus Selesai sementara pengiriman masih Dalam Proses.

## 2. Kerangka tampilan dan gaya

### Layout

| Elemen | Acuan Figma | Aturan penggunaan |
| --- | --- | --- |
| Desktop | Frame 1440 × 1024 px | Area kerja mengikuti lebar viewport. Untuk form panjang, gulir konten, jaga konteks pasien dan akses ke aksi akhir. Gunakan ukuran ini sebagai acuan desktop. |
| Sidebar | Lebar 288 px | Logo di atas, menu per peran, profil/akun di bawah. Satu item aktif. Teks dan ikon tetap terlihat pada state aktif dan fokus. |
| Header | Area 1152 px setelah sidebar, tinggi 71 px | Tampilkan poli dan bilik pada layar berbasis layanan. Pada layar pemantauan, tampilkan konteks petugas dan tanggal sesuai frame. Tempatkan pemilih bilik, tanggal, dan notifikasi di kanan jika relevan. |
| Konten | Panel utama 1104 px pada layar dokter, margin sekitar 24 px | Judul dan aksi utama di awal. Filter berdekatan dengan hasilnya. Form dikelompokkan mengikuti urutan kerja. |
| Radius | 8–12 px umum pada kontrol, 12–16 px pada panel | Pakai pil untuk badge status dan tab yang sudah menggunakannya. Jaga input, tombol, dan panel dalam keluarga bentuk yang sama. |
| Spasi | Usulan skala 4, 8, 12, 16, 24, 32 px | Gunakan 8–12 px untuk jarak antar elemen yang berhubungan dan 16–24 px antar kelompok. Ikuti komponen acuan bila sudah tersedia. |

Gunakan latar kerja biru abu muda, panel terang, batas tipis, dan sedikit elevasi pada overlay. Satu panel untuk satu fungsi besar. Pisahkan kelompok di dalamnya dengan judul, ruang, atau garis. Pada layar SOAP yang tinggi, utamakan keterbacaan label dan navigasi keyboard. Untuk viewport lebih sempit, pertahankan urutan isi saat kolom bertumpuk dan beri ruang gulir pada tabel jika dibutuhkan. Desain breakpoint perlu diuji saat implementasi karena acuan utama adalah desktop.

### Tipografi

| Peran teks | Acuan |
| --- | --- |
| Judul halaman | Plus Jakarta Sans Bold 28 px |
| Judul panel/modal | Plus Jakarta Sans Bold 20–22 px pada panel dan dialog yang ditinjau |
| Label, navigasi, dan isi | Plus Jakarta Sans Regular / Medium / SemiBold 12–14 px |
| Isi form klinis dan beberapa kolom antrean | Inter Regular / Medium / Semi Bold / Bold 12–14 px, mengikuti komponen acuan |
| Status dan metadata | 10–12 px pada frame contoh. Tingkatkan ukuran bila teks memuat keputusan penting atau sulit terbaca. |

Pakai label permanen untuk field. Placeholder hanya untuk contoh format. Pertahankan hierarki bobot yang jelas antara nama pasien, nomor RM, label kolom, dan isi tabel. Gunakan bobot ekstra tebal pada wordmark sesuai aset yang ada.

### Warna pada layar yang ditinjau

| Fungsi | Nilai contoh | Pemakaian |
| --- | --- | --- |
| Latar area kerja | `#E8F1F4` | Area utama di balik panel |
| Header / permukaan lembut | `#F6FAFB` | Header dan beberapa permukaan sekunder |
| Panel / isian | `#FFFFFF`, `#F8FBFC` | Tabel, form, dialog, dan input |
| Judul / teks utama | `#081D2D` | Judul, identitas pasien, nilai utama |
| Teks sekunder | `#526578` | Keterangan, label, nomor RM, metadata |
| Aksen merek | `#14A3B8` | Aksen ComeHear, pilihan aktif, dan beberapa tombol prototipe |
| Teal gelap | `#006876`, `#0B6E7D` | Tautan, teks interaktif, dan opsi latar tombol dengan teks putih |
| Selesai / berhasil | `#136F4E` pada `#E2F3EC` | Badge selesai atau berhasil terkirim sesuai kolom |
| Gagal | `#C92A2A` pada `#FDE8E8` | Badge gagal dan konteks yang perlu ditindaklanjuti |
| Keluar | `#BF2E36` pada aksi konfirmasi | Aksi yang mengakhiri sesi |

Untuk implementasi, pakai style berdasarkan fungsi. Cek pasangan kontras foreground/background sebelum menyalin warna dari prototipe. Teks putih kecil pada `#14A3B8` memiliki kontras sekitar 3:1. Gunakan teal gelap untuk tombol dengan label putih kecil. Warna status selalu disertai label. [Lihat komponen di Figma][components]

## 3. Layar Dokter

| Layar | Isi dan hierarki | Aksi dan state |
| --- | --- | --- |
| Login | Logo, email, kata sandi, Lupa kata sandi | Frame kosong → contoh terisi → Masuk ke antrean. Tambahkan state validasi di dekat field saat implementasi. [Figma][doc-login] |
| Manajemen kunjungan | Judul antrean hari ini, DPJP aktif, tab dan pencarian, kolom No, Status, Nama Pasien, Draft SOAP, Aksi | Tab Semua Pasien, Saat Ini, Selanjutnya, Menunggu, Selesai. Baris saat ini punya penekanan visual. Tawarkan **Panggil**, **Isi SOAP**, atau **Lihat Resume** sesuai state. [Figma][queue] |
| Subjektif | Identitas pasien → persetujuan → kontrol rekam → transkrip dan ringkasan Subjektif | Persetujuan dan penolakan terlihat bersama. Tanpa izin, lanjut lewat **Isi Manual**. State rekaman siap, merekam, dan tersimpan dibedakan. [Figma][subjective] |
| Objektif | Identitas pasien → tanda vital → keadaan umum, neurologis dan nyeri → fisik → luka → hasil penunjang | State tanpa detail, luka, hasil, dan keduanya. Tombol **Kembali** serta **Lanjut ke Asesmen & Plan** di akhir form. [Figma][objective] |
| Asesmen & Plan | Diagnosis utama/sekunder dan ICD-10 → Permintaan Tindakan → Plan dan resep → konsultasi berikutnya | Pencarian ICD-10, tambah diagnosis, resep opsional, non-racikan dan racikan. **Lanjut ke Validasi**. [Figma][ap] |
| Validasi | Periksa identitas dan SOAP dalam urutan S → O → A → P | **Kembali** ke pengisian atau **Simpan**. Prototipe menuju antrean setelah penyimpanan. [Figma][validate] |
| Antrean setelah simpan | Struktur antrean dipertahankan, pasien yang ditangani muncul sebagai selesai | **Lihat Resume** membuka ringkasan. Aksi lain berada di menu konteks baris. [Figma][queue-done] |
| Riwayat pasien | Tabel kunjungan, cari nama/nomor RM, filter tanggal/poli/status | **Reset** mengosongkan filter. **Lihat detail** ke ringkasan pasien dengan tab SOAP serta transkrip/audio. **Cetak Resume** di area ringkasan. [Figma][doc-history] |
| Pengaturan akun | Profil dokter, fasilitas/poli/bilik aktif, preferensi, keluar akun | Dapat diakses dari popover akun. Logout memerlukan konfirmasi. [Figma][doc-settings] |

### Subjektif dan perekaman

- Tampilkan status mikrofon, tombol rekam dan durasi di posisi tetap. Gunakan waveform sebagai umpan balik ketika ada rekaman. Saat rekaman tersimpan, sediakan **Putar Ulang** dan **Rekam Ulang** sesuai frame.
- Transkrip membedakan pembicara dan waktu. Rangkuman berisi keluhan utama, riwayat penyakit sekarang, dahulu, keluarga, serta penggunaan obat. Beri label **Draf AI** dan sediakan **Edit rangkuman** sebelum dokter melanjutkan.
- Pembatalan atau kegagalan rekam perlu menyediakan jalan kembali ke input manual. Pada riwayat, timeline, kecepatan dan volume berada pada pemutar yang sama. Gunakan label untuk ikon putar/jeda dan tandai waktu aktif.

### Objektif

| Urutan | Isi | Kontrol dan perilaku |
| --- | --- | --- |
| 01 · Tanda vital | Berat badan, tinggi badan, suhu, nadi, tekanan darah, frekuensi pernapasan, SpO₂ | Input angka dengan satuan. Tekanan darah menggunakan **sistolik / diastolik**, dengan slash dari UI. |
| 02 · Keadaan umum, neurologis dan nyeri | Kesadaran, GCS E–V–M, irama nadi, keadaan umum, pupil, refleks cahaya, skrining nyeri, skala dan lokasi | Dropdown untuk pilihan baku, Ya/Tidak untuk skrining, field angka atau teks sesuai muatan. Pupil serta refleks cahaya memakai dua kontrol **kanan / kiri**. |
| 03 · Pemeriksaan fisik | Kepala, Mata, Leher, Dada/Jantung, Paru, Perut, Alat Gerak Atas, Alat Gerak Bawah, Anus–Genitalia, Kulit, Lain-lain | Satu baris per bagian dengan kolom **Normal** dan **Deskripsi/temuan**. Centang mengisi **Dalam batas normal** pada baris itu. Saat centang dilepas, kosongkan teks otomatis jika belum diedit. Lindungi temuan yang sudah diketik dari penimpaan tanpa konfirmasi. |
| 04 · Status lokalis / luka | **Ada luka?** Nama yang bisa diganti, lokasi, ukuran P × L × D dalam cm, dan deskripsi. | **Tidak** menyembunyikan field detail. **Ya** membuka baris pertama. **Tambah luka** dan **Hapus luka** bekerja per entri. Gunakan baris/form ringkas dengan pemisah. |
| 05 · Hasil pemeriksaan penunjang | **Ada hasil pemeriksaan penunjang?** Jenis, nama pemeriksaan, tanggal hasil, ringkasan, sumber/lampiran, keterangan opsional. | **Tidak** menyembunyikan detail. **Ya** membuka entri yang dapat ditambah dan dihapus. Gunakan struktur visual yang sama dengan luka. |

Hasil penunjang di Objektif mendokumentasikan **hasil yang sudah tersedia** dari kunjungan ini atau sebelumnya. Permintaan CT, lab, atau tindakan baru masuk ke **Permintaan Tindakan** pada Asesmen & Plan. Tampilkan label dan satuan meski nilai kosong. Bedakan nilai kosong, pilihan Tidak, dan temuan Normal. Checkbox normal pada frame terisi adalah contoh pengisian. Pada kunjungan baru, dokter menetapkan normal setelah menilai bagian tersebut.

### Asesmen, Plan, dan validasi

- **Asesmen** memiliki diagnosis utama dengan ICD-10 serta pilihan Akut/Kronis. Diagnosis sekunder bersifat berulang. Hasil pencarian ICD-10 memperlihatkan kode dan deskripsi sehingga dokter bisa memeriksa pilihannya.
- **Permintaan Tindakan** memiliki area sendiri. **Plan** menampung rencana perawatan dan edukasi. Rencana konsultasi berikutnya terpisah secara visual sehingga mudah ditemukan kembali.
- **Sertakan resep** mengendalikan visibilitas resep. Non-racikan menampilkan obat (KFA), dosis/satuan, interval, lama, jumlah, bila perlu, dan aturan pakai. Racikan menampilkan nama, bentuk, jumlah, bahan dan dosis per bahan, serta aturan pakai paket. Tambah/hapus resep dan tambah bahan menjaga fokus pada item yang diubah.
- **Validasi** memberi kesempatan memeriksa ulang pilihan diagnosis dan isi SOAP sebelum **Simpan**. Bedakan penyimpanan draf, finalisasi oleh dokter, dan status pengiriman eksternal. Tampilkan hasil proses setelah aksi selesai, termasuk kegagalan yang bisa dicoba ulang.

## 4. Layar Perekam Medis

| Layar | Isi dan hierarki | Aksi dan state |
| --- | --- | --- |
| Login | Struktur sama dengan login dokter, dengan akun contoh petugas | Frame kosong → contoh terisi → Masuk ke Dashboard. [Figma][rm-login] |
| Pilih konteks layanan | Poli, bilik, tanggal, sesi dan dokter opsional | **Buka Rekam Medis**, **Atur ulang**. Poli, bilik, dan tanggal wajib untuk membuka daftar melalui form ini. Sidebar dan pintasan mengikuti rancangan pada frame. [Figma][context] |
| Dashboard | Ringkasan kunjungan hari ini, kedatangan belum dikonfirmasi, sinkronisasi gagal, aktivitas terbaru | **Tambah Kunjungan**, daftar **Perlu Tindakan** untuk konfirmasi kedatangan, dan tautan monitoring. Setelah antrean tindakan selesai, tampilkan state tanpa item. [Figma][dashboard] |
| Pendaftaran · Cari Pasien | Cari pasien lama dan pilih kandidat, formulir pasien baru jika dibutuhkan | Periksa kandidat yang serupa sebelum membuat pasien baru. Form baru memuat nama, NIK, tanggal lahir, jenis kelamin, telepon, alamat. Nomor RM dibuat sistem setelah penyimpanan. [Figma][register-1] |
| Pendaftaran · Data Kunjungan | Ringkasan pasien terpilih, tanggal, poli tujuan, dokter tujuan, jenis kunjungan, catatan administrasi | **Ganti Pasien**, **Kembali**, **Lanjut ke Konfirmasi**. Aksi berpindah langkah mempertahankan data yang sudah diisi selama kunjungan belum disimpan. [Figma][register-2] |
| Pendaftaran · Konfirmasi | Ringkasan identitas dan kunjungan sebelum dikirim | **Konfirmasi Pendaftaran** memasukkan kunjungan ke daftar. Canvas memiliki dialog contoh berhasil dan data belum lengkap. [Figma][register-3] |
| Daftar kunjungan | Ringkasan status, tab **Hari Ini / Mendatang / Riwayat**, cari dan filter, tabel serta paginasi | **Tambah Kunjungan**, **Lihat detail**, **Konfirmasi** saat pasien tiba. Konfirmasi mengubah **Terjadwal** menjadi **Menunggu Pemeriksaan**. Selanjutnya dokter dapat memulai pemeriksaan. [Figma][visits] |
| Riwayat Rekam Medis | Cari nama/nomor RM dan filter tanggal, poli, serta status SATUSEHAT. Tabel menampilkan ringkasan diagnosis dan pengiriman. | **Lihat detail** menuju identitas dan ringkasan SOAP hanya baca. Tab rekaman, waktu validasi, dan Cetak Resume mengikuti desain detail. [Figma daftar][rm-history] · [Figma detail][rm-detail] |
| Integrasi SATUSEHAT | Ringkasan seluruh pengiriman, waktu pembaruan, filter tanggal/poli/status/kendala, tabel pengiriman | **Perbarui Status**, **Lihat detail**, dan **Kirim Ulang** bila sesuai kategori kendala. Frame kedua menunjukkan state setelah pembaruan simulasi. [Figma daftar][sync] · [Figma sesudah pembaruan][sync-updated] |

### Konfirmasi kedatangan dan integrasi

- Dalam dialog kedatangan, tampilkan pasien, tanggal, poli, dokter, dan status sebelum pengguna mengonfirmasi. Varian tabel menunjukkan perpindahan baris setelah konfirmasi; isi ringkasan dan tabel harus mengikuti status yang sama.
- Detail pengiriman menunjukkan identitas singkat, status, kendala, dan tindakan berikutnya. **Gangguan sementara** dapat memberi opsi kirim ulang. **Data administratif** mengarahkan petugas memperbaiki identitas. **Data klinis** mengarahkan kembali ke dokter. **Masalah teknis** memberi informasi yang dapat diteruskan ke pihak yang menangani integrasi. Saat masih diproses, tampilkan status proses.
- Kirim ulang memiliki tahap konfirmasi, dalam proses, berhasil, dan gagal. Selama proses, cegah pengiriman ganda. Setelah gagal, pertahankan data dan sampaikan apakah pengguna dapat mencoba lagi. Ringkasan seluruh data tetap bernama demikian meskipun tabel difilter.

## 5. Akun, overlay, dan navigasi lintas peran

- Pemilih peran menautkan **Dokter** dan **Rekam Medis** ke login masing-masing. Catatan cara memakai prototipe pada pemilih peran ditujukan untuk demo. [Figma][roles]
- Klik profil atau ikon akun pada sidebar untuk membuka popover. Popover dokter berisi ringkasan profil, **Pengaturan**, dan **Logout**. Popover petugas yang ditinjau berisi ringkasan profil dan **Logout**. Ukuran acuan 272 × 172 px.
- **Logout** di popover membuka dialog 500 × 260 px. **Batal** menutup dialog. **Ya, Logout** kembali ke pemilih peran pada prototipe saat ini. Jaga urutan fokus, kembalikan fokus ke pemicu saat dialog ditutup, dan sediakan tindakan batal yang jelas. [Figma menu dokter][doc-account] · [Figma menu petugas][rm-account]
- Gunakan popover untuk aksi singkat, dialog untuk keputusan yang perlu konfirmasi, dan drawer untuk detail kunjungan yang perlu dilihat sambil mempertahankan konteks tabel. Letakkan ringkasan data paling relevan sebelum tombol.

## 6. Aturan desain lanjutan

### Komponen dan state

| Pola | Aturan |
| --- | --- |
| Tombol | Utamakan satu aksi utama per tahap. Label menyebut hasil, misalnya **Lanjut ke Konfirmasi**, **Simpan**, **Kirim Ulang**, dan **Ya, Logout**. Untuk ikon saja, beri nama yang dapat dibaca pembaca layar. |
| Form | Tampilkan label tetap, unit di dekat input, required marker yang konsisten, dan pesan kesalahan di dekat penyebabnya. Saat field baru dimunculkan, posisinya mengikuti pertanyaan pemicu. |
| Data berulang | Gunakan nomor awal untuk membantu orientasi dan biarkan nama luka diedit. Tambah satu entri, hapus entri tertentu. Terapkan pola yang sama pada luka, hasil penunjang, diagnosis tambahan, dan resep. |
| Tabel | Judul kolom tetap, nama pasien dan nomor RM dikelompokkan, aksi di kanan. Pencarian dan filter terlihat sebelum tabel. Jumlah hasil, jumlah total, dan paginasi mengikuti data. |
| Badge | Teks menyebut status konkret. **Tersimpan**, **Selesai**, dan **Berhasil Terkirim** punya arti berbeda. Pakai badge bila arti status membantu mengambil tindakan. |
| Loading / kosong / gagal | Loading mempertahankan struktur. Keadaan kosong menjelaskan apakah belum ada data atau filter tidak menemukan hasil. Kegagalan memberi tindakan yang relevan seperti **Perbarui Status** atau **Lengkapi Data**. |
| Aksesibilitas | Gunakan label yang terhubung ke input, fokus terlihat, urutan tab mengikuti alur, dan status yang terbaca tanpa melihat warna. Pada field berpasangan, beri nama terpisah untuk sistolik/diastolik dan kanan/kiri. |

### Pemeriksaan anti AI slop

| Hindari | Gunakan |
| --- | --- |
| Judul promosi, ilustrasi dekoratif, atau hero pada layar kerja | Judul tugas seperti **Daftar Kunjungan** dengan aksi yang relevan. Simpan ilustrasi untuk layar masuk atau aset demo yang sudah ada. |
| Setiap field dibungkus kartu di dalam kartu | Satu panel per pekerjaan, lalu label, kolom, dan garis pemisah. Contoh: tabel pemeriksaan fisik serta baris luka/hasil penunjang. |
| Gradien, glow, dan aksen warna di setiap komponen | Permukaan terang, border tipis, dan teal pada aksi utama serta pilihan aktif. |
| Badge dekoratif, banyak chip, atau ringkasan angka yang tidak bisa dijelaskan | Tampilkan status yang membantu tindak lanjut. Angka dashboard harus cocok dengan definisi dan cakupan datanya. |
| Copy berulang seperti “Kelola data secara mudah dan efisien” | Jelaskan dampak bila perlu, misalnya **Konfirmasi kedatangan mengubah status menjadi Menunggu Pemeriksaan.** |
| Label kabur seperti **Lanjut**, **Selesai**, atau **Proses** ketika konsekuensinya penting | Sebut tujuan sesuai konteks: **Lanjut ke Validasi**, **Konfirmasi Pendaftaran**, **Kirim Ulang**. |
| Isian demo dianggap nilai default atau informasi asli | Tampilkan placeholder sebagai contoh dan pisahkan data simulasi dari nilai yang tersimpan. |

Sebelum handoff, cek satu jalur kerja setiap peran dari masuk hingga selesai, jalur tanpa rekaman, tambah/hapus luka dan hasil, state tanpa data, pencarian, kegagalan pengiriman, dan logout. Pastikan operator keyboard bisa mencapai aksi yang sama.

## 7. Catatan handoff dari canvas

| Temuan | Keputusan untuk dokumentasi dan implementasi |
| --- | --- |
| Sejumlah instance sidebar Perekam Medis masih menampilkan **RSUD Mitra**. Frame eksplorasi lama juga memuat Poli Penyakit Dalam dan gelar spesialis. | Gunakan **Klinik Bunga Melati** dan **Poli Umum** pada dataset klinik. Selaraskan sumber sidebar dan instance aktif bila desain berikutnya diedit. |
| Frame **Pilih konteks layanan** menjelaskan bahwa menu lain tetap tersedia, tetapi tombol dan pintasannya belum terhubung pada frame yang ditinjau. Login petugas di prototipe langsung menuju Dashboard. | Dokumen mengikuti isi frame untuk cakupan konteks dan mencatat alur yang benar-benar terhubung. Konfirmasi aturan masuk melalui konteks sebelum menjadikannya gerbang seluruh menu. |
| Popover akun menampilkan ringkasan profil. Dari dua peran, hanya popover dokter yang menautkan **Pengaturan**. | Perlakukan profil di popover sebagai ringkasan. Halaman profil terpisah belum terlihat pada canvas ini. |
| Ringkasan SATUSEHAT simulasi menampilkan total 10, sementara tabel menampilkan 7 baris terisi dan jumlah per status belum selalu menjumlah ke total. | Hitung ringkasan, jumlah baris, dan paginasi dari kumpulan data yang sama. Bedakan total global dari hasil filter. |
| Label langkah seperti **A-P**, **Assesment - Plan**, dan **Lanjut ke OAP** bervariasi. | Gunakan **Subjektif**, **Objektif**, **Asesmen & Plan**, dan **Validasi** secara konsisten pada implementasi. |
| Canvas memuat frame dan varian berulang, beberapa tanpa interaksi. | Utamakan frame di section alur sesuai peran. Gunakan inventaris berikut untuk membedakan layar, state, overlay, komponen, dan bahan demo. |

## 8. Inventaris canvas

Tiap tautan menunjuk ke node yang ditemukan saat peninjauan. Ukuran mengikuti frame Figma dan dibulatkan ke piksel. Nama asli layer dipertahankan di inventaris agar mudah dicari.

### 8.1. Layar awal dan alur Dokter

| Node Figma | Ukuran (px) | Fungsi |
| --- | ---: | --- |
| [Desktop - 6](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=1162-13059) | 1440 × 1024 | Pemilih peran Dokter atau Rekam Medis |
| [Login](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=961-11876) | 3655 × 1836 | Section pengelompokan di canvas |
| ↳ [6_Login](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=764-11811) | 1440 × 1024 | Login dokter, isian awal |
| ↳ [6_Login](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=961-11877) | 1440 × 1024 | Login dokter, akun contoh terisi |
| [Manajement Kunjugan](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=961-11914) | 2050 × 1760 | Section pengelompokan di canvas |
| ↳ [1_Manajemen_Kunjungan (Semua Pasien)](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=764-17842) | 1440 × 1024 | Antrean dokter, daftar awal dan filter |
| [S](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=961-15075) | 5639 × 2598 | Section pengelompokan di canvas |
| ↳ [2.SOAP-S Sudah Pilih - Belum Rekam](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=764-10458) | 1440 × 1024 | Persetujuan dan mikrofon siap, sebelum merekam |
| ↳ [2.SOAP-S Sudah Pilih - Belum Rekam](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=764-10632) | 1440 × 1024 | Rekaman tersimpan, transkrip dan Draf AI |
| ↳ [2.SOAP-S Belum Rekam](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=867-18538) | 1440 × 1024 | Sebelum rekam, dengan tautan ketentuan privasi |
| [O](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=961-15083) | 9854 × 3944 | Section pengelompokan di canvas |
| ↳ [4_SOAP-O](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=971-17707) | 1440 × 1024 | Objektif dengan tampilan checklist normal pada data contoh |
| ↳ [4_SOAP-O](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=971-20179) | 1440 × 1024 | Varian Objektif tanpa detail luka atau penunjang |
| ↳ [4_SOAP-O](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=971-20756) | 1440 × 1024 | Objektif dengan form luka |
| ↳ [4_SOAP-O](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=971-21358) | 1440 × 1024 | Objektif dengan luka dan hasil penunjang |
| ↳ [4_SOAP-O](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=971-22021) | 1440 × 1024 | Objektif dengan hasil penunjang |
| [A-P](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=996-22722) | 7457 × 5213 | Section pengelompokan di canvas |
| ↳ [4_SOAP-OAP](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=888-16775) | 1440 × 1024 | Asesmen terisi dan satu formulir non-racikan |
| ↳ [4_SOAP-OAP](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=1008-24565) | 1440 × 1024 | Contoh resep non-racikan dan racikan bersama |
| ↳ [4_SOAP-OAP](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=1008-24291) | 1440 × 1024 | Asesmen terisi dan formulir racikan |
| ↳ [4_SOAP-OAP](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=996-22723) | 1440 × 1024 | Asesmen dan Plan awal, field kosong |
| ↳ [dropdown search ICD-10](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=888-16743) | 452 × 307 | Overlay pencarian kode ICD-10 |
| [Validasi](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=1008-25114) | 3406 × 5213 | Section pengelompokan di canvas |
| ↳ [Verifikasi](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=888-16301) | 1440 × 1024 | Tinjau SOAP sebelum Simpan |
| [Manajemen Kunjungan selesai](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=1012-25178) | 2033 × 1972 | Section pengelompokan di canvas |
| ↳ [1_Manajemen_Kunjungan](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=764-18102) | 1440 × 1024 | Antrean setelah menyimpan SOAP |
| [Riwayat Pasien](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=1012-25179) | 5745 × 4388 | Section pengelompokan di canvas |
| ↳ [7.1_Riwayat seluruh pasien](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=764-12133) | 1440 × 1024 | Daftar riwayat seluruh pasien dokter |
| ↳ [Desktop - 2](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=764-12728) | 1440 × 1024 | Detail riwayat dengan tab Ringkasan SOAP |
| ↳ [8_Setting Dokter](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=943-16642) | 1440 × 1024 | Pengaturan akun dokter |
| ↳ [7.2_Riwayat Pasien](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=888-18953) | 1440 × 1024 | Detail riwayat dengan tab Transkrip & Rekaman Audio |
| ↳ [Popover Profil dan Setting](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=943-16602) | 272 × 172 | Ringkasan profil, Pengaturan, Logout |
| ↳ [popup-konfirmasi-logout](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=943-16628) | 500 × 260 | Konfirmasi logout dokter |

### 8.2. Layar dan state Perekam Medis

| Node Figma | Ukuran (px) | Fungsi |
| --- | ---: | --- |
| [Login Rekam Medis](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=1259-15666) | 6226 × 2532 | Section pengelompokan di canvas |
| ↳ [6_Login](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=764-17295) | 1440 × 1024 | Login petugas, isian awal |
| ↳ [6_Login](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=1162-17960) | 1440 × 1024 | Login petugas, akun contoh terisi |
| [PEREKAM MEDIS V3.0](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=764-12889) | 13194 × 10116 | Section pengelompokan di canvas |
| ↳ [02_Pendaftaran Pasien & Kunjungan — Berhasil](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=764-13938) | 520 × 270 | Dialog contoh pendaftaran berhasil |
| ↳ [02_Pendaftaran Pasien & Kunjungan — Gagal: Data Belum Lengkap](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=764-13951) | 520 × 270 | Dialog contoh data belum lengkap |
| ↳ [01_Rekam Medis — Pilih Konteks Layanan](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=917-10996) | 1440 × 1024 | Pemilih poli, bilik, tanggal, sesi, dokter |
| [Dashboard](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=1259-15667) | 2331 × 1752 | Section pengelompokan di canvas |
| ↳ [Dashboard Rekam Medis](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=764-16640) | 1440 × 1024 | Ringkasan hari ini, Perlu Tindakan dan aktivitas |
| [Pendaftaran Pasien & Kunjungan](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=1259-15672) | 6340 × 1752 | Section pengelompokan di canvas |
| ↳ [Pendaftaran Pasien & Kunjungan 1](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=764-16840) | 1440 × 1024 | Langkah 1, pilih pasien lama atau buat pasien baru |
| ↳ [02_Pendaftaran Pasien & Kunjungan — Data Kunjungan](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=764-12890) | 1440 × 1024 | Langkah 2, isi data kunjungan |
| ↳ [02_Pendaftaran Pasien & Kunjungan — Konfirmasi](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=764-13183) | 1440 × 1024 | Langkah 3, tinjau dan konfirmasi |
| [Daftar Kunjungan](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=1261-15680) | 3150 × 1752 | Section pengelompokan di canvas |
| ↳ [03_Daftar Kunjungan](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=764-13679) | 1440 × 1024 | Daftar, tab tanggal, status, dan tindakan baris |
| [Riwayat Rekam Medis](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=1265-17385) | 3586 × 1752 | Section pengelompokan di canvas |
| ↳ [04_Riwayat Rekam Medis Pasien](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=764-13462) | 1440 × 1024 | Daftar riwayat dan status sinkronisasi |
| ↳ [04_Riwayat Rekam Medis Pasien — Detail Hanya Baca](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=764-14737) | 1440 × 1024 | Detail rekam medis hanya baca |
| [Integrasi SATUSEHAT](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=1265-17390) | 3509 × 1752 | Section pengelompokan di canvas |
| ↳ [Desktop - 5](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=764-16992) | 1440 × 1024 | Pemantauan awal dengan hasil berhasil dan gagal |
| ↳ [Desktop - 7](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=1271-14136) | 1440 × 1024 | State sesudah Perbarui Status |

### 8.3. Dialog dan panel lepas

| Node Figma | Ukuran (px) | Fungsi |
| --- | ---: | --- |
| [Modal resume medis](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=888-18350) | 860 × 968 | Dialog ringkasan SOAP pasien selesai |
| [05_Integrasi SATUSEHAT — SS-12 Pengiriman Ulang Gagal](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=764-15569) | 800 × 734 | Dialog Pengiriman Ulang Gagal |
| [05_Integrasi SATUSEHAT — SS-11 Pengiriman Ulang Berhasil](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=764-15682) | 800 × 636 | Dialog Pengiriman Ulang Berhasil |
| [05_Integrasi SATUSEHAT — SS-10 Pengiriman Ulang Dalam Proses](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=764-15785) | 800 × 638 | Dialog Pengiriman Ulang Dalam Proses |
| [05_Integrasi SATUSEHAT — SS-09 Konfirmasi Pengiriman Ulang](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=764-15888) | 550 × 387 | Dialog Konfirmasi Pengiriman Ulang |
| [05_Integrasi SATUSEHAT — SS-08 Detail Masalah Teknis — Hendra](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=764-15908) | 800 × 622 | Dialog Detail Masalah Teknis — Hendra |
| [05_Integrasi SATUSEHAT — SS-07 Detail Data Klinis — Fajar](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=764-15993) | 800 × 661 | Dialog Detail Data Klinis — Fajar |
| [05_Integrasi SATUSEHAT — SS-06 Detail Data Administratif — Gita](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=764-16079) | 800 × 622 | Dialog Detail Data Administratif — Gita |
| [05_Integrasi SATUSEHAT — SS-05 Detail Gangguan Sementara — Dedi](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=764-16164) | 800 × 654 | Dialog Detail Gangguan Sementara — Dedi |
| [05_Integrasi SATUSEHAT — SS-04 Detail Dalam Proses — Budi](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=764-16260) | 800 × 580 | Dialog Detail Dalam Proses — Budi |
| [05_Integrasi SATUSEHAT — SS-03 Detail Berhasil — Citra](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=764-16342) | 800 × 540 | Dialog Detail Berhasil — Citra |
| [Popover Profil dan Setting](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=943-16771) | 272 × 172 | Ringkasan profil dan Logout petugas |
| [popup-konfirmasi-logout](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=943-16788) | 500 × 260 | Konfirmasi logout petugas |
| [03_Daftar Kunjungan — Konfirmasi Kedatangan](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=1257-15034) | 560 × 440 | Contoh dialog kedatangan untuk baris pasien |
| [03_Daftar Kunjungan — Konfirmasi Kedatangan](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=1267-13819) | 560 × 440 | Contoh dialog kedatangan untuk baris pasien |
| [03_Daftar Kunjungan — Konfirmasi Kedatangan](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=1267-13857) | 560 × 440 | Contoh dialog kedatangan untuk baris pasien |
| [03_Daftar Kunjungan — Konfirmasi Kedatangan](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=764-14582) | 560 × 440 | Contoh dialog kedatangan untuk baris pasien |
| [03_Daftar Kunjungan — Konfirmasi Kedatangan](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=1265-17202) | 560 × 440 | Contoh dialog kedatangan untuk baris pasien |
| [03_Daftar Kunjungan — Konfirmasi Kedatangan](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=1264-16158) | 560 × 440 | Contoh dialog kedatangan untuk baris pasien |
| [03_Daftar Kunjungan — Detail](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=764-14535) | 376 × 728 | Drawer ringkasan dan aksi konfirmasi |

### 8.4. Komponen, varian, dan potongan UI

| Node Figma | Ukuran (px) | Fungsi |
| --- | ---: | --- |
| [DOKTER V4.0](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=764-10279) | 14483 × 10116 | Section pengelompokan di canvas |
| ↳ [summary-column](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=813-9989) | 360 × 513 | Potongan panel ringkasan AI |
| ↳ [Illustration](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=764-11845) | 420 × 420 | Aset ilustrasi |
| ↳ [dropdown search ICD-10](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=764-12422) | 504 × 307 | Varian dropdown pencarian ICD-10 |
| ↳ [patient-card](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=764-12465) | 1104 × 323 | Potongan form atau panel SOAP |
| ↳ [iconamoon:arrow-top-right-2](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=809-11897) | 24 × 24 | Aset ikon |
| ↳ [transcript-column](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=821-11820) | 728 × 965 | Potongan panel transkrip |
| ↳ [plan-card](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=835-13604) | 544 × 1396 | Potongan form atau panel SOAP |
| ↳ [assesmen-card](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=835-15375) | 542 × 378 | Potongan form atau panel SOAP |
| ↳ [summary-column](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=888-16198) | 360 × 513 | Potongan panel ringkasan AI |
| ↳ [Textarea Asesmen](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=888-18340) | 222 × 58 | Potongan form atau panel SOAP |
| ↳ [Riwayat dan rekam medis](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=969-11340) | 1104 × 1167 | Konten ringkasan riwayat dan rekam medis |
| [Componen](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=809-9738) | 10429 × 11001 | Section pengelompokan di canvas |
| ↳ [Rectangle 23](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=961-11870) | 418 × 295 | Aset visual referensi |
| ↳ [Rectangle 22](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=961-11869) | 266 × 588 | Aset visual referensi |
| ↳ [Audio Waveform Visualization](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=764-12533) | 320 × 137 | Waveform kontrol perekaman |
| ↳ [Property 1=Default](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=764-12534) | 280 × 28 | Varian Audio Waveform Visualization |
| ↳ [Property 1=Variant3](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=764-12565) | 280 × 28 | Varian Audio Waveform Visualization |
| ↳ [Property 1=Variant2](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=764-12596) | 280 × 1 | Varian Audio Waveform Visualization |
| ↳ [Waktu](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=764-12627) | 173 × 490 | Varian label waktu perekaman |
| ↳ [Property 1=Default](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=764-12628) | 133 × 27 | Varian Waktu |
| ↳ [Property 1=Variant2](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=764-12631) | 133 × 27 | Varian Waktu |
| ↳ [Property 1=Variant3](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=764-12634) | 133 × 27 | Varian Waktu |
| ↳ [Property 1=Variant4](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=764-12637) | 133 × 27 | Varian Waktu |
| ↳ [Property 1=Variant5](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=764-12640) | 133 × 27 | Varian Waktu |
| ↳ [Property 1=Variant6](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=764-12643) | 133 × 27 | Varian Waktu |
| ↳ [Property 1=Variant7](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=764-12646) | 133 × 27 | Varian Waktu |
| ↳ [Property 1=Variant8](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=764-12649) | 133 × 27 | Varian Waktu |
| ↳ [Property 1=Variant9](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=764-12652) | 133 × 27 | Varian Waktu |
| ↳ [Property 1=Variant10](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=764-12655) | 133 × 27 | Varian Waktu |
| ↳ [Header Banner & Clinical Action Bar](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=764-11877) | 1144 × 248 | Banner dan aksi klinis pada area kerja dokter |
| ↳ [Property 1=Default](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=764-11878) | 1104 × 56 | Varian Header Banner & Clinical Action Bar |
| ↳ [Property 1=Variant2](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=764-11886) | 1104 × 56 | Varian Header Banner & Clinical Action Bar |
| ↳ [Property 1=Variant3](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=764-11894) | 1104 × 56 | Varian Header Banner & Clinical Action Bar |
| ↳ [section-search](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=809-9752) | 480 × 78 | Potongan antarmuka pencarian |
| ↳ [field-search](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=809-9759) | 504 × 48 | Potongan antarmuka pencarian |
| ↳ [transcript-column](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=809-9765) | 728 × 383 | Potongan panel transkrip |
| ↳ [Aside/Default](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=809-10184) | 288 × 1024 | Varian sidebar dokter |
| ↳ [Aside/Variant2](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=809-10185) | 288 × 1024 | Varian sidebar dokter |
| ↳ [Aside/Variant3](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=809-10186) | 288 × 1024 | Varian sidebar dokter |
| ↳ [Aside/Variant4](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=809-10187) | 288 × 1024 | Varian sidebar dokter |
| ↳ [section-search](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=809-10871) | 410 × 78 | Potongan antarmuka pencarian |
| ↳ [transcript-column](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=809-10878) | 621 × 383 | Potongan panel transkrip |
| ↳ [patient-card](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=809-12681) | 1144 × 1720 | Varian blok identitas pasien |
| ↳ [Property 1=Default](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=809-12680) | 1104 × 374 | Varian patient-card |
| ↳ [Property 1=Variant4](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=820-12929) | 1104 × 374 | Varian patient-card |
| ↳ [ai-scribe-card](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=820-14057) | 1144 × 568 | Varian kontrol AI Scribe |
| ↳ [Property 1=Default](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=820-14056) | 1104 × 117 | Varian ai-scribe-card |
| ↳ [Property 1=Variant2](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=820-14058) | 1104 × 117 | Varian ai-scribe-card |
| ↳ [Property 1=Variant3](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=820-14247) | 1104 × 117 | Varian ai-scribe-card |
| ↳ [Property 1=Variant4](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=820-14315) | 1104 × 117 | Varian ai-scribe-card |
| ↳ [Hasil Subjektif](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=820-14886) | 1144 × 1658 | Varian hasil Subjektif |
| ↳ [Property 1=Default](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=820-14885) | 1104 × 380 | Varian Hasil Subjektif |
| ↳ [Property 1=Variant2](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=820-14887) | 1112 × 965 | Varian Hasil Subjektif |
| ↳ [queue-header](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=961-12211) | 1104 × 330 | Filter antrean, lima tab |
| ↳ [Property 1=Semua Pasien](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=961-12210) | 1064 × 42 | Varian queue-header |
| ↳ [Property 1=Saat Ini](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=961-12212) | 1064 × 42 | Varian queue-header |
| ↳ [Property 1=Selanjutnya](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=961-12238) | 1064 × 42 | Varian queue-header |
| ↳ [Property 1=Menunggu](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=961-12264) | 1064 × 42 | Varian queue-header |
| ↳ [Property 1=Selesai](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=961-12290) | 1064 × 42 | Varian queue-header |
| ↳ [queue-card](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=961-13277) | 1144 × 4355 | Tabel antrean dengan beberapa keadaan giliran |
| ↳ [Property 1=Default](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=961-13276) | 1104 × 847 | Varian queue-card |
| ↳ [Property 1=Variant5](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=961-14000) | 1104 × 847 | Varian queue-card |
| ↳ [Property 1=Variant4](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=961-13684) | 1104 × 847 | Varian queue-card |
| ↳ [Property 1=Variant3](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=961-13481) | 1104 × 847 | Varian queue-card |
| ↳ [Property 1=Variant2](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=961-13278) | 1104 × 847 | Varian queue-card |
| ↳ [Modal resume medis fix](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=961-14203) | 860 × 860 | Overlay resume pasien selesai |
| ↳ [Menu aksi pasien selesai](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=961-14277) | 232 × 186 | Menu konteks untuk baris pasien selesai |
| ↳ [objektif-card](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=971-15998) | 1144 × 9971 | Form Objektif dengan variasi luka dan hasil penunjang |
| ↳ [Property 1=Terisi](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=971-15997) | 1104 × 1547 | Varian objektif-card |
| ↳ [Property 1=Variant3](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=971-16304) | 1104 × 1876 | Varian objektif-card |
| ↳ [Property 1=Variant4](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=971-16637) | 1104 × 2368 | Varian objektif-card |
| ↳ [Property 1=Variant5](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=971-17354) | 1104 × 1999 | Varian objektif-card |
| ↳ [Persetujuan card](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=820-16503) | 1144 × 1898 | Varian persetujuan perekaman |
| ↳ [Property 1=Default](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=820-16502) | 1104 × 919 | Varian Persetujuan card |
| ↳ [Property 1=Variant2](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=820-16504) | 1104 × 833 | Varian Persetujuan card |
| ↳ [plan-card](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=996-23238) | 1142 × 3068 | Varian Plan dan resep |
| ↳ [Property 1=Default](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=996-23237) | 1102 × 619 | Varian plan-card |
| ↳ [Property 1=Variant2](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=996-23239) | 1102 × 1266 | Varian plan-card |
| ↳ [Property 1=Variant3](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=996-23397) | 1102 × 851 | Varian plan-card |
| ↳ [Pemutar rekaman konsultasi](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=1012-25218) | 1104 × 1413 | Varian pemutar audio pada riwayat |
| ↳ [Property 1=Default](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=1012-25217) | 1064 × 169 | Varian Pemutar rekaman konsultasi |
| ↳ [Property 1=Variant2](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=1012-25219) | 1064 × 169 | Varian Pemutar rekaman konsultasi |
| ↳ [Property 1=Variant3](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=1012-25249) | 1064 × 169 | Varian Pemutar rekaman konsultasi |
| ↳ [Property 1=Variant4](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=1012-25278) | 1064 × 169 | Varian Pemutar rekaman konsultasi |
| ↳ [Property 1=Variant5](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=1012-25307) | 1064 × 169 | Varian Pemutar rekaman konsultasi |
| ↳ [Property 1=Variant6](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=1012-25336) | 1064 × 169 | Varian Pemutar rekaman konsultasi |
| ↳ [Property 1=Variant7](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=1012-25365) | 1064 × 169 | Varian Pemutar rekaman konsultasi |
| ↳ [Property 1=Variant8](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=1012-25394) | 1064 × 169 | Varian Pemutar rekaman konsultasi |
| ↳ [Kecepatan pemutaran](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=1012-25827) | 75 × 164 | Pilihan kecepatan audio |
| ↳ [Property 1=Default](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=1012-25826) | 40 × 39 | Varian Kecepatan pemutaran |
| ↳ [Property 1=Variant2](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=1012-25828) | 40 × 40 | Varian Kecepatan pemutaran |
| ↳ [Property 1=Variant3](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=1012-25830) | 40 × 40 | Varian Kecepatan pemutaran |
| ↳ [Volume rekaman](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=1012-25846) | 136 × 200 | Pilihan volume audio |
| ↳ [Property 1=Default](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=1012-25845) | 100 × 20 | Varian Volume rekaman |
| ↳ [Property 1=Variant2](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=1012-25847) | 100 × 20 | Varian Volume rekaman |
| ↳ [Property 1=Variant3](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=1012-25853) | 100 × 20 | Varian Volume rekaman |
| ↳ [Property 1=Variant4](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=1012-25858) | 100 × 20 | Varian Volume rekaman |
| ↳ [Property 1=Variant5](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=1012-25863) | 100 × 20 | Varian Volume rekaman |
| [Sidebar Perekam Medis](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=764-17329) | 328 × 5240 | Varian menu aktif sidebar petugas |
| ↳ [Property 1=Pendaftaran Pasien](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=764-17330) | 288 × 1024 | Varian Sidebar Perekam Medis |
| ↳ [Property 1=Dashboard](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=1256-13191) | 288 × 1024 | Varian Sidebar Perekam Medis |
| ↳ [Property 1=Daftar Kunjungan](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=1256-13250) | 288 × 1024 | Varian Sidebar Perekam Medis |
| ↳ [Property 1=Riwayat Pasien](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=1257-13319) | 288 × 1024 | Varian Sidebar Perekam Medis |
| ↳ [Property 1=Integrasi SATUSEHAT](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=1257-13394) | 288 × 1024 | Varian Sidebar Perekam Medis |
| [Daftarkan pasien baru](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=1179-18371) | 568 × 1156 | Varian formulir pasien baru |
| ↳ [Property 1=Default](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=1179-18370) | 528 × 548 | Varian Daftarkan pasien baru |
| ↳ [Property 1=Variant2](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=1179-18372) | 528 × 548 | Varian Daftarkan pasien baru |
| [Tabel tindakan](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=1257-15079) | 1104 × 780 | Tabel tindakan dengan tiga, dua, dan satu baris |
| ↳ [Property 1=Default](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=1257-15078) | 1064 × 276 | Varian Tabel tindakan |
| ↳ [Property 1=Variant2](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=1257-15080) | 1064 × 212 | Varian Tabel tindakan |
| ↳ [Property 1=Variant3](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=1267-13895) | 1064 × 148 | Varian Tabel tindakan |
| [Tabel kunjungan](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=1262-16012) | 1144 × 2232 | Varian daftar sebelum dan sesudah konfirmasi kedatangan |
| ↳ [Property 1=Default](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=1262-16011) | 1104 × 533 | Varian Tabel kunjungan |
| ↳ [Property 1=Variant2](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=1262-16013) | 1104 × 533 | Varian Tabel kunjungan |
| ↳ [Property 1=Variant3](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=1264-16200) | 1104 × 533 | Varian Tabel kunjungan |
| ↳ [Property 1=Variant4](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=1265-17241) | 1104 × 533 | Varian Tabel kunjungan |
| [Aside/Default](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=764-11941) | 288 × 1024 | Varian sidebar dokter |
| [Aside/Variant2](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=764-11989) | 288 × 1024 | Varian sidebar dokter |
| [Aside/Variant3](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=764-12037) | 288 × 1024 | Varian sidebar dokter |
| [Aside/Variant4](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=764-12085) | 288 × 1024 | Varian sidebar dokter |

### 8.5. Eksplorasi dan aset referensi

| Node Figma | Ukuran (px) | Fungsi |
| --- | ---: | --- |
| [COLOR PALLETE](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=736-11615) | 6864 × 7475 | Swatch dan gambar referensi palet |
| ↳ [Gemini_Generated_Image_q68vblq68vblq68v 1](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=736-11616) | 2725 × 2035 | Aset visual referensi |
| ↳ [image 6](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=736-11617) | 3014 × 1418 | Aset visual referensi |
| ↳ [image 7](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=736-11618) | 2997 × 1046 | Aset visual referensi |
| ↳ [image 8](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=736-11619) | 2997 × 1126 | Aset visual referensi |
| [1_Manajemen_Kunjungan](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=736-17722) | 1440 × 1024 | Eksplorasi antrean dengan data rumah sakit |
| [1_Manajemen_Kunjungan](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=736-17980) | 1440 × 1024 | Eksplorasi antrean dengan menu SOAP di sidebar |
| [4.1_SOAP-OAP](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=736-18242) | 1440 × 1317 | Eksplorasi formulir Objektif–Asesmen–Plan gabungan |
| [2.5_SOAP-S (setuju belum rekam)](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=736-18466) | 1440 × 1024 | Eksplorasi Subjektif sebelum rekam |
| [image 10](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=736-18657) | 1487 × 1058 | Gambar referensi |
| [1_Manajemen_Kunjungan](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=736-18658) | 1440 × 1024 | Eksplorasi dashboard dan antrean |
| [Calendar 2026 #213](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=736-20563) | 1768 × 840 | Aset kalender referensi |
| [Calendar 2026 #874](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=736-20619) | 1768 × 840 | Aset kalender referensi |
| [Calendar 2026 #343](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=736-20675) | 1768 × 840 | Aset kalender referensi |
| [Calendar 2026 #256](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=736-20731) | 1768 × 840 | Aset kalender referensi |
| [Frame](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=736-28990) | 2946 × 322 | Storyboard video demo |
| [Uploaded Image](https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=956-11644) | 596 × 800 | Gambar unggahan |

## 9. Style warna lokal

Nilai berikut dibaca dari paint style Figma. Tabel pada bagian 2 mencatat nilai yang terlihat pada frame, termasuk beberapa warna yang berbeda dari style lokal.

| Nama style | Nilai |
| --- | --- |
| `primary` | `#14A3B8` |
| `ComeHear/Brand/ComeHear Teal` | `#14A3B8` |
| `ComeHear/Brand/Deep Teal` | `#0F8294` |
| `ComeHear/Brand/Mid Teal` | `#76CEDB` |
| `ComeHear/Brand/Ice Teal` | `#E6F6F8` |
| `ComeHear/Brand/Clinical Navy` | `#0C2A46` |
| `ComeHear/Brand/Scribe Slate` | `#526578` |
| `ComeHear/Neutral/Soft Teal Gray` | `#E8F1F4` |
| `ComeHear/Neutral/Aqua Dew White` | `#F6FAFB` |
| `ComeHear/Neutral/Misted Aqua` | `#EFF6F8` |
| `ComeHear/Neutral/Pure Soft Ice` | `#FAFCFD` |
| `ComeHear/Neutral/Light Border` | `#D5E4E9` |
| `ComeHear/Neutral/Dark Ink` | `#18293A` |

| Grup style status | Fill | Text | Border |
| --- | --- | --- | --- |
| Giliran Saat Ini | `#DDF3F6` | `#0B6E7D` | `#A3DFEA` |
| Menunggu | `#EAEFF3` | `#4E6174` | `#CFD9E3` |
| Merekam Suara | `#FDE8E8` | `#C92A2A` | `#F8B4B4` |
| Draf AI Siap | `#D8F3F7` | `#0B7282` | `#8CD9E6` |
| Selesai dan Terkirim | `#E2F3EC` | `#136F4E` | `#B4E0CE` |

Style **Selesai dan Terkirim** merupakan nama palet di Figma. Gunakan teks badge sesuai arti status pada masing-masing kolom.

[figma]: https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=736-7138
[components]: https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=809-9738
[roles]: https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=1162-13059
[doc-login]: https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=764-11811
[queue]: https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=764-17842
[subjective]: https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=961-15075
[objective]: https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=961-15083
[ap]: https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=996-22722
[validate]: https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=888-16301
[queue-done]: https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=764-18102
[doc-history]: https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=764-12133
[doc-settings]: https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=943-16642
[doc-account]: https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=943-16602
[rm-account]: https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=943-16771
[rm-login]: https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=764-17295
[context]: https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=917-10996
[dashboard]: https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=764-16640
[register-1]: https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=764-16840
[register-2]: https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=764-12890
[register-3]: https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=764-13183
[visits]: https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=764-13679
[rm-history]: https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=764-13462
[rm-detail]: https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=764-14737
[sync]: https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=764-16992
[sync-updated]: https://www.figma.com/design/p4sTXe2OuurDOQX2W2afyd/Play-IT?node-id=1271-14136
