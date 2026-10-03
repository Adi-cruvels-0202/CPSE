import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * AuthProvider's status when /merchant/me fails. The failure that matters is
 * the one that is neither "not a merchant" nor "signed out": it used to
 * leave a merchant looking like one with no stores, and the dashboard then
 * sent them to "Create your store".
 */

const me = vi.fn();
vi.mock('../src/api/endpoints', () => ({
  merchantApi: { me: () => me() },
  authApi: {},
}));

const { AuthProvider, useAuth } = await import('../src/hooks/useAuth');
const { ApiError } = await import('../src/api/client');
const { writeSession } = await import('../src/lib/session');

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let seen: { status: string; stores: unknown[] } | null = null;
function Probe() {
  const { status, stores } = useAuth();
  seen = { status, stores };
  return null;
}

let root: Root;
async function mount() {
  const container = document.createElement('div');
  root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(QueryClientProvider, { client: new QueryClient() },
        createElement(AuthProvider, null, createElement(Probe))),
    );
  });
}

beforeEach(() => {
  seen = null;
  me.mockReset();
  writeSession({ accessToken: 'token', refreshToken: 'refresh', expiresAt: Math.floor(Date.now() / 1000) + 3600 });
});
afterEach(() => {
  act(() => root.unmount());
  localStorage.clear();
});

describe('AuthProvider', () => {
  it('is a merchant with their stores when /merchant/me answers', async () => {
    me.mockResolvedValue({ merchant: { id: 'm1' }, stores: [{ id: 's1' }] });
    await mount();
    expect(seen).toEqual({ status: 'merchant', stores: [{ id: 's1' }] });
  });

  it('is unavailable, not a merchant with no stores, when /merchant/me is rate-limited', async () => {
    me.mockRejectedValue(new ApiError({ status: 429, code: 'RATE_LIMITED', message: 'Too many requests.' }));
    await mount();
    expect(seen?.status).toBe('unavailable');
  });

  it('is unavailable when the server cannot be reached', async () => {
    me.mockRejectedValue(new Error('Network Error'));
    await mount();
    expect(seen?.status).toBe('unavailable');
  });

  it('still offers onboarding to an account that is only a customer', async () => {
    me.mockRejectedValue(new ApiError({ status: 403, code: 'MERCHANT_REQUIRED', message: 'Merchant account required.' }));
    await mount();
    expect(seen?.status).toBe('needsOnboarding');
  });
});
