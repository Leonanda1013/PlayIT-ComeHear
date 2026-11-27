# ComeHear — Landing Web

Website publik ComeHear yang berdiri sendiri, sejajar dengan folder `BE/` dan `FE/`.
Website ini tidak membutuhkan backend, akun aplikasi, atau proses build dari `FE`.

## Menjalankan lokal

Jalankan dari folder `LANDING`:

```sh
npm install
npm run dev
```

Preview pengembangan tersedia di `http://127.0.0.1:5177`.

## Build dan hosting

```sh
npm run build
npm run preview
```

Hasil build berada di `LANDING/dist/` dan dapat disajikan oleh hosting statis.
Atur root proyek hosting ke `LANDING`, perintah build ke `npm run build`, dan
direktori keluaran ke `dist`. Gunakan `npm ci` untuk instalasi CI sesuai lockfile yang disertakan.
Tidak diperlukan konfigurasi API, proxy backend, atau fallback rute aplikasi.
Path aset relatif mendukung deployment di root domain maupun subdirektori.

## Kontak dan demo

- CTA utama **Hubungi Kami** membuka `mailto:penguasalimit@gmail.com` melalui aplikasi email pengunjung.
- Alamat email juga ditampilkan agar dapat disalin jika aplikasi email belum dikonfigurasi.
- **Lihat Demo** membuka preview interaktif pada halaman yang sama.
- Demo memakai data sintetis, termasuk contoh warning, grounding, dan sitasi transkrip.
- Demo tidak mengakses mikrofon atau mengirim data ke SATUSEHAT.

## Struktur

```text
LANDING/
  public/comehear-logo.png
  src/pages/                # Halaman dan CSS landing
  src/components/landing/   # Preview, sitasi, dan simulasi
  src/components/ui/        # Badge lokal website
  src/lib/types.ts          # Tipe data sintetis demo
```

Komponen visual mengikuti UI ComeHear, tetapi semua sumber dan aset yang dibutuhkan
website berada di folder ini. `FE` tetap memuat aplikasi klinis dan alur login.
