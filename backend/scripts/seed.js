/**
 * Seeds the dummy merchant catalogue and one test customer's khata.
 * Checklist 1.21 and 1.22.
 *
 *   npm run db:seed
 *
 * Runs through supabase-js with the service-role key, so it needs no direct
 * Postgres connection. Safe to re-run: every row has a fixed id and is upserted.
 *
 * Refuses to run against NODE_ENV=production — this is dummy data.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { supabaseAdmin } from '../src/lib/supabase.js';
import { env } from '../src/config/env.js';
import { IMAGE_BUCKET, sniffImageType } from '../src/lib/imageUpload.js';
import {
  stores,
  flattenSeed,
  testCustomer,
  demoMerchant,
  khataSeed,
  CATALOGUE_PHOTOS_DIR,
  photoSlug,
  applyPhotos,
} from './seed-data.js';

async function upsert(table, rows) {
  if (rows.length === 0) return;
  const { error } = await supabaseAdmin.from(table).upsert(rows, { onConflict: 'id' });
  if (error) throw new Error(`${table}: ${error.message}`);
  console.log(`  ${table.padEnd(18)} ${rows.length} rows`);
}

/**
 * A Default variant that migration 0030 already created on this database has a
 * random id. Upserting the seed's fixed id beside it would add a second
 * 'Default' to the product and trip the unique variant name, so the existing
 * row's id is reused instead.
 */
async function adoptExistingDefaultVariants(variantRows) {
  const defaults = variantRows.filter((row) => row.name === 'Default');
  if (defaults.length === 0) return variantRows;

  const { data, error } = await supabaseAdmin
    .from('product_variants')
    .select('id, product_id')
    .eq('name', 'Default')
    .in('product_id', defaults.map((row) => row.product_id));
  if (error) throw new Error(`product_variants: ${error.message}`);

  const existing = new Map((data ?? []).map((row) => [row.product_id, row.id]));
  return variantRows.map((row) =>
    row.name === 'Default' && existing.has(row.product_id) ? { ...row, id: existing.get(row.product_id) } : row,
  );
}

/**
 * Uploads the photos in `backend/catlog photos/` to Supabase Storage and
 * answers product id → public URL. Optional: no folder, no bucket (migration
 * 0033 not applied yet) or a failed upload just leaves the placeholders.
 */
async function uploadCataloguePhotos(productRows) {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', CATALOGUE_PHOTOS_DIR);
  let files;
  try {
    files = await fs.readdir(dir);
  } catch {
    console.log(`  photos             none (no "${CATALOGUE_PHOTOS_DIR}" folder)`);
    return new Map();
  }

  const bySlug = new Map(productRows.map((product) => [product.slug, product]));
  const urls = new Map();

  for (const file of files.sort()) {
    const product = bySlug.get(photoSlug(file));
    if (!product) continue;

    const buffer = await fs.readFile(path.join(dir, file));
    const type = sniffImageType(buffer);
    if (!type) {
      console.warn(`  photos             skipped ${file}: not a JPEG, PNG or WebP`);
      continue;
    }

    // A fixed path per product, overwritten on re-seed, so seeding twice does
    // not leave orphaned copies behind.
    const objectPath = `seed/${product.slug}.${type.ext}`;
    const { error } = await supabaseAdmin.storage
      .from(IMAGE_BUCKET)
      .upload(objectPath, buffer, { contentType: type.mime, upsert: true, cacheControl: '3600' });
    if (error) {
      console.warn(`  photos             skipped ${file}: ${error.message} (is migration 0033 applied?)`);
      continue;
    }
    urls.set(product.id, supabaseAdmin.storage.from(IMAGE_BUCKET).getPublicUrl(objectPath).data.publicUrl);
  }

  console.log(`  photos             ${urls.size} uploaded`);
  return urls;
}

/** Removes a photographed product's other placeholder images left by earlier seeds. */
async function dropReplacedImages(imageRows, photoUrls) {
  for (const productId of photoUrls.keys()) {
    const keep = imageRows.filter((row) => row.product_id === productId).map((row) => row.id);
    const { error } = await supabaseAdmin
      .from('product_images')
      .delete()
      .eq('product_id', productId)
      .not('id', 'in', `(${keep.join(',')})`);
    if (error) throw new Error(`product_images: ${error.message}`);
  }
}

/**
 * Creates the test customer if missing, otherwise reuses it. The customers row
 * itself comes from the on_auth_user_created trigger (migration 0003), so this
 * only touches auth.
 */
async function ensureAuthUser(account) {
  const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
    email: account.email,
    password: account.password,
    email_confirm: true,
    user_metadata: { full_name: account.full_name, phone: account.phone },
  });

  if (!error) {
    console.log(`  auth user          created ${account.email}`);
    return created.user.id;
  }

  // Already seeded on a previous run — find the existing user instead.
  const alreadyExists = error.status === 422 || /already been registered|already exists/i.test(error.message);
  if (!alreadyExists) throw new Error(`auth: ${error.message}`);

  const { data: list, error: listError } = await supabaseAdmin.auth.admin.listUsers({ perPage: 200 });
  if (listError) throw new Error(`auth: ${listError.message}`);

  const existing = list.users.find((user) => user.email?.toLowerCase() === account.email);
  if (!existing) throw new Error(`auth: ${account.email} exists but could not be located`);

  console.log(`  auth user          reused ${account.email}`);
  return existing.id;
}

const ensureTestCustomer = () => ensureAuthUser(testCustomer);

/**
 * The demo shopkeeper: an auth user (the signup trigger gives them a customers
 * row) plus the merchants row that makes them a merchant (D-2).
 */
async function ensureDemoMerchant() {
  const id = await ensureAuthUser(demoMerchant);
  await upsert('merchants', [
    { id, email: demoMerchant.email, full_name: demoMerchant.full_name, phone: demoMerchant.phone },
  ]);
  return id;
}

async function seedKhata(customerId) {
  await upsert('khata_accounts', [
    { id: khataSeed.accountId, customer_id: customerId, store_id: khataSeed.storeId },
  ]);

  // Clear first: the balance is maintained by a trigger, and deleting the old
  // rows unwinds their effect, so re-seeding cannot double the balance.
  const { error: clearError } = await supabaseAdmin
    .from('khata_transactions')
    .delete()
    .eq('account_id', khataSeed.accountId);
  if (clearError) throw new Error(`khata_transactions: ${clearError.message}`);

  const { error } = await supabaseAdmin
    .from('khata_transactions')
    .insert(khataSeed.transactions.map((txn) => ({ ...txn, account_id: khataSeed.accountId })));
  if (error) throw new Error(`khata_transactions: ${error.message}`);
  console.log(`  khata_transactions ${khataSeed.transactions.length} rows`);
}

async function seed() {
  if (env.isProduction) {
    throw new Error('Refusing to seed dummy data with NODE_ENV=production.');
  }

  const { storeRows, categoryRows, productRows, imageRows, variantRows } = flattenSeed(stores);

  console.log(`Seeding ${env.SUPABASE_URL}`);
  // First, so the seeded stores can name their owner (stores.owner_id → merchants).
  const merchantId = await ensureDemoMerchant();
  await upsert('stores', storeRows.map((store) => ({ ...store, owner_id: merchantId })));
  await upsert('categories', categoryRows);
  await upsert('products', productRows);
  const photoUrls = await uploadCataloguePhotos(productRows);
  const images = applyPhotos(imageRows, photoUrls);
  await dropReplacedImages(images, photoUrls);
  await upsert('product_images', images);
  // Stock is reset to the seed's numbers; reserved_quantity is left alone, so
  // a re-seed never forgets what open orders hold.
  await upsert('product_variants', await adoptExistingDefaultVariants(variantRows));

  const customerId = await ensureTestCustomer();
  await seedKhata(customerId);

  const { data: account } = await supabaseAdmin
    .from('khata_accounts')
    .select('balance_paise')
    .eq('id', khataSeed.accountId)
    .single();

  console.log(`\nDone. Test login: ${testCustomer.email} / ${testCustomer.password}`);
  console.log(`Merchant login: ${demoMerchant.email} / ${demoMerchant.password} (owns every seeded store)`);
  console.log(`Khata balance: ${account?.balance_paise ?? '?'} paise owed.`);
}

seed().catch((error) => {
  console.error(`\nSeed failed: ${error.message}`);
  process.exit(1);
});
