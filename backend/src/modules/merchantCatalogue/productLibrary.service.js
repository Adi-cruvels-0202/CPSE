import { supabaseAdmin } from '../../lib/supabase.js';
import { internal } from '../../lib/errors.js';

/**
 * The CPSE product library: what other shops have already entered for a
 * barcode, offered to a shop that scans that pack for the first time, so it
 * types its price and stock instead of the whole product.
 *
 * Only what is printed on the pack is shared — name, option (size), unit, GST
 * rate, MRP, weight and the category's name. Never a shop's selling price,
 * cost, stock, sales, photos, or which shops sell it. Where shops disagree,
 * the answer most of them gave wins (counted once per shop); it is a pre-fill
 * the merchant checks, never something saved for them.
 */

const fail = (error, message) => {
  if (error) throw internal(message);
};

const norm = (text) => String(text ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/** The value most shops gave (null and '' ignored); ties go to the first seen. */
function majority(values, key = (value) => value) {
  const counts = new Map();
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue;
    const k = key(value);
    const entry = counts.get(k) ?? { value, count: 0 };
    entry.count += 1;
    counts.set(k, entry);
  }
  let best = null;
  for (const entry of counts.values()) if (!best || entry.count > best.count) best = entry;
  return best ? { value: best.value, count: best.count } : null;
}

export async function libraryForBarcode(store, barcode) {
  const { data: variants, error } = await supabaseAdmin
    .from('product_variants')
    .select('id, name, weight_grams, mrp_paise, product_id, store_id')
    .eq('barcode', barcode)
    .neq('store_id', store.id);
  fail(error, 'Could not search the product library.');

  const productIds = [...new Set((variants ?? []).map((v) => v.product_id))];
  const storeIds = [...new Set((variants ?? []).map((v) => v.store_id))];
  if (productIds.length === 0) return { library: { barcode, found: false, suggestion: null } };

  const [products, stores] = await Promise.all([
    supabaseAdmin.from('products').select('id, name, unit, tax_percent, category_id, archived_at').in('id', productIds),
    supabaseAdmin.from('stores').select('id, is_active').in('id', storeIds),
  ]);
  fail(products.error, 'Could not search the product library.');
  fail(stores.error, 'Could not search the product library.');
  const activeStores = new Set((stores.data ?? []).filter((s) => s.is_active).map((s) => s.id));
  const productById = new Map((products.data ?? []).filter((p) => !p.archived_at).map((p) => [p.id, p]));

  // One entry per shop: its product for this barcode.
  const entries = [];
  const seenStores = new Set();
  for (const variant of variants) {
    const product = productById.get(variant.product_id);
    if (!product || !activeStores.has(variant.store_id) || seenStores.has(variant.store_id)) continue;
    seenStores.add(variant.store_id);
    entries.push({ product, variant });
  }
  if (entries.length === 0) return { library: { barcode, found: false, suggestion: null } };

  const categoryIds = [...new Set(entries.map((e) => e.product.category_id).filter(Boolean))];
  const [theirCategories, ownCategories] = await Promise.all([
    categoryIds.length ? supabaseAdmin.from('categories').select('id, name').in('id', categoryIds) : { data: [] },
    supabaseAdmin.from('categories').select('id, name').eq('store_id', store.id),
  ]);
  fail(theirCategories.error, 'Could not search the product library.');
  fail(ownCategories.error, 'Could not search the product library.');
  const categoryName = new Map((theirCategories.data ?? []).map((c) => [c.id, c.name]));

  const name = majority(entries.map((e) => e.product.name), norm);
  const option = majority(entries.map((e) => (e.variant.name === 'Default' ? null : e.variant.name)), norm);
  const category = majority(entries.map((e) => categoryName.get(e.product.category_id)), norm);
  const ownCategory = category ? (ownCategories.data ?? []).find((c) => norm(c.name) === norm(category.value)) : null;

  return {
    library: {
      barcode,
      found: true,
      shops: entries.length,
      agreeing: name.count,
      suggestion: {
        name: name.value.trim(),
        optionName: option?.value.trim() ?? null,
        unit: majority(entries.map((e) => e.product.unit))?.value ?? null,
        taxPercent: majority(entries.map((e) => e.product.tax_percent))?.value ?? null,
        mrpPaise: majority(entries.map((e) => e.variant.mrp_paise))?.value ?? null,
        weightGrams: majority(entries.map((e) => e.variant.weight_grams))?.value ?? null,
        category: category ? { name: category.value, id: ownCategory?.id ?? null } : null,
      },
      note: 'From the CPSE product library — what other shops entered for this barcode. Check it, then add your own price and stock.',
    },
  };
}
