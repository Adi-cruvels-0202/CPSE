import { describe, it, expect, vi } from 'vitest';
import {
  SESSION_KEY,
  clearSession,
  onSessionChange,
  readSession,
  writeSession,
} from '../src/lib/tokens.js';
import { sessionFixture } from './helpers/api.js';

describe('session storage', () => {
  it('round-trips the token pair', () => {
    writeSession(sessionFixture());

    expect(readSession()).toEqual({
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      expiresAt: 1789000000,
    });
  });

  it('is empty to begin with', () => {
    expect(readSession()).toBeNull();
  });

  it('stores nothing else from the server’s session object', () => {
    writeSession({ ...sessionFixture(), tokenType: 'bearer', user: { id: 'x' } });

    expect(Object.keys(readSession()).sort()).toEqual([
      'accessToken',
      'expiresAt',
      'refreshToken',
    ]);
  });

  it('refuses a half-session rather than storing an unusable one', () => {
    expect(writeSession({ accessToken: 'only-this' })).toBeNull();
    expect(readSession()).toBeNull();
  });

  it('clears', () => {
    writeSession(sessionFixture());
    clearSession();

    expect(readSession()).toBeNull();
  });

  it('treats a corrupt stored value as absent, and clears it', () => {
    window.localStorage.setItem(SESSION_KEY, 'not json at all');

    expect(readSession()).toBeNull();
    // Cleared, so it cannot fail the next read too.
    expect(window.localStorage.getItem(SESSION_KEY)).toBeNull();
  });

  it('treats a stored value missing the refresh token as absent', () => {
    window.localStorage.setItem(SESSION_KEY, JSON.stringify({ accessToken: 'a' }));

    expect(readSession()).toBeNull();
  });

  it('keeps working in memory when localStorage refuses', () => {
    // Safari's private mode and a blocked-storage setting both make these throw
    // rather than return null. Replaced wholesale, because jsdom's Storage is
    // proxied and a method spy does not intercept the call.
    const broken = {
      getItem: () => {
        throw new DOMException('SecurityError');
      },
      setItem: () => {
        throw new DOMException('QuotaExceededError');
      },
      removeItem: () => {
        throw new DOMException('SecurityError');
      },
    };
    vi.spyOn(window, 'localStorage', 'get').mockReturnValue(broken);

    writeSession(sessionFixture());

    // The session is usable for this tab, which is the point: the shop opens.
    expect(readSession()?.accessToken).toBe('access-1');

    clearSession();
    expect(readSession()).toBeNull();
  });
});

describe('session change listeners', () => {
  it('announces a sign-in and a sign-out', () => {
    const seen = [];
    onSessionChange((session) => seen.push(session?.accessToken ?? null));

    writeSession(sessionFixture());
    clearSession();

    expect(seen).toEqual(['access-1', null]);
  });

  it('stops announcing once unsubscribed', () => {
    const listener = vi.fn();
    const unsubscribe = onSessionChange(listener);

    unsubscribe();
    writeSession(sessionFixture());

    expect(listener).not.toHaveBeenCalled();
  });

  it('tells every listener', () => {
    const first = vi.fn();
    const second = vi.fn();
    onSessionChange(first);
    onSessionChange(second);

    clearSession();

    expect(first).toHaveBeenCalledWith(null);
    expect(second).toHaveBeenCalledWith(null);
  });
});
