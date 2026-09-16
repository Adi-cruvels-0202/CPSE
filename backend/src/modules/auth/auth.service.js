import { supabaseAdmin, supabaseAnon, createUserClient } from '../../lib/supabase.js';
import { conflict, internal, unauthorized, badRequest } from '../../lib/errors.js';
import { env } from '../../config/env.js';

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

function isAlreadyRegistered(error) {
  return error.status === 422 || /already (been )?registered|already exists/i.test(error.message);
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
    throw badRequest(error.message);
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
