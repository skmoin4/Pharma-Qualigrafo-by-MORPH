import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// API_URL points the dev / preview proxy at another API instance (default: the local API on port 4000).
const api = process.env.API_URL ?? 'http://localhost:4000'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { '/api': api },
  },
  preview: {
    proxy: { '/api': api },
  },
})
