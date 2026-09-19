/**
 * Housekeeping the portal itself never does — checklist 10.6.
 *
 *   npm run db:maintenance             expire stale unpaid orders, purge dead carts
 *   npm run db:maintenance -- --dry    report what would happen, change nothing
 *
 * Both steps are idempotent and safe to re-run, so this is a cron job's whole
 * body. They run through supabase-js with the service-role key; the functions
 * they call (migration 0022) are granted to service_role only, because
 * cancelling someone's order is an operator action.
 *
 * Refuses nothing in production: this is exactly where it belongs. What it will
 * not do is touch an order that has been paid for — `expire_stale_pending_orders`
 * only ever reads 'pending_payment'.
 */
import { supabaseAdmin } from '../src/lib/supabase.js';
import { env } from '../src/config/env.js';

const PENDING_ORDER_TTL = process.env.PENDING_ORDER_TTL ?? '2 hours';
const CART_TTL = process.env.ABANDONED_CART_TTL ?? '90 days';

const rupees = (paise) => `₹${(paise / 100).toFixed(2)}`;

async function expireStaleOrders({ dryRun }) {
  if (dryRun) {
    const { data, error } = await supabaseAdmin
      .from('orders')
      .select('id, order_number, total_paise, placed_at')
      .eq('status', 'pending_payment')
      .order('placed_at', { ascending: true });

    if (error) throw new Error(`Could not list pending orders: ${error.message}`);

    // The cutoff is applied here rather than in the query so the dry run needs
    // no interval arithmetic in PostgREST.
    console.log(`  ${data?.length ?? 0} order(s) sitting in pending_payment:`);
    for (const order of data ?? []) {
      console.log(`    ${order.order_number}  ${rupees(order.total_paise)}  placed ${order.placed_at}`);
    }
    console.log(`  (anything older than ${PENDING_ORDER_TTL} would be cancelled and its stock returned)`);
    return;
  }

  const { data, error } = await supabaseAdmin.rpc('expire_stale_pending_orders', {
    p_older_than: PENDING_ORDER_TTL,
  });

  if (error) throw new Error(`Could not expire stale orders: ${error.message}`);

  const expired = data ?? [];
  console.log(`  expired ${expired.length} unpaid order(s)`);
  for (const order of expired) {
    console.log(`    ${order.order_number}  ${rupees(order.total_paise)}  stock returned`);
  }
}

async function purgeCarts({ dryRun }) {
  if (dryRun) {
    const { count, error } = await supabaseAdmin
      .from('carts')
      .select('id', { count: 'exact', head: true })
      .is('checked_out_at', null);

    if (error) throw new Error(`Could not count carts: ${error.message}`);
    console.log(`  ${count ?? 0} open cart(s); those untouched for ${CART_TTL} would be removed`);
    return;
  }

  const { data, error } = await supabaseAdmin.rpc('purge_abandoned_carts', {
    p_older_than: CART_TTL,
  });

  if (error) throw new Error(`Could not purge carts: ${error.message}`);
  console.log(`  removed ${data ?? 0} abandoned cart(s)`);
}

async function main() {
  const dryRun = process.argv.includes('--dry') || process.argv.includes('--dry-run');

  console.log(`Maintenance${dryRun ? ' (dry run)' : ''} against ${env.SUPABASE_URL}`);
  console.log('Stale unpaid orders');
  await expireStaleOrders({ dryRun });
  console.log('Abandoned carts');
  await purgeCarts({ dryRun });
  console.log(dryRun ? 'Dry run complete — nothing was changed.' : 'Done.');
}

main().catch((error) => {
  console.error(`\nMaintenance failed: ${error.message}`);
  process.exit(1);
});
