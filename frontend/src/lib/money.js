/**
 * Money is integer paise everywhere, in and out of the API (backend D8). It is
 * turned into rupees exactly once, here, at the moment it is displayed.
 *
 * Nothing in this app divides by 100 anywhere else. A float that has been
 * through arithmetic is how a total stops matching the receipt.
 */

const formatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** 19900 → "₹199.00" */
export function formatPaise(paise) {
  if (paise === null || paise === undefined || Number.isNaN(Number(paise))) return '—';
  return formatter.format(Number(paise) / 100);
}

/** 19900 → "₹199", for a compact list row. Keeps the paise when they are not 00. */
export function formatPaiseShort(paise) {
  if (paise === null || paise === undefined || Number.isNaN(Number(paise))) return '—';
  const value = Number(paise);
  return value % 100 === 0
    ? `₹${(value / 100).toLocaleString('en-IN')}`
    : formatPaise(value);
}

/** The discount a struck-through MRP implies, as a whole percentage. */
export function discountPercent(pricePaise, mrpPaise) {
  if (!mrpPaise || !pricePaise || mrpPaise <= pricePaise) return null;
  return Math.round(((mrpPaise - pricePaise) / mrpPaise) * 100);
}
