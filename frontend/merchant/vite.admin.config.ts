import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The admin portal, built as its own app at /admin (backend/src/lib/frontendHost.js
 * serves it beside the customer app at / and the shop app at /merchant). Its
 * page is admin/index.html; its code lives in src/admin and reuses the shop
 * app's components, so it shares this project's dependencies.
 *
 * Standalone (`npm run dev:admin`) it runs on 5175 and proxies /api to 4000.
 */
export default defineConfig({
  root: path.resolve(__dirname, 'admin'),
  base: '/admin/',
  publicDir: path.resolve(__dirname, 'public'),
  plugins: [react()],
  build: {
    outDir: path.resolve(__dirname, 'dist-admin'),
    emptyOutDir: true,
  },
  server: {
    port: 5175,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://localhost:4000', changeOrigin: true },
    },
  },
});
