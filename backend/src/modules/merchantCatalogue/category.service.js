import { supabaseAdmin } from '../../lib/supabase.js';
import { internal, notFound, categoryNameTaken } from '../../lib/errors.js';
import { slugify, firstFreeSlug } from '../../lib/slug.js';

/**
 * A store's categories — MERCHANT_API.md, Categories; MERCHANT_RULES §3.
 * `store` is the caller's own store, loaded by requireStoreOwner.
 *
 * There is no delete: removing a category would silently uncategorise its
 * products (C-5). Deactivating hides it from customers and leaves its products
 * listed under "all" (C-4).
 */

const COLUMNS = 'id, store_id, name, slug, description, sort_order, is_active, created_at, updated_at';
const UNIQUE_VIOLATION = '23505';

export const toMerchantCategory = (row, productCount = 0) => ({
  id: row.id,
  name: row.name,
  slug: row.slug,
  description: row.description ?? null,
  isActive: row.is_active,
  sortOrder: row.sort_order,
  productCount,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

async function storeCategories(storeId) {
  const { data, error } = await supabaseAdmin
    .from('categories')
    .select(COLUMNS)
    .eq('store_id', storeId)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });

  if (error) throw internal('Could not load the categories.');
  return data ?? [];
}

async function productCounts(storeId) {
  const { data, error } = await supabaseAdmin.from('products').select('category_id').eq('store_id', storeId);
  if (error) throw internal('Could not count the products.');

  const counts = new Map();
  for (const { category_id: categoryId } of data ?? []) {
    if (categoryId) counts.set(categoryId, (counts.get(categoryId) ?? 0) + 1);
  }
  return counts;
}

/** A category of this store, or 404 — another store's id is no different from none. */
export async function findStoreCategory(store, categoryId) {
  const { data, error } = await supabaseAdmin
    .from('categories')
    .select(COLUMNS)
    .eq('id', categoryId)
    .eq('store_id', store.id)
    .maybeSingle();

  if (error) throw internal('Could not load the category.');
  if (!data) throw notFound('Category');
  return data;
}

async function withCount(store, row) {
  return toMerchantCategory(row, (await productCounts(store.id)).get(row.id) ?? 0);
}

/** C-2: case-insensitive, so "Dairy" and "dairy" cannot both exist. */
function assertNameFree(categories, name, exceptId = null) {
  const wanted = name.toLowerCase();
  if (categories.some((row) => row.id !== exceptId && row.name.toLowerCase() === wanted)) {
    throw categoryNameTaken(name);
  }
}

/** `GET …/categories` — inactive ones too, in the merchant's order. */
export async function listCategories(store) {
  const [rows, counts] = await Promise.all([storeCategories(store.id), productCounts(store.id)]);
  return rows.map((row) => toMerchantCategory(row, counts.get(row.id) ?? 0));
}

/** `POST …/categories` — added at the end of the order (C-3). */
export async function createCategory(store, { name, description }) {
  const existing = await storeCategories(store.id);
  assertNameFree(existing, name);

  const taken = new Set(existing.map((row) => row.slug));
  const slug = await firstFreeSlug(slugify(name, 'category'), async (candidate) => taken.has(candidate));
  const sortOrder = existing.reduce((max, row) => Math.max(max, row.sort_order), -1) + 1;

  const { data, error } = await supabaseAdmin
    .from('categories')
    .insert({ store_id: store.id, name, slug, description: description ?? null, sort_order: sortOrder })
    .select(COLUMNS)
    .single();

  // Another request created the same name in the meantime.
  if (error?.code === UNIQUE_VIOLATION) throw categoryNameTaken(name);
  if (error) throw internal('Could not create the category.');
  return toMerchantCategory(data, 0);
}

async function writeCategory(store, categoryId, patch) {
  const { data, error } = await supabaseAdmin
    .from('categories')
    .update(patch)
    .eq('id', categoryId)
    .eq('store_id', store.id)
    .select(COLUMNS)
    .single();

  if (error?.code === UNIQUE_VIOLATION && patch.name) throw categoryNameTaken(patch.name);
  if (error) throw internal('Could not update the category.');
  return withCount(store, data);
}

/** `PATCH …/categories/:categoryId`. The slug stays: it is in customer links. */
export async function updateCategory(store, categoryId, { name, description }) {
  await findStoreCategory(store, categoryId);

  const patch = {};
  if (name !== undefined) {
    assertNameFree(await storeCategories(store.id), name, categoryId);
    patch.name = name;
  }
  if (description !== undefined) patch.description = description;

  return writeCategory(store, categoryId, patch);
}

/** `POST …/activate` and `…/deactivate`. */
export async function setCategoryActive(store, categoryId, isActive) {
  await findStoreCategory(store, categoryId);
  return writeCategory(store, categoryId, { is_active: isActive });
}
