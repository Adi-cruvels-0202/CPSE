import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The merchant app lives at /merchant on the same origin as the API and the
 * customer app (the backend hosts all three — backend/src/lib/frontendHost.js).
 * `base` makes every asset URL start with /merchant/, and the router uses the
 * same basename.
 *
 * Standalone (`npm run dev` here) it runs on 5174 — 5173 is the customer app's —
 * and proxies /api to the backend on 4000, so the same relative URLs work.
 */
export default defineConfig({
  base: '/merchant/',
  plugins: [react()],
  server: {
    port: 5174,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://localhost:4000', changeOrigin: true },
    },
  },
});
