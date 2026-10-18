/**
 * Whether a local offer may sell right now — the JavaScript mirror of
 * public.offer_end_reason (migration 0042), which create_order enforces under
 * a row lock. Pure; the caller supplies the clock and the batch's expiry.
 *
 * Returns null when live, or the reason it is not: manual, period_ended,
 * sold_out, expiry_cutoff, not_started.
 */
export function offerEndReason(offer, { now = new Date(), quantity = 1, batchExpiresOn = null, today = null } = {}) {
  if (!offer.is_active || offer.ended_at) return offer.end_reason ?? 'manual';
  if (now < new Date(offer.starts_at)) return 'not_started';
  if (now >= new Date(offer.ends_at)) return 'period_ended';
  if (offer.quantity_limit !== null && offer.quantity_limit !== undefined && offer.quantity_sold + quantity > offer.quantity_limit) {
    return 'sold_out';
  }
  if (batchExpiresOn && today) {
    const [y, m, d] = batchExpiresOn.split('-').map(Number);
    const cutoff = new Date(Date.UTC(y, m - 1, d - (offer.expiry_cutoff_days ?? 0))).toISOString().slice(0, 10);
    if (today > cutoff) return 'expiry_cutoff';
  }
  return null;
}

export const OFFER_END_LABELS = {
  manual: 'Ended by the store',
  period_ended: 'Offer period over',
  sold_out: 'All offer stock sold',
  expiry_cutoff: 'Too close to its expiry date to sell',
  stock_unavailable: 'Out of stock',
  not_started: 'Not started yet',
};

/** Great-circle distance in km between two points. */
export function distanceKm(aLat, aLng, bLat, bLng) {
  const rad = (deg) => (deg * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}
