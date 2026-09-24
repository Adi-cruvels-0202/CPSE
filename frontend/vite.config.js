import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // Only used when Vite is run standalone (`npm run dev` in frontend/). The
    // normal path is the backend running Vite in middleware mode on its own
    // port, where these are ignored — see backend/src/lib/frontendHost.js.
    //
    // The backend allowlists this exact origin in CORS_ORIGINS, and Supabase
    // allowlists it for the password-reset redirect. Changing it means changing
    // both, so it is pinned rather than left to Vite's next-free-port search.
    port: 5173,
    strictPort: true,
    // Keeps the relative VITE_API_BASE_URL working in standalone mode too.
    proxy: {
      '/api': { target: 'http://localhost:4000', changeOrigin: true },
    },
  },
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['tests/setup.js'],
    include: ['tests/**/*.test.{js,jsx}'],
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{js,jsx}'],
      exclude: ['src/main.jsx'],
    },
  },
});
