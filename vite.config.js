import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.js',
    // Backend API tests live in test/api/*.api.js and run via `npm run test:api`.
    include: ['src/**/*.{test,spec}.{js,jsx}'],
    exclude: ['test/**', 'e2e/**', 'node_modules/**', 'dist/**'],
  },
  server: {
    port: 5173,
    open: true,
    proxy: {
      '/api': 'http://127.0.0.1:8787',
    },
  }
});