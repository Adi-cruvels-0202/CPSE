import { supabaseAdmin, supabaseAnon, createUserClient } from '../../lib/supabase.js';
import {
  conflict,
  internal,
  unauthorized,
  badRequest,
  unprocessable,
  serviceUnavailable,
} from '../../lib/errors.js';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';

/**
 * Everything that talks to Supabase Auth lives here (decision D1 — we use the
 * shared auth system and never build our own). Controllers stay free of
 * Supabase-specific shapes and error strings.
 */

/** The session fields the frontend needs, camelCased like the rest of the API. */
export function toSession(session) {
  if (!session) return null;
  return {
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    tokenType: session.token_type ?? 'bearer',
    expiresIn: session.expires_in,
    expiresAt: session.expires_at,
  };
}

/** The customer profile as the API exposes it. */
export function toPublicCustomer(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name ?? null,
    phone: row.phone ?? null,
    avatarUrl: row.avatar_url ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Supabase reports a wrong password and an unknown email identically, and we
 * keep it that way: telling them apart would turn the login form into an
 * account-existence oracle.
 */
const INVALID_CREDENTIALS = 'Email or password is incorrect.';

/**
 * Matched on the message, deliberately not on the status.
 *
 * Supabase answers 422 for several different sign-up refusals — a weak password
 * among them — so treating every 422 as "already registered" told a customer
 * their email was taken when it was not. That is wrong, and it is also an
 * account-existence oracle of exactly the kind D19 exists to prevent: it claims
 * an account exists in response to a password the server merely disliked.
 *
 * Anything not recognised here falls through to signUpFailure, which never
 * asserts that an account exists.
 */
/**
 * Tells "these credentials are wrong" apart from "the auth service is not
 * answering properly".
 *
 * Supabase answers a bad password with a 400 and a short message. An HTML body is
 * something in front of it — Cloudflare, a proxy — and a 5xx is Supabase itself
 * being unwell. Neither is a statement about the password.
 *
 * Deliberately narrow: anything unrecognised is still treated as a credential
 * failure, so an unfamiliar error can never become an account-existence signal.
 */
function isUpstreamOutage(error) {
  const message = String(error?.message ?? '');

  if (/^\s*<(!doctype|html)/i.test(message)) return true;
  if (typeof error?.status === 'number' && error.status >= 500) return true;
  return /fetch failed|network|socket hang up|ECONNRESET|ETIMEDOUT/i.test(message);
}

function isAlreadyRegistered(error) {
  return /already (been )?registered|already exists|user_already_exists/i.test(error?.message ?? '');
}

/**
 * Turns a Supabase sign-up failure into something a customer can act on.
 *
 * Supabase's own wording is written for whoever is reading its logs, not for a
 * shopper: `email rate limit exceeded` and `Email address "x@y.local" is
 * invalid` both reached the register screen verbatim before this existed. Worse,
 * passing `error.message` straight through means any future message Supabase
 * adds becomes customer-facing copy nobody wrote.
 *
 * So: the cases worth naming are named, and anything else gets a generic
 * sentence while the real text goes to the log for us.
 */
function signUpFailure(error) {
  const message = error?.message ?? '';

  if (/rate limit/i.test(message)) {
    return badRequest(
      'Too many sign-up attempts from here just now. Please wait a few minutes and try again.',
    );
  }
  if (/invalid|not valid/i.test(message) && /email/i.test(message)) {
    // Supabase rejects addresses whose domain it cannot believe in — a .local
    // or .test TLD, for instance.
    return unprocessable(
      'EMAIL_NOT_ACCEPTED',
      'That email address was not accepted. Please check it, or try a different one.',
      { issues: [{ source: 'body', field: 'email', message: 'This address was not accepted.' }] },
    );
  }
  if (/password/i.test(message)) {
    return unprocessable('WEAK_PASSWORD', 'That password was not accepted.', {
      issues: [{ source: 'body', field: 'password', message: 'Choose a stronger password.' }],
    });
  }

  logger.error('Unmapped sign-up failure from Supabase', { reason: message });
  return badRequest('We could not create the account just now. Please try again.');
}

export async function loadCustomer(id) {
  const { data, error } = await supabaseAdmin
    .from('customers')
    .select('id, email, full_name, phone, avatar_url, created_at, updated_at')
    .eq('id', id)
    .maybeSingle();

  if (error) throw internal('Could not load the customer profile.');
  return data ?? null;
}

/**
 * Checklist 2.1. The customers row itself is created by the on_auth_user_created
 * trigger (migration 0003), so this only calls Supabase Auth and then reads the
 * row back.
 */
export async function register({ email, password, fullName, phone }) {
  const { data, error } = await supabaseAnon.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName ?? null, phone: phone ?? null } },
  });

  if (error) {
    if (isAlreadyRegistered(error)) {
      throw conflict('An account with that email already exists.');
    }
    throw signUpFailure(error);
  }

  // With email confirmation enabled Supabase returns a user but no session.
  // That is a valid outcome, not an error — the client shows "check your inbox".
  const customer = data.user ? await loadCustomer(data.user.id) : null;

  return {
    customer: toPublicCustomer(customer),
    session: toSession(data.session),
    emailConfirmationRequired: Boolean(data.user) && !data.session,
  };
}

/** Checklist 2.2. */
export async function login({ email, password }) {
  const { data, error } = await supabaseAnon.auth.signInWithPassword({ email, password });

  // An auth service that is briefly unreachable is not a wrong password. D19 says
  // every credential failure must look identical — and it still does — but telling
  // a customer their password is wrong when the truth is "the upstream hiccupped"
  // sends them to reset a password that was fine. Only a refusal *of the
  // credentials* gets the generic message.
  if (error && isUpstreamOutage(error)) {
    logger.error('Auth upstream refused a sign-in', {
      status: error.status,
      reason: String(error.message ?? '').slice(0, 120),
    });
    throw serviceUnavailable('Sign-in is unavailable right now. Please try again in a moment.');
  }

  if (error || !data?.session) throw unauthorized(INVALID_CREDENTIALS);

  const customer = await loadCustomer(data.user.id);
  return { customer: toPublicCustomer(customer), session: toSession(data.session) };
}

/** Checklist 2.3. Rotates the session; Supabase invalidates the old refresh token. */
export async function refresh({ refreshToken }) {
  const { data, error } = await supabaseAnon.auth.refreshSession({ refresh_token: refreshToken });

  if (error || !data?.session) throw unauthorized('That refresh token is no longer valid.');
  return { session: toSession(data.session) };
}

/**
 * Checklist 2.4. Revokes the refresh tokens behind this access token, so the
 * session cannot be resurrected. 'global' signs the customer out everywhere,
 * which is what a shared-device logout should do.
 */
export async function logout(accessToken) {
  const { error } = await supabaseAdmin.auth.admin.signOut(accessToken, 'global');

  // An already-invalid token means the caller is logged out, which is the
  // outcome they asked for. Anything else is a real failure.
  if (error && error.status !== 401 && error.status !== 403 && error.status !== 404) {
    throw internal('Could not complete sign out.');
  }
}

/**
 * Checklist 2.5. Always succeeds from the caller's point of view — reporting
 * "no such account" here would leak which emails are registered.
 */
export async function forgotPassword({ email }) {
  await supabaseAnon.auth.resetPasswordForEmail(email, {
    redirectTo: env.PASSWORD_RESET_REDIRECT_URL,
  });
}

/**
 * Checklist 2.5. The access token comes from the emailed recovery link, so the
 * update runs as that user rather than through the admin API.
 */
export async function resetPassword({ accessToken, password }) {
  const client = createUserClient(accessToken);
  const { data, error } = await client.auth.updateUser({ password });

  if (error) {
    if (error.status === 401 || error.status === 403) {
      throw unauthorized('That reset link has expired. Request a new one.');
    }
    throw badRequest(error.message);
  }

  return { customer: toPublicCustomer(await loadCustomer(data.user.id)) };
}

/**
 * Verifies a bearer token with Supabase and returns the auth user.
 * Used by requireAuth/optionalAuth (checklist 2.6, 2.7).
 */
export async function verifyAccessToken(accessToken) {
  const { data, error } = await supabaseAdmin.auth.getUser(accessToken);
  if (error || !data?.user) return null;
  return data.user;
}
