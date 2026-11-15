# ComeHear Frontend

Fondasi React + TypeScript dengan Vite, Tailwind CSS, shadcn/ui, React Router, dan TanStack Query.

## Jalankan lokal

1. Di `BE/`, buat `.env` dari `.env.example`, lalu set `LLM_PROVIDERS=mock` dan `SATUSEHAT_MODE=mock`.
2. Jalankan backend: `.venv/Scripts/python -m uvicorn app.main:app --port 8000`.
3. Di `FE/`, jalankan `pnpm install` lalu `pnpm dev`.
4. Buka alamat Vite yang tercetak di terminal. Masuk sebagai dokter dengan `rian@rumahsakit.id` dan kata sandi `DEMO_PASSWORD` dari `BE/.env`.
5. Halaman Manajemen Kunjungan menampilkan antrean dari BE. Jika kosong, pilih **Isi antrean demo**.

Alur dokter: **Antrean → Persetujuan/Rekam atau manual → Tinjau Subjektif → O-A-P → Tinjau & Sahkan → Resume**. Audio yang dihentikan dikirim ke BE untuk ASR; bila gagal, dokter dapat memasukkan transkrip cadangan. Mode `LLM_PROVIDERS=mock` dan `SATUSEHAT_MODE=mock` hanya untuk simulasi. Untuk mencoba rekaman sungguhan, atur `ASR_MODEL=small` di `BE/.env` dan pastikan model tersedia.

Vite meneruskan path `/api` ke `http://127.0.0.1:8000`. Route BE lama yang belum berawalan `/api` dipanggil melalui `/api/backend/*` dan dihapus prefiksnya oleh proxy Vite. Deployment produksi perlu aturan reverse proxy yang sama atau API BE yang diseragamkan.

Perintah pemeriksaan: `pnpm build` dan `pnpm lint`.
