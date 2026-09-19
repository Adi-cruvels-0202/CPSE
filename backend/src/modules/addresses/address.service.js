import { supabaseAdmin } from '../../lib/supabase.js';
import { internal, notFound } from '../../lib/errors.js';

/**
 * Address book — checklist 6.1 – 6.6.
 *
 * Ownership (6.6) is enforced the same way everywhere: `customer_id` comes from
 * the verified JWT and is part of every filter, so another customer's address
 * is indistinguishable from one that does not exist — a 404, never a 403.
 */

const COLUMNS = `
  id, customer_id, label, recipient_name, phone, line1, line2, landmark,
  city, state, postal_code, country, latitude, longitude, is_default,
  created_at, updated_at
`;

const fail = (error, message) => {
  if (error) throw internal(message);
};

export const toPublicAddress = (row) => ({
  id: row.id,
  label: row.label ?? null,
  recipientName: row.recipient_name,
  phone: row.phone,
  line1: row.line1,
  line2: row.line2 ?? null,
  landmark: row.landmark ?? null,
  city: row.city,
  state: row.state,
  postalCode: row.postal_code,
  country: row.country,
  latitude: row.latitude === null || row.latitude === undefined ? null : Number(row.latitude),
  longitude: row.longitude === null || row.longitude === undefined ? null : Number(row.longitude),
  isDefault: row.is_default,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toRow = (input) => {
  const row = {};
  const map = {
    label: 'label',
    recipientName: 'recipient_name',
    phone: 'phone',
    line1: 'line1',
    line2: 'line2',
    landmark: 'landmark',
    city: 'city',
    state: 'state',
    postalCode: 'postal_code',
    country: 'country',
    latitude: 'latitude',
    longitude: 'longitude',
  };

  for (const [key, column] of Object.entries(map)) {
    if (input[key] !== undefined) row[column] = input[key];
  }
  return row;
};

/** Checklist 6.1. Default first, then newest — the order a picker renders in. */
export async function listAddresses(customerId) {
  const { data, error } = await supabaseAdmin
    .from('addresses')
    .select(COLUMNS)
    .eq('customer_id', customerId)
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: false });

  fail(error, 'Could not load your addresses.');
  return (data ?? []).map(toPublicAddress);
}

/** Checklist 6.6. The customer id is part of the filter, not a check after the fact. */
export async function findOwnedAddress(customerId, addressId) {
  const { data, error } = await supabaseAdmin
    .from('addresses')
    .select(COLUMNS)
    .eq('id', addressId)
    .eq('customer_id', customerId)
    .maybeSingle();

  fail(error, 'Could not load the address.');
  if (!data) throw notFound('Address');
  return data;
}

export async function getAddress(customerId, addressId) {
  return toPublicAddress(await findOwnedAddress(customerId, addressId));
}

/**
 * `addresses_one_default_per_customer` is a partial unique index, so two
 * defaults cannot coexist even for a moment. Clearing the old one first is
 * therefore mandatory, not just tidy.
 */
async function clearDefault(customerId, exceptId = null) {
  let query = supabaseAdmin
    .from('addresses')
    .update({ is_default: false })
    .eq('customer_id', customerId)
    .eq('is_default', true);

  if (exceptId) query = query.neq('id', exceptId);

  const { error } = await query;
  fail(error, 'Could not update your default address.');
}

async function countAddresses(customerId) {
  const { count, error } = await supabaseAdmin
    .from('addresses')
    .select('id', { count: 'exact' })
    .eq('customer_id', customerId);

  fail(error, 'Could not load your addresses.');
  return count ?? 0;
}

/** Checklist 6.2. The first address a customer saves becomes their default. */
export async function createAddress(customerId, input) {
  const isFirst = (await countAddresses(customerId)) === 0;
  const isDefault = input.isDefault || isFirst;

  if (isDefault) await clearDefault(customerId);

  const { data, error } = await supabaseAdmin
    .from('addresses')
    .insert({ ...toRow(input), customer_id: customerId, is_default: isDefault })
    .select(COLUMNS)
    .single();

  fail(error, 'Could not save the address.');
  return toPublicAddress(data);
}

/** Checklist 6.3 */
export async function updateAddress(customerId, addressId, input) {
  const existing = await findOwnedAddress(customerId, addressId);

  if (input.isDefault === true) await clearDefault(customerId, addressId);

  const patch = toRow(input);
  if (input.isDefault !== undefined) {
    // Un-defaulting the only default is allowed: a customer with no default
    // simply has to pick an address at checkout.
    patch.is_default = input.isDefault;
  }

  const { data, error } = await supabaseAdmin
    .from('addresses')
    .update(patch)
    .eq('id', existing.id)
    .eq('customer_id', customerId)
    .select(COLUMNS)
    .maybeSingle();

  fail(error, 'Could not update the address.');
  if (!data) throw notFound('Address');
  return toPublicAddress(data);
}

/**
 * Checklist 6.4. Deleting is always allowed, even with live orders against it:
 * `orders.delivery_address` holds a JSON snapshot taken at order time (D11) and
 * the FK is `on delete set null`, so history keeps showing where the order went.
 * Blocking the delete instead would let a finished order pin an address the
 * customer has moved away from.
 */
export async function deleteAddress(customerId, addressId) {
  const existing = await findOwnedAddress(customerId, addressId);

  const { error } = await supabaseAdmin
    .from('addresses')
    .delete()
    .eq('id', existing.id)
    .eq('customer_id', customerId);

  fail(error, 'Could not delete the address.');

  // Deleting the default promotes the next most recent one, so a customer is
  // never left with addresses but no default.
  if (existing.is_default) {
    const remaining = await listAddresses(customerId);
    if (remaining.length > 0) await setDefaultAddress(customerId, remaining[0].id);
  }
}

/** Checklist 6.5 */
export async function setDefaultAddress(customerId, addressId) {
  const existing = await findOwnedAddress(customerId, addressId);

  await clearDefault(customerId, existing.id);

  const { data, error } = await supabaseAdmin
    .from('addresses')
    .update({ is_default: true })
    .eq('id', existing.id)
    .eq('customer_id', customerId)
    .select(COLUMNS)
    .maybeSingle();

  fail(error, 'Could not set your default address.');
  if (!data) throw notFound('Address');
  return toPublicAddress(data);
}
