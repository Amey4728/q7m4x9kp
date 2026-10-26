import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// In dev, /api is proxied to the FastAPI server. In Docker/Vercel the same path is served
// by nginx / Vercel routing, so the front end never needs to know the backend URL.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { '/api': process.env.API_URL ?? 'http://localhost:8000' },
  },
  build: {
    // Charts (recharts + d3) live in a lazily-loaded shared chunk; only the shell loads up front.
    chunkSizeWarningLimit: 400,
  },
})
