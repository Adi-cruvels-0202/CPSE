import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import { AuthProvider, useAuth } from '../src/context/AuthContext.jsx';
import { readSession, writeSession } from '../src/lib/tokens.js';
import { customerFixture, fail, mockFetch, noContent, ok, sessionFixture } from './helpers/api.js';

/**
 * Renders the context's state as text, so assertions read like the UI.
 *
 * The handlers catch their own errors and render them, which is what a real
 * screen does — and it keeps a rejected sign-in from escaping as an unhandled
 * rejection instead of being asserted on.
 */
function Probe() {
  const { status, customer, signIn, register, signOut } = useAuth();
  const [error, setError] = useState(null);

  const attempt = (action) => async () => {
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(caught);
    }
  };

  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="who">{customer?.email ?? 'nobody'}</span>
      <span data-testid="error">{error ? `${error.code}: ${error.message}` : ''}</span>
      <button type="button" onClick={attempt(() => signIn({ email: 'a@b.c', password: 'Password!1' }))}>
        sign in
      </button>
      <button
        type="button"
        onClick={attempt(() => register({ email: 'a@b.c', password: 'Password!1' }))}
      >
        register
      </button>
      <button type="button" onClick={attempt(() => signOut())}>
        sign out
      </button>
    </div>
  );
}

const renderAuth = () => render(<AuthProvider><Probe /></AuthProvider>);
const status = () => screen.getByTestId('status').textContent;
const shownError = () => screen.getByTestId('error').textContent;

describe('boot', () => {
  it('starts signed out when nothing is stored, and asks the server nothing', async () => {
    const { calls } = mockFetch([]);

    renderAuth();

    await waitFor(() => expect(status()).toBe('signedOut'));
    expect(calls).toHaveLength(0);
  });

  it('starts in loading when a session is stored, then signs in', async () => {
    writeSession(sessionFixture());
    mockFetch([ok({ customer: customerFixture() })]);

    renderAuth();

    // Not 'signedOut' on the first paint: that flicker is what makes a returning
    // customer think they have been logged out.
    expect(status()).toBe('loading');

    await waitFor(() => expect(status()).toBe('signedIn'));
    expect(screen.getByTestId('who')).toHaveTextContent('test.customer@cpse.local');
  });

  it('discards a stored session the server rejects', async () => {
    writeSession(sessionFixture());
    // The profile call 401s and the refresh fails too.
    mockFetch([fail(401, 'UNAUTHORIZED'), fail(401, 'UNAUTHORIZED')]);

    renderAuth();

    await waitFor(() => expect(status()).toBe('signedOut'));
    expect(readSession()).toBeNull();
  });

  it('keeps the session when the profile call fails for any other reason', async () => {
    writeSession(sessionFixture());
    mockFetch([fail(500, 'INTERNAL_ERROR')]);

    renderAuth();

    // A backend outage is not a sign-out. The screen shows its own error; the
    // customer does not have to find their password because a server hiccupped.
    await waitFor(() => expect(status()).toBe('signedIn'));
    expect(readSession()?.accessToken).toBe('access-1');
  });

  it('stays signed in when the network is down at boot', async () => {
    writeSession(sessionFixture());
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }));

    renderAuth();

    await waitFor(() => expect(status()).toBe('signedIn'));
    expect(readSession()).not.toBeNull();
  });
});

describe('signing in', () => {
  it('stores the session and the customer', async () => {
    mockFetch([ok({ customer: customerFixture(), session: sessionFixture() })]);

    renderAuth();
    await waitFor(() => expect(status()).toBe('signedOut'));

    await act(async () => {
      screen.getByText('sign in').click();
    });

    expect(status()).toBe('signedIn');
    expect(readSession()?.accessToken).toBe('access-1');
    expect(screen.getByTestId('who')).toHaveTextContent('test.customer@cpse.local');
  });

  it('leaves the app signed out when the credentials are wrong', async () => {
    mockFetch([fail(401, 'UNAUTHORIZED', 'Email or password is incorrect.')]);

    renderAuth();
    await waitFor(() => expect(status()).toBe('signedOut'));

    await act(async () => {
      screen.getByText('sign in').click();
    });

    // The error reaches the screen: the context must not swallow it.
    expect(shownError()).toBe('UNAUTHORIZED: Email or password is incorrect.');
    expect(status()).toBe('signedOut');
    expect(readSession()).toBeNull();
  });
});

describe('registering', () => {
  it('signs the customer in when the server returns a session', async () => {
    mockFetch([ok({ customer: customerFixture(), session: sessionFixture() })]);

    renderAuth();
    await waitFor(() => expect(status()).toBe('signedOut'));

    await act(async () => {
      screen.getByText('register').click();
    });

    expect(status()).toBe('signedIn');
  });

  it('stays signed out when email confirmation is required', async () => {
    // The server says so by returning a null session.
    mockFetch([
      ok({ customer: customerFixture(), session: null, emailConfirmationRequired: true }),
    ]);

    renderAuth();
    await waitFor(() => expect(status()).toBe('signedOut'));

    await act(async () => {
      screen.getByText('register').click();
    });

    expect(status()).toBe('signedOut');
    expect(readSession()).toBeNull();
  });
});

describe('signing out', () => {
  it('clears everything', async () => {
    writeSession(sessionFixture());
    mockFetch([ok({ customer: customerFixture() }), noContent()]);

    renderAuth();
    await waitFor(() => expect(status()).toBe('signedIn'));

    await act(async () => {
      screen.getByText('sign out').click();
    });

    expect(status()).toBe('signedOut');
    expect(readSession()).toBeNull();
    expect(screen.getByTestId('who')).toHaveTextContent('nobody');
  });

  it('clears locally even when the server call fails', async () => {
    writeSession(sessionFixture());
    mockFetch([ok({ customer: customerFixture() }), fail(500, 'INTERNAL_ERROR')]);

    renderAuth();
    await waitFor(() => expect(status()).toBe('signedIn'));

    await act(async () => {
      screen.getByText('sign out').click();
    });

    // On a shared phone, "sign out failed, you are still logged in" is the worst
    // possible outcome.
    expect(status()).toBe('signedOut');
    expect(readSession()).toBeNull();
  });
});

describe('a session dying mid-session', () => {
  it('signs the app out when the API client clears the session', async () => {
    writeSession(sessionFixture());
    mockFetch([
      ok({ customer: customerFixture() }),
      // Later, some request 401s and its refresh is rejected.
      fail(401, 'UNAUTHORIZED'),
      fail(401, 'UNAUTHORIZED'),
    ]);

    renderAuth();
    await waitFor(() => expect(status()).toBe('signedIn'));

    // A request from anywhere in the app — the context is not involved.
    const { request } = await import('../src/lib/api.js');
    await act(async () => {
      await request('/orders').catch(() => {});
    });

    // The session listener is how React finds out at all.
    await waitFor(() => expect(status()).toBe('signedOut'));
  });
});

describe('useAuth outside the provider', () => {
  it('fails loudly rather than returning undefined', () => {
    const Bare = () => {
      useAuth();
      return null;
    };
    // React logs the error it re-throws; silenced so the run stays readable.
    vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => render(<Bare />)).toThrow(/must be used inside <AuthProvider>/);
  });
});
