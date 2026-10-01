import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { resetForTests } from '../src/lib/tokens.js';
import { forgetStore } from '../src/lib/activeStore.js';

// The API client reads this at import time.
import.meta.env.VITE_API_BASE_URL = 'http://api.test/api/v1';

beforeEach(() => {
  resetForTests();
  // The Cart tab remembers the last shop; it must not carry between tests.
  forgetStore();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  // A test that installs fake timers and then fails would otherwise leave every
  // later test waiting on a clock nobody advances.
  vi.useRealTimers();
  resetForTests();
});
