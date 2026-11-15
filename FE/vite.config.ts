import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'

// Folder FE dan src sebagai path absolut. import.meta.dirname tidak selalu terisi saat
// Vite 8 memuat config ini di mode dev, sehingga alias "@" gagal dan semua import "@/..." error.
const root = fileURLToPath(new URL('.', import.meta.url))
const src = fileURLToPath(new URL('./src', import.meta.url))

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, root, '')
  const backendTarget = env.VITE_BACKEND_URL || env.BACKEND_URL || 'http://127.0.0.1:8000'

  return {
    plugins: [react(), tailwindcss()],
    resolve: { alias: { '@': src } },
    server: {
      proxy: {
        '/api/backend': {
          target: backendTarget,
          changeOrigin: true,
          rewrite: (url) => url.replace(/^\/api\/backend/, ''),
        },
        '/api': { target: backendTarget, changeOrigin: true },
      },
    },
  }
})
