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
import { supabaseAdmin } from '../src/lib/supabase.js';
import { env } from '../src/config/env.js';
import { stores, flattenSeed, testCustomer, demoMerchant, khataSeed } from './seed-data.js';

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
  await upsert('product_images', imageRows);
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
