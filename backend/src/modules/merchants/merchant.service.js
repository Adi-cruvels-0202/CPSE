import { supabaseAdmin, supabaseAnon } from '../../lib/supabase.js';
import { conflict, internal, notFound } from '../../lib/errors.js';
import {
  MERCHANT_COLUMNS,
  loadMerchant,
  toSession,
  isAlreadyRegistered,
  signUpFailure,
} from '../auth/auth.service.js';

/**
 * The merchant account — MERCHANT_API.md, Merchant account; MERGE_MAPPING D-2.
 *
 * One Supabase Auth for everyone. A merchant is an auth user with a row in
 * `merchants`, exactly as a customer is one with a row in `customers`; every
 * auth user has the customers row (the signup trigger, migration 0003), so a
 * merchant can also shop with the same login.
 */

/** The merchant profile as the API exposes it. */
export function toPublicMerchant(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name ?? null,
    phone: row.phone ?? null,
    createdAt: row.created_at,
  };
}

/** One row of the store switcher the merchant app shows after login. */
const toStoreSummary = (row) => ({
  id: row.id,
  name: row.name,
  slug: row.slug,
  isPublished: row.is_published,
  logoUrl: row.logo_url ?? null,
});

/** Postgres' unique-violation code: two onboard calls racing for the same id. */
const UNIQUE_VIOLATION = '23505';

async function insertMerchant({ id, email, fullName, phone }) {
  const { data, error } = await supabaseAdmin
    .from('merchants')
    .insert({ id, email, full_name: fullName ?? null, phone: phone ?? null })
    .select(MERCHANT_COLUMNS)
    .single();

  if (error?.code === UNIQUE_VIOLATION) return { merchant: await loadMerchant(id), created: false };
  if (error) throw internal('Could not set up the merchant account.');
  return { merchant: data, created: true };
}

/**
 * `POST /merchant/auth/register` — a new login that is a merchant from the
 * start. Same rules and the same wording as customer registration (D19): a
 * taken email is 409 "already exists", and nothing else is said about it.
 */
export async function registerMerchant({ email, password, fullName, phone }) {
  const { data, error } = await supabaseAnon.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName, phone: phone ?? null } },
  });

  if (error) {
    if (isAlreadyRegistered(error)) throw conflict('An account with that email already exists.');
    throw signUpFailure(error);
  }

  const user = data.user;

  // With email confirmation on, Supabase answers an address that is already
  // registered with a stand-in user that has no identities and was never
  // saved — and no error, so sign-up cannot be used to test which emails
  // exist. Nothing is written for it; the screen says "check your inbox", the
  // same as for a genuinely new address.
  if (!user || (Array.isArray(user.identities) && user.identities.length === 0)) {
    return { merchant: null, session: null, emailConfirmationRequired: true };
  }

  // The auth user exists from here on. If this insert failed, they could still
  // sign in and finish with POST /merchant/onboard, so the account is never
  // left unusable.
  const { merchant } = await insertMerchant({
    id: user.id,
    email: user.email ?? email,
    fullName,
    phone,
  });

  return {
    merchant: toPublicMerchant(merchant),
    session: toSession(data.session),
    emailConfirmationRequired: !data.session,
  };
}

/**
 * `POST /merchant/onboard` — an existing signed-in account (a customer today)
 * becomes a merchant too. Idempotent: an existing merchant gets their profile
 * back with `created: false`, which the controller turns into 200 rather than
 * 201. Fields left out are taken from the customer profile.
 */
export async function onboardMerchant(customer, { fullName, phone }) {
  const existing = await loadMerchant(customer.id);
  if (existing) return { merchant: toPublicMerchant(existing), created: false };

  const { merchant, created } = await insertMerchant({
    id: customer.id,
    email: customer.email,
    fullName: fullName ?? customer.full_name ?? null,
    phone: phone ?? customer.phone ?? null,
  });

  return { merchant: toPublicMerchant(merchant), created };
}

/** `GET /merchant/me` — the profile and the stores it owns, newest first. */
export async function getMerchantHome(merchant) {
  const { data, error } = await supabaseAdmin
    .from('stores')
    .select('id, name, slug, is_published, logo_url, created_at')
    .eq('owner_id', merchant.id)
    .order('created_at', { ascending: false });

  if (error) throw internal('Could not load your stores.');

  return { merchant: toPublicMerchant(merchant), stores: (data ?? []).map(toStoreSummary) };
}

/** `PATCH /merchant/me` — only the caller's own row; the id comes from the token. */
export async function updateMerchant(merchantId, { fullName, phone }) {
  const patch = {};
  if (fullName !== undefined) patch.full_name = fullName;
  if (phone !== undefined) patch.phone = phone;

  const { data, error } = await supabaseAdmin
    .from('merchants')
    .update(patch)
    .eq('id', merchantId)
    .select(MERCHANT_COLUMNS)
    .maybeSingle();

  if (error) throw internal('Could not update the merchant profile.');
  if (!data) throw notFound('Merchant');
  return toPublicMerchant(data);
}
