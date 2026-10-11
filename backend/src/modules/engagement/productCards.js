import { supabaseAdmin } from '../../lib/supabase.js';
import { internal } from '../../lib/errors.js';
import { toPublicProduct } from '../stores/store.service.js';

/**
 * Products as the customer app shows them in any list — favourites, buy
 * again, recently viewed, recommendations — always from live rows, so a list
 * never shows a stale price or sells something that has gone. Archived
 * products and products of stores no longer visible are left out.
 */
const PRODUCT_COLUMNS = `
  id, store_id, category_id, name, slug, description, price_paise, mrp_paise, tax_percent, unit,
  track_inventory, is_available, archived_at
`;

export async function productCards(productIds) {
  const ids = [...new Set(productIds.filter(Boolean))];
  if (ids.length === 0) return new Map();

  const { data: products, error } = await supabaseAdmin.from('products').select(PRODUCT_COLUMNS).in('id', ids).is('archived_at', null);
  if (error) throw internal('Could not load the products.');
  const rows = products ?? [];
  if (rows.length === 0) return new Map();

  const storeIds = [...new Set(rows.map((row) => row.store_id))];
  const [variants, images, stores] = await Promise.all([
    supabaseAdmin
      .from('product_variants')
      .select('id, product_id, name, price_paise, mrp_paise, quantity_on_hand, reserved_quantity, is_available, sort_order')
      .in('product_id', rows.map((r) => r.id)),
    supabaseAdmin.from('product_images').select('product_id, url, sort_order').in('product_id', rows.map((r) => r.id)).order('sort_order', { ascending: true }),
    supabaseAdmin.from('stores').select('id, slug, name, is_active, is_published').in('id', storeIds),
  ]);
  if (variants.error || images.error || stores.error) throw internal('Could not load the products.');

  const visibleStores = new Map((stores.data ?? []).filter((s) => s.is_active && s.is_published).map((s) => [s.id, s]));
  const variantsByProduct = new Map();
  for (const variant of variants.data ?? []) {
    if (!variantsByProduct.has(variant.product_id)) variantsByProduct.set(variant.product_id, []);
    variantsByProduct.get(variant.product_id).push(variant);
  }
  const imageByProduct = new Map();
  for (const image of images.data ?? []) if (!imageByProduct.has(image.product_id)) imageByProduct.set(image.product_id, image.url);

  const cards = new Map();
  for (const row of rows) {
    const store = visibleStores.get(row.store_id);
    if (!store) continue;
    const productVariants = (variantsByProduct.get(row.id) ?? []).sort((a, b) => a.sort_order - b.sort_order);
    cards.set(row.id, {
      ...toPublicProduct(row, imageByProduct.get(row.id) ?? null, productVariants),
      store: { id: store.id, slug: store.slug, name: store.name },
      // The variant a one-tap "add" would choose: the only one, else none.
      defaultVariantId: productVariants.filter((v) => v.is_available).length === 1 ? productVariants.find((v) => v.is_available).id : null,
    });
  }
  return cards;
}
