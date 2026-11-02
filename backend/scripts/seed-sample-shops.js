/**
 * Adds the repeatable local-development shop catalogue without creating test
 * accounts or touching existing orders. Remote development databases require an
 * explicit one-command opt-in; production is always refused.
 */
import { env } from '../src/config/env.js';
import { supabaseAdmin } from '../src/lib/supabase.js';
import { flattenSeed } from './seed-data.js';
import { sampleShops } from './sample-shops-data.js';

async function upsert(table, rows) {
  if (rows.length === 0) return;
  const { error } = await supabaseAdmin.from(table).upsert(rows, { onConflict: 'id' });
  if (error) throw new Error(`${table}: ${error.message}`);
  console.log(`  ${table.padEnd(18)} ${rows.length} rows`);
}

async function upsertProductsWithoutSlugCollisions(rows) {
  if (rows.length === 0) return;

  const rowById = new Map(rows.map((row) => [row.id, row]));
  const { data: existing, error } = await supabaseAdmin
    .from('products')
    .select('id,store_id,slug')
    .in('id', rows.map((row) => row.id));
  if (error) throw new Error(`products: ${error.message}`);

  const desiredSlugs = new Set(rows.map((row) => `${row.store_id}:${row.slug}`));
  const moving = (existing ?? []).filter((product) => {
    const desired = rowById.get(product.id);
    return desired?.slug !== product.slug
      && desiredSlugs.has(`${product.store_id}:${product.slug}`);
  });

  // A changed catalogue can swap two existing slugs inside one store. Move
  // only the affected sample rows aside before restoring their new slugs.
  for (const product of moving) {
    const temporarySlug = `sample-move-${product.id.slice(-12)}`;
    const { error: moveError } = await supabaseAdmin.from('products')
      .update({ slug: temporarySlug })
      .eq('id', product.id);
    if (moveError) throw new Error(`products: ${moveError.message}`);
  }

  await upsert('products', rows);
}

async function seedSampleShops() {
  if (env.isProduction) throw new Error('Refusing to seed sample shops with NODE_ENV=production.');

  const host = new URL(env.SUPABASE_URL).hostname;
  const local = ['localhost', '127.0.0.1', '::1'].includes(host);
  if (!local && process.env.CPSE_ALLOW_REMOTE_DEV_SEED !== '1') {
    throw new Error('Remote database detected. Set CPSE_ALLOW_REMOTE_DEV_SEED=1 only for the intended development project.');
  }

  const { storeRows, categoryRows, productRows, variantRows } = flattenSeed(sampleShops);
  console.log(`Adding ${storeRows.length} visible sample shops and their orderable catalogues.`);
  await upsert('stores', storeRows);
  await upsert('categories', categoryRows);
  await upsertProductsWithoutSlugCollisions(productRows);
  await upsert('product_variants', variantRows);
  console.log('Sample shop seed complete. Existing orders and accounts were not changed.');
}

seedSampleShops().catch((error) => {
  console.error(`\nSample shop seed failed: ${error.message}`);
  process.exit(1);
});
