import { resolve } from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  build: {
    rollupOptions: {
      input: resolve(process.cwd(), 'source.html'),
    },
  },
})
