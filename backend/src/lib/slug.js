/**
 * URL keys for stores, categories and products (MERCHANT_RULES S-4): lower-
 * case, every run of other characters becomes one hyphen, and an empty result
 * falls back to `fallback`. Matches the `*_slug_format` CHECKs in the schema.
 */
export function slugify(name, fallback = 'item') {
  const base = String(name)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
    .replace(/-+$/, '');
  return base.length >= 2 ? base : fallback;
}

/**
 * The first of base, base-2, base-3, … that `isTaken` says is free. After a
 * hundred it stops counting and appends something unique instead.
 */
export async function firstFreeSlug(base, isTaken) {
  for (let suffix = 1; suffix < 100; suffix += 1) {
    const candidate = suffix === 1 ? base : `${base}-${suffix}`;
    if (!(await isTaken(candidate))) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}
