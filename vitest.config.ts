import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/setupTests.ts'],
    // Node >=24 ships a global `localStorage` (experimental webstorage) that
    // shadows jsdom's working implementation and throws on .clear()/.setItem().
    // Disable it in test workers so jsdom's localStorage is used instead.
    pool: 'forks',
    execArgv: ['--no-experimental-webstorage'],
  },
})
