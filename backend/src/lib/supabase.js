import { createClient } from '@supabase/supabase-js';
import { env } from '../config/env.js';

const baseOptions = {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
  },
};

/**
 * Service-role client. Bypasses Row Level Security, so ownership MUST be
 * enforced in application code on every query (see PROJECT_CONTEXT.md D5).
 * Never expose this client or its key outside the server.
 */
export const supabaseAdmin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, baseOptions);

/**
 * Anon client — used only for auth flows (sign up, sign in, password reset)
 * where we deliberately want Supabase's public behaviour.
 */
export const supabaseAnon = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, baseOptions);

/**
 * A client bound to an end user's access token. Queries made through it run
 * under that user's identity, so RLS applies. Used as defense-in-depth for
 * reads of customer-owned data.
 */
export function createUserClient(accessToken) {
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    ...baseOptions,
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}
