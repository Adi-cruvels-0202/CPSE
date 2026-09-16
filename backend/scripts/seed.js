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
import { stores, flattenSeed, testCustomer, khataSeed } from './seed-data.js';

async function upsert(table, rows) {
  if (rows.length === 0) return;
  const { error } = await supabaseAdmin.from(table).upsert(rows, { onConflict: 'id' });
  if (error) throw new Error(`${table}: ${error.message}`);
  console.log(`  ${table.padEnd(18)} ${rows.length} rows`);
}

/**
 * Creates the test customer if missing, otherwise reuses it. The customers row
 * itself comes from the on_auth_user_created trigger (migration 0003), so this
 * only touches auth.
 */
async function ensureTestCustomer() {
  const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
    email: testCustomer.email,
    password: testCustomer.password,
    email_confirm: true,
    user_metadata: { full_name: testCustomer.full_name, phone: testCustomer.phone },
  });

  if (!error) {
    console.log(`  auth user          created ${testCustomer.email}`);
    return created.user.id;
  }

  // Already seeded on a previous run — find the existing user instead.
  const alreadyExists = error.status === 422 || /already been registered|already exists/i.test(error.message);
  if (!alreadyExists) throw new Error(`auth: ${error.message}`);

  const { data: list, error: listError } = await supabaseAdmin.auth.admin.listUsers({ perPage: 200 });
  if (listError) throw new Error(`auth: ${listError.message}`);

  const existing = list.users.find((user) => user.email?.toLowerCase() === testCustomer.email);
  if (!existing) throw new Error(`auth: ${testCustomer.email} exists but could not be located`);

  console.log(`  auth user          reused ${testCustomer.email}`);
  return existing.id;
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
  await upsert('stores', storeRows);
  await upsert('categories', categoryRows);
  await upsert('products', productRows);
  await upsert('product_images', imageRows);
  await upsert('product_variants', variantRows);

  const customerId = await ensureTestCustomer();
  await seedKhata(customerId);

  const { data: account } = await supabaseAdmin
    .from('khata_accounts')
    .select('balance_paise')
    .eq('id', khataSeed.accountId)
    .single();

  console.log(`\nDone. Test login: ${testCustomer.email} / ${testCustomer.password}`);
  console.log(`Khata balance: ${account?.balance_paise ?? '?'} paise owed.`);
}

seed().catch((error) => {
  console.error(`\nSeed failed: ${error.message}`);
  process.exit(1);
});
