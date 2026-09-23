import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Fixed port so it never clashes with other local projects on 5173.
    port: 5180,
    strictPort: true,
  },
})
