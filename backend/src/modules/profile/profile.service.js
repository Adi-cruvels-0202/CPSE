import { supabaseAdmin } from '../../lib/supabase.js';
import { internal, notFound } from '../../lib/errors.js';
import { toPublicCustomer } from '../auth/auth.service.js';

/**
 * Checklist 2.9. Only ever updates the row belonging to the caller: the id
 * comes from the verified JWT (via requireAuth), never from the request body,
 * so there is no ownership check to get wrong.
 *
 * Email and id are not updatable here — the request schema rejects them
 * outright, and this function would ignore them anyway.
 */
export async function updateProfile(customerId, { fullName, phone, avatarUrl }) {
  const patch = {};
  if (fullName !== undefined) patch.full_name = fullName;
  if (phone !== undefined) patch.phone = phone;
  if (avatarUrl !== undefined) patch.avatar_url = avatarUrl;

  const { data, error } = await supabaseAdmin
    .from('customers')
    .update(patch)
    .eq('id', customerId)
    .select('id, email, full_name, phone, avatar_url, created_at, updated_at')
    .maybeSingle();

  if (error) throw internal('Could not update the profile.');
  if (!data) throw notFound('Customer');

  return toPublicCustomer(data);
}
