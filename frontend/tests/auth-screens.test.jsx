import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '../src/context/AuthContext.jsx';
import { AppRoutes } from '../src/router.jsx';
import { Login } from '../src/routes/auth/Login.jsx';
import { readRecoveryToken } from '../src/routes/auth/ResetPassword.jsx';
import { readSession, writeSession } from '../src/lib/tokens.js';
import {
  created,
  mockRoutes,
  customerFixture,
  fail,
  mockFetch,
  noContent,
  ok,
  sessionFixture,
  validationFail,
} from './helpers/api.js';

/** Checklist 11.3 — the auth screens, driven the way a customer drives them. */

const ROUTER_FUTURE = { v7_startTransition: true, v7_relativeSplatPath: true };

function renderApp(path, { signedIn = false, responses = [] } = {}) {
  if (signedIn) {
    writeSession(sessionFixture());
    // The shell polls the unread badge on every signed-in screen; it must not
    // consume a queued response meant for the screen under test.
    mockFetch([ok({ customer: customerFixture() }), ...responses], {
      ignore: ['/notifications/unread-count'],
    });
  } else {
    mockFetch(responses, { ignore: ['/notifications/unread-count'] });
  }

  return {
    user: userEvent.setup(),
    ...render(
      <MemoryRouter initialEntries={[path]} future={ROUTER_FUTURE}>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </MemoryRouter>,
    ),
  };
}

const field = (name) => screen.getByLabelText(new RegExp(name, 'i'));

/**
 * Found by method and URL, not by position: the shell polls the unread badge on
 * every signed-in screen, so a call index is not a stable way to name a request.
 */
const patchCalls = () =>
  globalThis.fetch.mock.calls.filter(
    ([, options]) => options?.method === 'PATCH',
  );

const patchBody = () => JSON.parse(patchCalls()[0][1].body);

describe('sign in', () => {
  it('signs the customer in and stores the session', async () => {
    const { user } = renderApp('/login', {
      responses: [ok({ customer: customerFixture(), session: sessionFixture() })],
    });

    await user.type(field('email'), 'test.customer@cpse.local');
    await user.type(field('^password'), 'CpseTest!2026');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(readSession()?.accessToken).toBe('access-1'));
    // Landed on the home screen.
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(/hello/i);
  });

  it('shows the server’s message when the credentials are wrong', async () => {
    const { user } = renderApp('/login', {
      responses: [fail(401, 'UNAUTHORIZED', 'Email or password is incorrect.')],
    });

    await user.type(field('email'), 'test.customer@cpse.local');
    await user.type(field('^password'), 'wrong-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Email or password is incorrect.');
    // The server says the same thing for an unknown email as for a wrong
    // password (backend D19); this screen must not be more specific.
    expect(alert).not.toHaveTextContent(/no account|not registered|does not exist/i);
    expect(readSession()).toBeNull();
  });

  it('puts a 422 under the field it belongs to, with no banner', async () => {
    const { user } = renderApp('/login', {
      responses: [
        validationFail([
          { source: 'body', field: 'email', message: 'Enter a valid email address.' },
        ]),
      ],
    });

    await user.type(field('email'), 'not-an-email');
    await user.type(field('^password'), 'CpseTest!2026');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Enter a valid email address.')).toBeInTheDocument();
    expect(field('email')).toHaveAttribute('aria-invalid', 'true');
    // The inputs already explain it; a banner repeating "validation failed"
    // would be noise.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('disables the button while signing in, so a double tap cannot submit twice', async () => {
    let resolve;
    const pending = new Promise((settle) => {
      resolve = settle;
    });
    const { user } = renderApp('/login', { responses: [() => pending] });

    await user.type(field('email'), 'test.customer@cpse.local');
    await user.type(field('^password'), 'CpseTest!2026');

    const button = screen.getByRole('button', { name: 'Sign in' });
    await user.click(button);

    await waitFor(() => expect(screen.getByRole('button', { name: /signing in/i })).toBeDisabled());

    resolve(ok({ customer: customerFixture(), session: sessionFixture() }));
  });

  it('reports an unreachable server as a connection problem, not a bad password', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }));
    render(
      <MemoryRouter future={ROUTER_FUTURE}>
        <AuthProvider>
          <Login />
        </AuthProvider>
      </MemoryRouter>,
    );
    const user = userEvent.setup();

    await user.type(field('email'), 'a@b.co');
    await user.type(field('^password'), 'CpseTest!2026');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/connection/i);
  });

  it('offers the way to a forgotten password and to registering', async () => {
    renderApp('/login');

    expect(await screen.findByRole('link', { name: /forgot your password/i })).toHaveAttribute(
      'href',
      '/forgot-password',
    );
    expect(screen.getByRole('link', { name: /create an account/i })).toHaveAttribute(
      'href',
      '/register',
    );
  });

  it('reveals the password on request, and says which state it is in', async () => {
    const { user } = renderApp('/login');

    const input = field('^password');
    expect(input).toHaveAttribute('type', 'password');

    await user.click(screen.getByRole('button', { name: 'Show' }));

    expect(input).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: 'Hide' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('sends a customer who is already signed in away from the form', async () => {
    renderApp('/login', { signedIn: true });

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeInTheDocument(),
    );
  });

  it('returns the customer to the page they were trying to reach', async () => {
    // Routed by URL rather than queued: the orders screen fetches once it opens,
    // and a queue would hand it the login response.
    mockRoutes({
      '/auth/login': ok({ customer: customerFixture(), session: sessionFixture() }),
      '/me': ok({ customer: customerFixture() }),
      '/orders': ok({ orders: [] }, { page: 1, limit: 10, total: 0, totalPages: 0, hasNextPage: false }),
    });
    const user = userEvent.setup();

    // Visiting a gated page unauthenticated redirects to sign-in with the intent.
    render(
      <MemoryRouter initialEntries={['/orders']} future={ROUTER_FUTURE}>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </MemoryRouter>,
    );

    await screen.findByRole('heading', { name: 'Sign in' });
    await user.type(field('email'), 'test.customer@cpse.local');
    await user.type(field('^password'), 'CpseTest!2026');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('heading', { name: 'Your orders' })).toBeInTheDocument();
  });
});

describe('register', () => {
  it('creates the account and signs in when a session comes back', async () => {
    const { user } = renderApp('/register', {
      responses: [created({ customer: customerFixture(), session: sessionFixture() })],
    });

    await user.type(field('email'), 'new@cpse.local');
    await user.type(field('^password'), 'CpseTest!2026');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() => expect(readSession()).not.toBeNull());
  });

  it('tells the customer to check their inbox when confirmation is required', async () => {
    const { user } = renderApp('/register', {
      responses: [
        created({ customer: customerFixture(), session: null, emailConfirmationRequired: true }),
      ],
    });

    await user.type(field('email'), 'new@cpse.local');
    await user.type(field('^password'), 'CpseTest!2026');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    // Without this the screen would appear to do nothing at all.
    expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeInTheDocument();
    expect(screen.getByText(/new@cpse.local/)).toBeInTheDocument();
    expect(readSession()).toBeNull();
  });

  it('omits the optional fields rather than sending them empty', async () => {
    const { user } = renderApp('/register', {
      responses: [created({ customer: customerFixture(), session: sessionFixture() })],
    });
    await user.type(field('email'), 'new@cpse.local');
    await user.type(field('^password'), 'CpseTest!2026');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() => expect(readSession()).not.toBeNull());
    // '' would fail the backend's min(1); an absent field is simply not set.
    const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    expect(body).toEqual({ email: 'new@cpse.local', password: 'CpseTest!2026' });
  });

  it('sends name and phone when they are filled in', async () => {
    const { user } = renderApp('/register', {
      responses: [created({ customer: customerFixture(), session: sessionFixture() })],
    });

    await user.type(field('email'), 'new@cpse.local');
    await user.type(field('^password'), 'CpseTest!2026');
    await user.type(field('full name'), '  Aditya Suresh  ');
    await user.type(field('phone'), '+919876543210');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() => expect(readSession()).not.toBeNull());
    const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    expect(body.fullName).toBe('Aditya Suresh');
    expect(body.phone).toBe('+919876543210');
  });

  it('reports a duplicate email as the server phrases it', async () => {
    const { user } = renderApp('/register', {
      responses: [fail(409, 'CONFLICT', 'An account with that email already exists.')],
    });

    await user.type(field('email'), 'test.customer@cpse.local');
    await user.type(field('^password'), 'CpseTest!2026');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/already exists/i);
  });

  it('shows the password rule before it is broken', async () => {
    renderApp('/register');

    expect(await screen.findByText(/at least 8 characters/i)).toBeInTheDocument();
  });

  it('marks the optional fields as optional', async () => {
    renderApp('/register');

    await screen.findByRole('heading', { name: 'Create account' });
    // Two optional fields: name and phone.
    expect(screen.getAllByText('(optional)')).toHaveLength(2);
  });
});

describe('forgot password', () => {
  it('confirms without revealing whether the account exists', async () => {
    const { user } = renderApp('/forgot-password', { responses: [ok({})] });

    await user.type(field('email'), 'someone@cpse.local');
    await user.click(screen.getByRole('button', { name: /send reset link/i }));

    const heading = await screen.findByRole('heading', { name: 'Check your email' });
    expect(heading).toBeInTheDocument();
    // "If it has an account" — the server answers 200 either way (D19), and the
    // wording must not leak what the server withholds.
    expect(screen.getByText(/if someone@cpse.local has an account/i)).toBeInTheDocument();
    expect(screen.queryByText(/we have sent you|we've sent you/i)).not.toBeInTheDocument();
  });

  it('lets the customer correct a mistyped address', async () => {
    const { user } = renderApp('/forgot-password', { responses: [ok({})] });

    await user.type(field('email'), 'typo@cpse.local');
    await user.click(screen.getByRole('button', { name: /send reset link/i }));
    await screen.findByRole('heading', { name: 'Check your email' });

    await user.click(screen.getByRole('button', { name: /different email/i }));

    expect(screen.getByRole('heading', { name: 'Forgot password' })).toBeInTheDocument();
  });
});

describe('reset password', () => {
  it('refuses to show a form when the link carries no token', async () => {
    renderApp('/reset-password');

    expect(
      await screen.findByRole('heading', { name: 'That link will not work' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save new password/i })).not.toBeInTheDocument();
  });

  it('saves a new password from a token in the query string', async () => {
    const { user } = renderApp('/reset-password?accessToken=recovery-token-1', {
      responses: [ok({})],
    });

    await user.type(screen.getByLabelText('New password'), 'BrandNew!2026');
    await user.type(screen.getByLabelText('Confirm new password'), 'BrandNew!2026');
    await user.click(screen.getByRole('button', { name: /save new password/i }));

    expect(await screen.findByRole('heading', { name: 'Password changed' })).toBeInTheDocument();
    const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    expect(body).toEqual({ accessToken: 'recovery-token-1', password: 'BrandNew!2026' });
  });

  it('refuses to submit when the two passwords differ', async () => {
    const { user } = renderApp('/reset-password?accessToken=recovery-token-1');

    await user.type(screen.getByLabelText('New password'), 'BrandNew!2026');
    await user.type(screen.getByLabelText('Confirm new password'), 'BrandNew!2025');
    await user.click(screen.getByRole('button', { name: /save new password/i }));

    expect(await screen.findByText('Both passwords must match.')).toBeInTheDocument();
    // Nothing was sent: the server never sees the confirmation, so this is the
    // one rule the screen owns.
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('clears the mismatch as soon as the customer fixes it', async () => {
    const { user } = renderApp('/reset-password?accessToken=t');

    await user.type(screen.getByLabelText('New password'), 'BrandNew!2026');
    await user.type(screen.getByLabelText('Confirm new password'), 'nope');
    await user.click(screen.getByRole('button', { name: /save new password/i }));
    await screen.findByText('Both passwords must match.');

    await user.type(screen.getByLabelText('Confirm new password'), 'x');

    expect(screen.queryByText('Both passwords must match.')).not.toBeInTheDocument();
  });

  it('reports an expired link the way the server does', async () => {
    const { user } = renderApp('/reset-password?accessToken=stale', {
      responses: [fail(401, 'UNAUTHORIZED', 'That reset link has expired.')],
    });

    await user.type(screen.getByLabelText('New password'), 'BrandNew!2026');
    await user.type(screen.getByLabelText('Confirm new password'), 'BrandNew!2026');
    await user.click(screen.getByRole('button', { name: /save new password/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/expired/i);
  });
});

describe('readRecoveryToken', () => {
  it('prefers the query string', () => {
    expect(readRecoveryToken(new URLSearchParams('accessToken=from-query'), '')).toBe('from-query');
    expect(readRecoveryToken(new URLSearchParams('access_token=snake'), '')).toBe('snake');
  });

  it('falls back to the URL fragment, which is where Supabase puts it', () => {
    const hash = '#access_token=from-fragment&type=recovery&expires_in=3600';

    expect(readRecoveryToken(new URLSearchParams(''), hash)).toBe('from-fragment');
  });

  it('parses the fragment rather than string-matching it', () => {
    // A naive split would swallow the following parameter into the token.
    const hash = '#type=recovery&access_token=abc123&refresh_token=xyz';

    expect(readRecoveryToken(new URLSearchParams(''), hash)).toBe('abc123');
  });

  it('is null when there is nothing to find', () => {
    expect(readRecoveryToken(new URLSearchParams(''), '')).toBeNull();
    expect(readRecoveryToken(new URLSearchParams(''), '#type=recovery')).toBeNull();
  });
});

describe('the account screen', () => {
  const renderAccount = (responses = []) =>
    renderApp('/account', { signedIn: true, responses });

  it('shows the profile, with the email not editable', async () => {
    renderAccount();

    await screen.findByRole('heading', { name: 'Account' });
    expect(screen.getByText('test.customer@cpse.local')).toBeInTheDocument();
    // Shown, but not as an input: the backend rejects an email change with a 422
    // rather than ignoring it, so offering the field would be a trap.
    expect(screen.queryByLabelText(/^email/i)).not.toBeInTheDocument();
    expect(screen.getByText(/cannot be changed here/i)).toBeInTheDocument();
  });

  it('pre-fills the editable fields from the profile', async () => {
    renderAccount();

    expect(await screen.findByLabelText(/full name/i)).toHaveValue('Test Customer');
    expect(screen.getByLabelText(/phone/i)).toHaveValue('+919876543210');
  });

  it('sends only what changed', async () => {
    const { user } = renderAccount([
      ok({ customer: customerFixture({ fullName: 'Aditya Suresh' }) }),
    ]);

    const name = await screen.findByLabelText(/full name/i);
    await user.clear(name);
    await user.type(name, 'Aditya Suresh');
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await screen.findByText('Saved.');
    // The phone did not change, so it is not in the payload — and the backend
    // rejects an empty object with "provide at least one field".
    expect(patchBody()).toEqual({ fullName: 'Aditya Suresh' });
  });

  it('sends null, not an empty string, to clear the phone', async () => {
    const { user } = renderAccount([ok({ customer: customerFixture({ phone: null }) })]);

    await user.clear(await screen.findByLabelText(/phone/i));
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await screen.findByText('Saved.');
    expect(patchBody()).toEqual({ phone: null });
  });

  it('does not call the server when nothing changed', async () => {
    const { user } = renderAccount();

    await screen.findByRole('heading', { name: 'Account' });
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await screen.findByText('Saved.');
    // No PATCH at all; the profile fetch and the badge poll are the only calls.
    expect(patchCalls()).toHaveLength(0);
  });

  it('puts a rejected phone number under the phone field', async () => {
    const { user } = renderAccount([
      validationFail([
        { source: 'body', field: 'phone', message: 'Enter a valid phone number.' },
      ]),
    ]);

    const phone = await screen.findByLabelText(/phone/i);
    await user.clear(phone);
    await user.type(phone, '12');
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    expect(await screen.findByText('Enter a valid phone number.')).toBeInTheDocument();
  });

  it('links to everything the customer owns', async () => {
    renderAccount();

    await screen.findByRole('heading', { name: 'Account' });
    // Scoped to the account's own list: the bottom tab bar also has an "Orders"
    // link and the header a "Saved stores" one, and matching those would prove
    // nothing about this screen.
    const links = within(screen.getByRole('navigation', { name: 'Your things' }));

    for (const [name, href] of [
      ['Addresses', '/account/addresses'],
      ['Orders', '/orders'],
      ['Notifications', '/notifications'],
      ['Khata', '/khata'],
    ]) {
      // Anchored: each row's accessible name is "<label> <hint>", and the
      // Addresses hint reads "Where your orders go".
      expect(links.getByRole('link', { name: new RegExp(`^${name}`, 'i') })).toHaveAttribute(
        'href',
        href,
      );
    }
  });

  it('signs out and returns to the shop', async () => {
    const { user } = renderAccount([noContent()]);

    await user.click(await screen.findByRole('button', { name: 'Sign out' }));

    await waitFor(() => expect(readSession()).toBeNull());
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(/shop nearby/i);
  });
});
