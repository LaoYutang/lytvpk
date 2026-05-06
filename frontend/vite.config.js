import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [vue()],
  server: {
    port: 34115,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  }
})
