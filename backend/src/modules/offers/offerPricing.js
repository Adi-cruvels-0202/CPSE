import { supabaseAdmin } from '../../lib/supabase.js';
import { internal } from '../../lib/errors.js';
import { offerEndReason } from '../../lib/offers.js';
import { localDate } from '../../lib/khataAgeing.js';

export const OFFER_COLUMNS = `
  id, store_id, product_id, variant_id, batch_id, kind, title, description, offer_price_paise,
  starts_at, ends_at, quantity_limit, quantity_sold, radius_km, expiry_cutoff_days, is_active,
  ended_at, end_reason, created_at, updated_at
`;

/**
 * The live offer on each of these variants, with what is needed to judge it
 * for any quantity: Map variantId → { offer, batchExpiresOn, today }.
 * Offers whose window, stock cap or safety cut-off has passed are left out,
 * whatever their stored state — a stale row never prices a cart.
 */
export async function liveOffersByVariant(storeId, timeZone, variantIds, now = new Date()) {
  if (variantIds.length === 0) return new Map();
  const { data, error } = await supabaseAdmin
    .from('store_offers')
    .select(OFFER_COLUMNS)
    .eq('store_id', storeId)
    .eq('is_active', true)
    .is('ended_at', null)
    .in('variant_id', variantIds);
  if (error) throw internal('Could not load offers.');

  const offers = data ?? [];
  const batchIds = offers.map((offer) => offer.batch_id).filter(Boolean);
  const expiries = new Map();
  if (batchIds.length) {
    const { data: batches, error: batchError } = await supabaseAdmin
      .from('inventory_batches')
      .select('id, expires_on')
      .in('id', batchIds);
    if (batchError) throw internal('Could not load offers.');
    for (const batch of batches ?? []) expiries.set(batch.id, batch.expires_on);
  }

  const today = localDate(now, timeZone);
  const live = new Map();
  for (const offer of offers) {
    const context = { now, batchExpiresOn: offer.batch_id ? expiries.get(offer.batch_id) ?? null : null, today };
    if (offerEndReason(offer, { ...context, quantity: 1 }) === null) live.set(offer.variant_id, { offer, ...context });
  }
  return live;
}

/** Units still available at the offer price (null = no cap). */
export const offerUnitsLeft = (offer) =>
  offer.quantity_limit === null || offer.quantity_limit === undefined ? null : offer.quantity_limit - offer.quantity_sold;
