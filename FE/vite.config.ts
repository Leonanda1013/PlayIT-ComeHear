import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const backendTarget = env.VITE_BACKEND_URL || env.BACKEND_URL || 'http://127.0.0.1:8000'

  return {
    plugins: [react(), tailwindcss()],
    resolve: { alias: { '@': path.resolve(import.meta.dirname, './src') } },
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
