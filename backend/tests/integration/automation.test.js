/**
 * Analytics, automation and purchase suggestions against real Postgres.
 * Roadmap §4 P4 (analytics reproducible from transactions, no double
 * counting), Phase C (low-stock and expiry alerts, recurring operations,
 * suggested purchase lists, notification delivery), §5 P4 reorder reminders.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../src/lib/supabase.js', async () => {
  const { createPgSupabase } = await import('../helpers/pgSupabase.js');
  return createPgSupabase();
});

const { resetDatabase, sql } = await import('../helpers/pgSupabase.js');
const automation = await import('../../src/modules/automation/automation.service.js');
const { runJob, runAllJobs, runDeliveries, JOBS } = await import('../../src/jobs/index.js');
const flow = await import('./flow.js');
const { call, expectStatus } = flow;

beforeEach(async () => {
  await resetDatabase();
});

const base = (shop) => `/merchant/stores/${shop.store.id}`;

async function shopWithStock() {
  const shop = await flow.openShop();
  await flow.publish(shop);
  const rice = await flow.addRice(shop, { stock1kg: 40, stock500g: 40, taxPercent: 5 });
  const dal = await flow.addSimpleProduct(shop, { name: 'Toor Dal', pricePaise: 15000, stock: 10 });
  return { shop, rice, dal };
}

async function completedOrder(shop, customer, lines, body = {}) {
  for (const [productId, variantId, qty] of lines) await flow.addToCart(customer, shop.store.id, productId, variantId, qty);
  const { order } = expectStatus(await flow.placeOrder(customer, { storeId: shop.store.id, ...body }), 201);
  await flow.fulfil(shop, order.id);
  return order;
}

describe('analytics', () => {
  it('matches an independent calculation from the source rows, and never counts a cancelled order', async () => {
    const { shop, rice, dal } = await shopWithStock();
    const a = await flow.newCustomer('A');
    const b = await flow.newCustomer('B');

    const o1 = await completedOrder(shop, a, [[rice.product.id, rice.kg.id, 2]]);
    const o2 = await completedOrder(shop, b, [[dal.product.id, dal.variant.id, 1], [rice.product.id, rice.halfKg.id, 1]]);
    await completedOrder(shop, a, [[rice.product.id, rice.kg.id, 1]]);

    // A paid online order that is then cancelled: refunded, never a sale.
    await flow.addToCart(b, shop.store.id, rice.product.id, rice.kg.id, 3);
    const { order: cancelled } = expectStatus(await flow.placeOrder(b, { storeId: shop.store.id, paymentMethod: 'online' }), 201);
    await flow.payOnline(b, cancelled.id);
    expectStatus(await call('post', `/orders/${cancelled.id}/cancel`, b.auth, {}), 200);
    await sql(`select record_refund_update(jsonb_build_object('refund_id', id, 'to_status', 'refunded', 'source', 'system')) from refunds`);

    // A counter sale.
    expectStatus(
      await call('post', `${base(shop)}/sales`, shop.merchant, { items: [{ variantId: dal.variant.id, quantity: 2 }], paymentMethod: 'cash' }, { 'Idempotency-Key': 'pos-1' }),
      201,
    );

    const { analytics } = expectStatus(await call('get', `${base(shop)}/analytics`, shop.merchant), 200);

    // Independent figures straight from the tables.
    const [expected] = await sql(`
      select
        (select coalesce(sum(total_paise), 0)::int from orders where status = 'completed') as orders_revenue,
        (select coalesce(sum(total_paise), 0)::int from sales) as pos_revenue,
        (select count(*)::int from orders where status = 'completed') as completed,
        (select coalesce(sum(amount_paise), 0)::int from refunds where status = 'refunded') as refunds`);
    expect(analytics.sales).toMatchObject({
      ordersRevenuePaise: expected.orders_revenue,
      counterSalesPaise: expected.pos_revenue,
      grossSalesPaise: expected.orders_revenue + expected.pos_revenue,
      completedOrders: 3,
      counterSales: 1,
      refundsPaise: expected.refunds,
    });
    expect(expected.refunds).toBe(cancelled.totalPaise);
    expect(analytics.sales.trend.reduce((sum, d) => sum + d.ordersPaise + d.posPaise, 0)).toBe(analytics.sales.grossSalesPaise);
    expect(analytics.orders.byStatus).toMatchObject({ completed: 3, cancelled: 1 });
    expect(analytics.orders.cancellationRate).toBeCloseTo(0.25, 3);

    // Best sellers by units: rice 1 kg = 3 (2 + 1), dal = 1 + 2 = 3, 500 g = 1.
    const rice1 = analytics.products.bestSellers.find((p) => p.productId === rice.product.id);
    expect(rice1.units).toBe(4);
    expect(rice1.revenuePaise).toBe(3 * 12000 + 6500);
    expect(analytics.products.bestSellers.find((p) => p.productId === dal.product.id).units).toBe(3);

    expect(analytics.customers).toMatchObject({ buyersInPeriod: 2, newInPeriod: 2, returningInPeriod: 0 });
    expect(o1.id && o2.id).toBeTruthy();
    expect(analytics.definitions.refunds).toMatch(/not subtracted/);
  });

  it('lists unavailable and slow-moving products, and reports khata exposure from the ledger', async () => {
    const { shop, rice, dal } = await shopWithStock();
    expectStatus(await call('post', `${base(shop)}/inventory/stock-out`, shop.merchant, { variantId: dal.variant.id, quantity: 10, reason: 'damaged' }), 200);
    const customer = await flow.newCustomer();
    const [{ email }] = await sql('select email from customers where id = $1', [customer.id]);
    const { account } = expectStatus(await call('post', `${base(shop)}/khata`, shop.merchant, { email }), 201);
    const entry = (body) => call('post', `${base(shop)}/khata/${account.id}/entries`, shop.merchant, body);
    expectStatus(await entry({ kind: 'charge', amountPaise: 50000, dueDate: '2020-01-01' }), 201);
    expectStatus(await entry({ kind: 'payment', amountPaise: 20000, paymentMethod: 'cash' }), 201);

    const { analytics } = expectStatus(await call('get', `${base(shop)}/analytics`, shop.merchant), 200);
    expect(analytics.products.unavailable.map((p) => p.productId)).toEqual([dal.product.id]);
    expect(analytics.products.slowMovers.map((p) => p.productId)).toContain(rice.product.id);
    expect(analytics.khata).toMatchObject({ outstandingPaise: 30000, overduePaise: 30000, collectedPaise: 20000, chargedPaise: 50000, accountsOverdue: 1 });
  });

  it('validates the period and keeps another merchant out', async () => {
    const { shop } = await shopWithStock();
    expect((await call('get', `${base(shop)}/analytics?from=2026-05-02&to=2026-05-01`, shop.merchant)).body.error.code).toBe('PERIOD_INVALID');
    expect((await call('get', `${base(shop)}/analytics?from=2020-01-01&to=2026-01-01`, shop.merchant)).body.error.code).toBe('PERIOD_TOO_LONG');
    const other = await flow.openShop({ name: 'Other' });
    expect((await call('get', `${base(shop)}/analytics`, other.merchant)).status).toBe(404);
  });
});

describe('purchase suggestions', () => {
  it('suggests restocking from the selling rate and alert level, explains why, and becomes a draft purchase only', async () => {
    const { shop, rice, dal } = await shopWithStock();
    expectStatus(await call('patch', `${base(shop)}/products/${dal.product.id}`, shop.merchant, { lowStockThreshold: 5 }), 200);
    const customer = await flow.newCustomer();
    await completedOrder(shop, customer, [[dal.product.id, dal.variant.id, 8]]);

    const { suggestions } = expectStatus(await call('get', `${base(shop)}/purchase-suggestions?coverDays=30&lookbackDays=30`, shop.merchant), 200);
    const line = suggestions.suggestions.find((s) => s.variantId === dal.variant.id);
    // 8 sold in 30 days → 30 days of cover = 8; at least threshold + 1 = 6; 2 available → 6.
    expect(line).toMatchObject({ available: 2, soldLastPeriod: 8, suggestedQuantity: 6 });
    expect(line.reason).toMatch(/Sold 8 in 30 days/);
    expect(suggestions.suggestions.find((s) => s.variantId === rice.kg.id)).toBeUndefined();

    const { purchase } = expectStatus(
      await call('post', `${base(shop)}/purchase-suggestions/draft`, shop.merchant, { items: [{ variantId: dal.variant.id, quantity: 6, unitCostPaise: 11000 }] }),
      201,
    );
    expect(purchase.status).toBe('draft');
    expect((await sql('select quantity_on_hand from product_variants where id = $1', [dal.variant.id]))[0].quantity_on_hand).toBe(2);

    // What is on a draft purchase is counted as coming.
    const again = expectStatus(await call('get', `${base(shop)}/purchase-suggestions?coverDays=30&lookbackDays=30`, shop.merchant), 200).suggestions;
    expect(again.suggestions.find((s) => s.variantId === dal.variant.id)).toBeUndefined();
  });
});

describe('alerts and recurring tasks', () => {
  it('raises one low-stock alert per variant per day, however often the job runs', async () => {
    const { shop, dal } = await shopWithStock();
    expectStatus(await call('patch', `${base(shop)}/products/${dal.product.id}`, shop.merchant, { lowStockThreshold: 10 }), 200);
    expect((await automation.runLowStockAlerts()).alerts).toBe(1);
    expect((await automation.runLowStockAlerts()).alerts).toBe(0);
    const low = expectStatus(await call('get', `${base(shop)}/low-stock`, shop.merchant), 200).items;
    expect(low).toEqual([expect.objectContaining({ productId: dal.product.id, availableQuantity: 10, lowStockThreshold: 10 })]);
    const inbox = expectStatus(await call('get', `${base(shop)}/notifications`, shop.merchant), 200).notifications;
    expect(inbox.filter((n) => n.type === 'low_stock')).toHaveLength(1);
  });

  it('alerts once for an expiring batch and once when it has expired', async () => {
    const { shop, rice } = await shopWithStock();
    const soon = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    expectStatus(await call('post', `${base(shop)}/inventory/stock-in`, shop.merchant, { variantId: rice.kg.id, quantity: 5, batchNumber: 'S1', expiresOn: soon }), 200);
    expectStatus(await call('post', `${base(shop)}/inventory/stock-in`, shop.merchant, { variantId: rice.kg.id, quantity: 5, batchNumber: 'E1', expiresOn: '2020-01-01' }), 200);
    expect((await automation.runExpiryAlerts()).alerts).toBe(2);
    expect((await automation.runExpiryAlerts()).alerts).toBe(0);
    const types = (await sql(`select type from merchant_notifications where type like 'batch_%' order by type`)).map((r) => r.type);
    expect(types).toEqual(['batch_expired', 'batch_expiring']);
  });

  it('runs a due recurring task once, posts its report and schedules the next run in store time', async () => {
    const { shop, dal } = await shopWithStock();
    expectStatus(await call('patch', `${base(shop)}/products/${dal.product.id}`, shop.merchant, { lowStockThreshold: 20 }), 200);
    const { task } = expectStatus(
      await call('post', `${base(shop)}/tasks`, shop.merchant, { title: 'Morning stock check', taskType: 'low_stock_report', frequency: 'daily', timeOfDay: '08:30' }),
      201,
    );
    expect(new Date(task.nextRunAt) > new Date()).toBe(true);
    expect((await call('post', `${base(shop)}/tasks`, shop.merchant, { title: 'x', taskType: 'reminder', frequency: 'weekly' })).status).toBe(422);

    const due = new Date(new Date(task.nextRunAt).getTime() + 1000);
    expect((await automation.runRecurringTasks({ now: due })).ran).toBe(1);
    expect((await automation.runRecurringTasks({ now: due })).ran).toBe(0);
    const [note] = await sql(`select title, body from merchant_notifications where type = 'recurring_task'`);
    expect(note.title).toBe('Morning stock check');
    expect(note.body).toMatch(/Toor Dal/);
    const [row] = await sql('select next_run_at from recurring_tasks');
    expect(new Date(row.next_run_at).getTime() - new Date(task.nextRunAt).getTime()).toBe(86_400_000);
  });

  it('computes weekly and monthly next runs in the store timezone', () => {
    const after = new Date('2026-10-14T12:00:00Z'); // a Wednesday
    const weekly = automation.nextRunAfter({ frequency: 'weekly', day_of_week: 1, time_of_day: '09:00' }, 'Asia/Kolkata', after);
    expect(weekly.toISOString()).toBe('2026-10-19T03:30:00.000Z'); // Monday 09:00 IST
    const monthly = automation.nextRunAfter({ frequency: 'monthly', day_of_month: 1, time_of_day: '07:00' }, 'Asia/Kolkata', after);
    expect(monthly.toISOString()).toBe('2026-11-01T01:30:00.000Z');
  });
});

describe('reminders and points expiry', () => {
  it('reminds a customer once when a routine purchase is due, unless they turned reminders off', async () => {
    const { shop, rice } = await shopWithStock();
    const customer = await flow.newCustomer();
    for (let i = 0; i < 3; i += 1) await completedOrder(shop, customer, [[rice.product.id, rice.kg.id, 1]]);
    // Spread the three purchases seven days apart, the last 8 days ago.
    await sql(`update orders set completed_at = now() - make_interval(days => (8 + 7 * (rn - 1))::int)
               from (select id, row_number() over (order by completed_at desc) as rn from orders) r where r.id = orders.id`);

    expect((await automation.runReorderReminders()).sent).toBe(1);
    expect((await automation.runReorderReminders()).sent).toBe(0);
    const [note] = await sql(`select title from notifications where type = 'reorder_reminder'`);
    expect(note.title).toMatch(/Basmati Rice/);

    await sql('delete from customer_reminders');
    expectStatus(await call('put', `/stores/${shop.store.id}/preferences`, customer.auth, { allowReminders: false }), 200);
    expect((await automation.runReorderReminders()).sent).toBe(0);
  });

  it('expires points earned before the expiry period that were never spent, once', async () => {
    const { shop } = await shopWithStock();
    const customer = await flow.newCustomer();
    expectStatus(await call('put', `${base(shop)}/loyalty`, shop.merchant, { isActive: true, pointsExpireDays: 30 }), 200);
    await sql(`select post_loyalty_points($1, $2, 'adjust', 100)`, [shop.store.id, customer.id]);
    await sql(`select post_loyalty_points($1, $2, 'redeem', -30)`, [shop.store.id, customer.id]);
    const later = new Date(Date.now() + 40 * 86_400_000);
    expect((await automation.runPointsExpiry({ now: later })).expired).toBe(70);
    expect((await automation.runPointsExpiry({ now: later })).expired).toBe(0);
    expect((await sql('select current_points from loyalty_accounts'))[0].current_points).toBe(0);
  });
});

describe('the job runner', () => {
  it('runs every job, logs each run, and lets one holder run a job at a time', async () => {
    await flow.openShop();
    const results = await runAllJobs();
    expect(Object.keys(results)).toEqual(JOBS.map((j) => j.name));
    expect(Object.values(results).every((r) => r && !r.error)).toBe(true);
    expect(await sql(`select count(*)::int as n from job_runs where status = 'succeeded'`)).toEqual([{ n: JOBS.length }]);

    const job = JOBS.find((j) => j.name === 'low-stock-alerts');
    await sql(`insert into job_leases (job, holder, lease_until) values ('low-stock-alerts', 'someone-else', now() + interval '1 hour')`);
    expect(await runJob(job)).toBeNull();
  });

  it('records a failing job as failed instead of crashing the scheduler', async () => {
    const summary = await runJob({ name: 'boom', everySeconds: 60, run: async () => { throw new Error('kaboom'); } }, { force: true });
    expect(summary).toEqual({ error: 'kaboom' });
    expect(await sql(`select status, error from job_runs where job = 'boom'`)).toEqual([{ status: 'failed', error: 'kaboom' }]);
  });

  it('tracks notification delivery honestly: in-app delivered, opted-in channels skipped without a provider', async () => {
    const { shop, rice } = await shopWithStock();
    const customer = await flow.newCustomer();
    expectStatus(await call('put', `/stores/${shop.store.id}/preferences`, customer.auth, { allowSms: true }), 200);
    await completedOrder(shop, customer, [[rice.product.id, rice.kg.id, 1]]);

    const [{ id }] = await sql(`select id from notifications where customer_id = $1 order by created_at limit 1`, [customer.id]);
    let deliveries = expectStatus(await call('get', `/notifications/${id}/deliveries`, customer.auth), 200).deliveries;
    expect(deliveries.map((d) => [d.channel, d.status]).sort()).toEqual([['in_app', 'delivered'], ['sms', 'pending']]);

    await runDeliveries();
    deliveries = expectStatus(await call('get', `/notifications/${id}/deliveries`, customer.auth), 200).deliveries;
    expect(deliveries.find((d) => d.channel === 'sms')).toMatchObject({ status: 'skipped', lastError: 'No sms provider is configured.' });

    const other = await flow.newCustomer('Other');
    expect((await call('get', `/notifications/${id}/deliveries`, other.auth)).status).toBe(404);
  });
});
