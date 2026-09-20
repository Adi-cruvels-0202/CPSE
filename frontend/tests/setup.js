import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { resetForTests } from '../src/lib/tokens.js';

// The API client reads this at import time.
import.meta.env.VITE_API_BASE_URL = 'http://api.test/api/v1';

beforeEach(() => {
  resetForTests();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  resetForTests();
});
