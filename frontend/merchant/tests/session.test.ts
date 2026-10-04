import { describe, it, expect, beforeEach } from 'vitest';
import { readSession, writeSession, clearSession, onSessionChange } from '../src/lib/session';

describe('the shared session', () => {
  beforeEach(() => window.localStorage.clear());

  // The customer app (frontend/customer/src/lib/tokens.js) uses this same key,
  // which is what makes one login work in both apps.
  it('lives under the key the customer app uses', () => {
    writeSession({ accessToken: 'a', refreshToken: 'r', expiresAt: 1 });
    expect(JSON.parse(window.localStorage.getItem('cpse.merchant.session')!)).toEqual({ accessToken: 'a', refreshToken: 'r', expiresAt: 1 });
  });

  it('reads what the customer app wrote', () => {
    window.localStorage.setItem('cpse.merchant.session', JSON.stringify({ accessToken: 'c', refreshToken: 'd', expiresAt: null }));
    expect(readSession()).toEqual({ accessToken: 'c', refreshToken: 'd', expiresAt: null });
  });

  it('treats a corrupt entry as signed out, and clears it', () => {
    window.localStorage.setItem('cpse.merchant.session', '{nope');
    expect(readSession()).toBeNull();
    expect(window.localStorage.getItem('cpse.merchant.session')).toBeNull();
  });

  it('tells listeners when it changes', () => {
    const seen: unknown[] = [];
    const stop = onSessionChange((session) => seen.push(session));
    writeSession({ accessToken: 'a', refreshToken: 'r' });
    clearSession();
    stop();
    expect(seen).toEqual([{ accessToken: 'a', refreshToken: 'r', expiresAt: null }, null]);
  });
});
