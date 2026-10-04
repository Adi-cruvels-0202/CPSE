import { supabaseAdmin, supabaseAnon } from '../../lib/supabase.js';
import { conflict, internal, notFound, customerAccount } from '../../lib/errors.js';
import {
  MERCHANT_COLUMNS,
  loadMerchant,
  toSession,
  isAlreadyRegistered,
  signUpFailure,
  signInWithPassword,
  endSession,
} from '../auth/auth.service.js';

/**
 * The merchant account — MERCHANT_API.md, Merchant account; MERGE_MAPPING D-2.
 *
 * One Supabase Auth for everyone, but a shop account and a customer account
 * are separate logins (D-2, revised). A shop account is an auth user with a row
 * in `merchants`. The signup trigger (migration 0003) still gives it a
 * customers row, but requireCustomer refuses it everywhere on the customer
 * side, so a shopkeeper who wants to shop signs up again with another email.
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
    // account_type marks the login as a shop account from its first moment, so
    // POST /merchant/auth/login can finish setting it up if the insert below
    // never happened.
    options: { data: { full_name: fullName, phone: phone ?? null, account_type: 'merchant' } },
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

  // The auth user exists from here on. If this insert failed, signing in to
  // the shop app finishes it (loginMerchant), so the account is never left
  // unusable.
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
 * `POST /merchant/auth/login` — the shop app's sign-in. A customer account is
 * refused (403 CUSTOMER_ACCOUNT): shop and customer accounts are separate
 * logins with separate emails (MERGE_MAPPING D-2, revised). A login made by
 * shop sign-up whose merchants row never got written is finished here.
 */
export async function loginMerchant(credentials) {
  const data = await signInWithPassword(credentials);
  const user = data.user;

  let merchant = await loadMerchant(user.id);
  if (!merchant && user.user_metadata?.account_type === 'merchant') {
    ({ merchant } = await insertMerchant({
      id: user.id,
      email: user.email,
      fullName: user.user_metadata.full_name ?? null,
      phone: user.user_metadata.phone ?? null,
    }));
  }
  if (!merchant) {
    await endSession(data.session.access_token);
    throw customerAccount();
  }

  return { merchant: toPublicMerchant(merchant), session: toSession(data.session), roles: ['merchant'] };
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
