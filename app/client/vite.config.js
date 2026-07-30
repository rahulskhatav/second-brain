import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  /**
   * Read .env from app/, not app/client/.
   *
   * Vite looks for env files in its own root by default, so VITE_* variables
   * sitting in app/.env — where the server reads its own — were never picked up
   * and every VITE_ value came through undefined. One .env for both halves.
   */
  envDir: '..',
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:8787', changeOrigin: true }
    }
  }
});
