import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['tests/**/*.test.js'],
    // Live DB tests skip themselves unless DATABASE_URL is set; see tests/db/.
    testTimeout: 15000,
    setupFiles: ['tests/setup.js'],
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.js'],
      exclude: ['src/server.js'],
    },
  },
});
