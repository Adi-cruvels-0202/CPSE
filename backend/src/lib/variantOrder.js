/**
 * The order a product's options are shown in: smallest pack first — 250 g,
 * 500 g, 1 kg, 2 kg, 5 kg — wherever they appear (merchant product panel,
 * customer product page, product cards), however they were added.
 *
 * The size comes from the variant's `weight_grams` when set, otherwise from its
 * name ("500 g", "1 kg", "1.5 litre", "Pack of 6", "a dozen"). A product's
 * original "Default" option comes first; then weights, volumes and counts;
 * options without a readable size ("Large") follow, in the order they were
 * added. Equal sizes keep that order too.
 */

const WEIGHT = { kg: 1000, kgs: 1000, kilo: 1000, kilos: 1000, kilogram: 1000, kilograms: 1000, g: 1, gm: 1, gms: 1, gram: 1, grams: 1, gr: 1 };
const VOLUME = { l: 1000, ltr: 1000, litre: 1000, litres: 1000, liter: 1000, liters: 1000, ml: 1 };
const KIND = { base: -1, weight: 0, volume: 1, count: 2, none: 3 };

/** `{ kind, amount }` for one variant row (snake_case, as read from the database). */
export function variantSize(row) {
  // "Default" is the product itself, before any options were added: it leads.
  if (row?.name === 'Default') return { kind: 'base', amount: 0 };
  if (Number.isFinite(row?.weight_grams) && row.weight_grams > 0) return { kind: 'weight', amount: row.weight_grams };
  const name = String(row?.name ?? '').toLowerCase();
  const measured = name.match(/(\d+(?:\.\d+)?)\s*(kilograms?|kilos?|kgs?|grams?|gms?|gm|gr|g|litres?|liters?|ltr|ml|l)\b/);
  if (measured) {
    const amount = Number(measured[1]);
    const unit = measured[2];
    if (WEIGHT[unit] !== undefined) return { kind: 'weight', amount: amount * WEIGHT[unit] };
    if (VOLUME[unit] !== undefined) return { kind: 'volume', amount: amount * VOLUME[unit] };
  }
  const pack = name.match(/(?:pack of|set of|box of)\s*(\d+)|(\d+)\s*(?:pcs|pieces?|pack|count|nos?|units?)\b/);
  if (pack) return { kind: 'count', amount: Number(pack[1] ?? pack[2]) };
  if (/\b(a|one)\s+dozen\b|^dozen$/.test(name)) return { kind: 'count', amount: 12 };
  const dozens = name.match(/(\d+)\s*dozen/);
  if (dozens) return { kind: 'count', amount: Number(dozens[1]) * 12 };
  return { kind: 'none', amount: 0 };
}

export function compareVariants(a, b) {
  const x = variantSize(a);
  const y = variantSize(b);
  return (
    KIND[x.kind] - KIND[y.kind] ||
    x.amount - y.amount ||
    (a.sort_order ?? 0) - (b.sort_order ?? 0) ||
    String(a.name ?? '').localeCompare(String(b.name ?? ''))
  );
}

/** A sorted copy; the input is left as it was. */
export const sortVariants = (rows) => [...(rows ?? [])].sort(compareVariants);
