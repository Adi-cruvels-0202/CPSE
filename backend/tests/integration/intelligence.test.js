/**
 * The intelligence phase (roadmap §4 Phase D/E, §5 P6) against real Postgres:
 * forecasts and stock health, catalogue suggestions, invoice reading,
 * commands and the assistants, privacy-safe area benchmarks, and the
 * customer's search, basket, recommendations, alternatives, replenishment and
 * discovery. And the rule over all of it (E-06, C-74): nothing here writes.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../src/lib/supabase.js', async () => {
  const { createPgSupabase } = await import('../helpers/pgSupabase.js');
  return createPgSupabase();
});

const { resetDatabase, sql } = await import('../helpers/pgSupabase.js');
const flow = await import('./flow.js');
const { call, expectStatus } = flow;

beforeEach(async () => {
  await resetDatabase();
});

const base = (shop) => `/merchant/stores/${shop.store.id}`;

async function liveShop(options) {
  const shop = await flow.openShop(options);
  await flow.publish(shop);
  return shop;
}

/** Backdated counter-sale history, as the ledger would hold it. */
async function sellHistory(shop, product, variant, days, perDay) {
  for (let i = 1; i <= days; i += 1) {
    await sql(
      `insert into inventory_ledger (store_id, product_id, variant_id, movement_type, on_hand_change, reserved_change, on_hand_after, reserved_after, performed_by_type, created_at)
       values ($1, $2, $3, 'sale', $4, 0, 100, 0, 'system', now() - make_interval(days => $5::int))`,
      [shop.store.id, product.id, variant.id, -perDay, i],
    );
  }
}

/** Every table a proposal could touch, to prove a call changed nothing. */
async function writableCounts() {
  const [row] = await sql(`select
    (select count(*)::int from inventory_ledger) as ledger, (select count(*)::int from cart_items) as cart,
    (select count(*)::int from orders) as orders, (select count(*)::int from purchases) as purchases,
    (select coalesce(sum(price_paise), 0)::int from product_variants) as prices,
    (select count(*)::int from products where is_available) as visible`);
  return row;
}

// ── Merchant ────────────────────────────────────────────────────────────────

describe('demand forecast and stock health (Phase D)', () => {
  it('forecasts from sales history, flags the risk, and refuses to guess without data', async () => {
    const shop = await liveShop();
    const rice = await flow.addRice(shop, { stock1kg: 6, stock500g: 40 });
    await sql(`update products set created_at = now() - interval '40 days' where id = $1`, [rice.product.id]);
    await sellHistory(shop, rice.product, rice.kg, 30, 2);

    const { stock } = expectStatus(await call('get', `${base(shop)}/intelligence/stock`, shop.merchant), 200);
    const kg = stock.items.find((i) => i.variantId === rice.kg.id);
    expect(kg.forecast).toMatchObject({ confidence: 'medium', dailyAverage: 2, nextDaysUnits: 28 });
    expect(kg.health).toMatchObject({ status: 'at_risk', daysOfCover: 3 });
    expect(kg.proposedReorderQuantity).toBe(36); // 2/day × (7 + 14) − 6
    const half = stock.items.find((i) => i.variantId === rice.halfKg.id);
    expect(half.forecast.confidence).toBe('insufficient');
    expect(half.health.status).toBe('slow');
    expect(stock.counts).toMatchObject({ at_risk: 1, slow: 1 });
  });

  it('is store-scoped', async () => {
    const shop = await liveShop();
    const other = await flow.openShop({ name: 'Other' });
    expect((await call('get', `${base(shop)}/intelligence/stock`, other.merchant)).status).toBe(404);
    expect((await call('get', `${base(shop)}/intelligence/stock`, null)).status).toBe(401);
  });
});

describe('catalogue suggestions (Phase D)', () => {
  it('suggests a category, unit, size and GST from the store and the templates, and spots duplicates', async () => {
    const shop = await liveShop();
    const { category } = expectStatus(await call('post', `${base(shop)}/categories`, shop.merchant, { name: 'Staples' }), 201);
    expectStatus(await call('post', `${base(shop)}/products`, shop.merchant, { name: 'Basmati Rice', unit: 'kg', taxPercent: 5, categoryId: category.id, variants: [{ name: '1 kg', pricePaise: 12000, openingQuantity: 1 }] }), 201);

    const { suggestion } = expectStatus(await call('post', `${base(shop)}/intelligence/product-suggestions`, shop.merchant, { name: 'Basmati Rice 5kg' }), 200);
    expect(suggestion.suggestions.category).toMatchObject({ id: category.id, name: 'Staples' });
    expect(suggestion.suggestions.unit.value).toBe('kg');
    expect(suggestion.suggestions.weightGrams.value).toBe(5000);
    expect(suggestion.suggestions.taxPercent.value).toBe(5);
    expect(suggestion.duplicates.map((d) => d.name)).toEqual(['Basmati Rice']);

    const fresh = expectStatus(await call('post', `${base(shop)}/intelligence/product-suggestions`, shop.merchant, { name: 'Moong Dal' }), 200).suggestion;
    expect(fresh.suggestions.category).toMatchObject({ id: null, name: 'Dals & Pulses' });
    expect(fresh.suggestions.variants.length).toBeGreaterThan(0);
    expect(fresh.duplicates).toEqual([]);
  });
});

describe('invoice text (Phase D)', () => {
  it('reads lines into proposals matched to the catalogue, and saves nothing', async () => {
    const shop = await liveShop();
    const rice = await flow.addRice(shop);
    await flow.addSimpleProduct(shop, { name: 'Toor Dal', pricePaise: 16500 });
    const before = await writableCounts();

    const text = 'Invoice No: GW-118\nDate: 09/10/2026\nBasmati Rice 1kg 10 x 92\n20 Toor Dal @ 140\nUnicorn Tears 2 x 500\nTotal 3920';
    const { invoice } = expectStatus(await call('post', `${base(shop)}/intelligence/invoice`, shop.merchant, { text }), 200);
    expect(invoice).toMatchObject({ invoiceNumber: 'GW-118', invoiceDate: '2026-10-09', totalMatches: false });
    const [riceLine, dalLine, unknown] = invoice.lines;
    expect(riceLine.match.variantId).toBe(rice.kg.id);
    expect(riceLine.confidence).toBe('high');
    expect(dalLine.match.name).toBe('Toor Dal');
    expect(unknown.match).toBeNull();
    expect(await writableCounts()).toEqual(before);

    const refused = await call('post', `${base(shop)}/intelligence/invoice`, shop.merchant, { text: 'Thank you for your business' });
    expect(refused.status).toBe(422);
    expect(refused.body.error.code).toBe('NOTHING_READ');
  });
});

describe('commands and the merchant assistant (Phase D/E)', () => {
  it('turns an instruction into a proposal that only changes stock once it is applied', async () => {
    const shop = await liveShop();
    const rice = await flow.addRice(shop, { stock1kg: 5 });
    const before = await writableCounts();

    const { command } = expectStatus(await call('post', `${base(shop)}/intelligence/command`, shop.merchant, { text: 'add 10 basmati rice 1 kg' }), 200);
    expect(command.proposal).toMatchObject({ requiresConfirmation: true, apply: { method: 'POST', path: `${base(shop)}/inventory/stock-in`, body: { variantId: rice.kg.id, quantity: 10 } } });
    expect(await writableCounts()).toEqual(before);

    // Confirmed: applied through the ordinary endpoint.
    const { apply } = command.proposal;
    expectStatus(await call(apply.method.toLowerCase(), apply.path, shop.merchant, apply.body), 200);
    const [variant] = await sql('select quantity_on_hand from product_variants where id = $1', [rice.kg.id]);
    expect(variant.quantity_on_hand).toBe(15);
  });

  it('asks which size, says when nothing matches, and checks a price change', async () => {
    const shop = await liveShop();
    const rice = await flow.addRice(shop);
    const ask = (text) => call('post', `${base(shop)}/intelligence/command`, shop.merchant, { text });

    const sizes = expectStatus(await ask('add 5 basmati rice'), 200).command;
    expect(sizes.proposal).toBeNull();
    expect(sizes.options.map((o) => o.variantId).sort()).toEqual([rice.kg.id, rice.halfKg.id].sort());
    expect(expectStatus(await ask('add 5 unicorn tears'), 200).command.problem).toMatch(/No product matches/);
    const price = expectStatus(await ask('set price of basmati rice 500 g to 70'), 200).command;
    expect(price.proposal).toMatchObject({ apply: { method: 'PATCH', body: { pricePaise: 7000 } } });
    expect(price.proposal.summary).toContain('₹65.00');
    expect(expectStatus(await ask('sing me a song'), 200).command.understood).toBe(false);
  });

  it('answers from the store’s own numbers and says where they come from', async () => {
    const shop = await liveShop();
    const rice = await flow.addRice(shop, { stock1kg: 3 });
    const customer = await flow.newCustomer();
    await flow.addToCart(customer, shop.store.id, rice.product.id, rice.kg.id, 2);
    const { order } = expectStatus(await flow.placeOrder(customer, { storeId: shop.store.id }), 201);
    await flow.fulfil(shop, order.id);
    const before = await writableCounts();

    const ask = async (question) => expectStatus(await call('post', `${base(shop)}/intelligence/ask`, shop.merchant, { question }), 200).reply;
    const sales = await ask('How much did I sell this week?');
    expect(sales).toMatchObject({ kind: 'answer', intent: 'sales' });
    expect(sales.answer).toContain('1 online orders');
    expect(sales.source).toMatch(/Reports/);
    const low = await ask('what is running low?');
    expect(low.answer).toContain('Basmati Rice');
    expect((await ask('which orders are waiting?')).intent).toBe('orders');
    expect((await ask('add 4 basmati rice 1 kg')).kind).toBe('proposal');
    expect((await ask('hello there')).kind).toBe('help');
    expect(await writableCounts()).toEqual(before);
  });
});

describe('area benchmarks (Phase E, privacy-safe)', () => {
  it('shows a price spread only from five or more other shops, naming none', async () => {
    const shop = await liveShop({ name: 'Mine' });
    await flow.addRice(shop);
    const prices = [10000, 11000, 12000, 13000];
    for (const [i, pricePaise] of prices.entries()) {
      const other = await liveShop({ name: `Other ${i}` });
      const rice = await flow.addRice(other);
      expectStatus(await call('patch', `${base(other)}/products/${rice.product.id}/variants/${rice.kg.id}`, other.merchant, { pricePaise }), 200);
    }
    const four = expectStatus(await call('get', `${base(shop)}/intelligence/area`, shop.merchant), 200).area;
    expect(four.benchmarks).toEqual([]);
    expect(four.note).toMatch(/Fewer than 5 other shops/);

    const fifth = await liveShop({ name: 'Other 4' });
    const rice5 = await flow.addRice(fifth);
    expectStatus(await call('patch', `${base(fifth)}/products/${rice5.product.id}/variants/${rice5.kg.id}`, fifth.merchant, { pricePaise: 14000 }), 200);
    const area = expectStatus(await call('get', `${base(shop)}/intelligence/area`, shop.merchant), 200).area;
    const kg = area.benchmarks.find((b) => b.name === 'Basmati Rice (1 kg)');
    // Per kg across each shop's packs (its 500 g pack is ₹130/kg), one figure per shop.
    expect(kg).toMatchObject({ basis: 'per_kg', yourPricePaise: 12000, area: { stores: 5, median: 12500 }, position: 'typical' });
    expect(JSON.stringify(area)).not.toMatch(/Other \d/);
  });
});

// ── Customer ────────────────────────────────────────────────────────────────

describe('customer: search, basket, recommendations, alternatives (§5 P6)', () => {
  async function stocked() {
    const shop = await liveShop();
    const rice = await flow.addRice(shop);
    const dal = await flow.addSimpleProduct(shop, { name: 'Toor Dal', pricePaise: 16500 });
    const ghee = await flow.addSimpleProduct(shop, { name: 'Desi Ghee', pricePaise: 60000 });
    return { shop, rice, dal, ghee };
  }

  it('searches in plain words: size, budget and order', async () => {
    const { shop, rice } = await stocked();
    const search = async (q) => expectStatus(await call('get', `/stores/${shop.store.slug}/smart-search?q=${encodeURIComponent(q)}`, null), 200).search;
    const two = await search('2 kg basmati rice under 300');
    expect(two.interpretation).toBe('basmati rice · about 2 kg · under ₹300.00');
    expect(two.results[0]).toMatchObject({ suggestion: { variantId: rice.kg.id, quantity: 2 }, totalPaise: 24000, add: { variantId: rice.kg.id, quantity: 2 } });
    expect((await search('2 kg basmati rice under 200')).results).toEqual([]);
    const cheap = await search('cheapest rice');
    expect(cheap.results[0].suggestion.variantId).toBe(rice.kg.id);
  });

  it('proposes a basket from a list using the usual size, and adds nothing', async () => {
    const { shop, rice, dal } = await stocked();
    const customer = await flow.newCustomer();
    // The customer usually buys the 500 g pack.
    await flow.addToCart(customer, shop.store.id, rice.product.id, rice.halfKg.id, 1);
    const { order } = expectStatus(await flow.placeOrder(customer, { storeId: shop.store.id }), 201);
    await flow.fulfil(shop, order.id);
    const before = await writableCounts();

    const { basket } = expectStatus(await call('post', `/stores/${shop.store.id}/basket/propose`, customer.auth, { text: 'rice, 2 toor dal and unicorn tears' }), 200);
    expect(basket.proposals.map((p) => ({ name: p.product.name, variantId: p.suggestion.variantId, quantity: p.suggestion.quantity }))).toEqual([
      { name: 'Basmati Rice', variantId: rice.halfKg.id, quantity: 1 },
      { name: 'Toor Dal', variantId: dal.variant.id, quantity: 2 },
    ]);
    expect(basket.proposals[0].reason).toBe('The size you usually buy.');
    expect(basket.unmatched.map((u) => u.text)).toEqual(['unicorn tears']);
    expect(basket.estimatePaise).toBe(6500 + 33000);
    expect(await writableCounts()).toEqual(before);
    expect((await call('post', `/stores/${shop.store.id}/basket/propose`, null, { text: 'rice' })).status).toBe(401);
  });

  it('recommends what is bought together, from two or more shared orders', async () => {
    const { shop, rice, dal, ghee } = await stocked();
    for (const name of ['A', 'B']) {
      const customer = await flow.newCustomer(name);
      await flow.addToCart(customer, shop.store.id, rice.product.id, rice.kg.id, 1);
      await flow.addToCart(customer, shop.store.id, dal.product.id, dal.variant.id, 1);
      const { order } = expectStatus(await flow.placeOrder(customer, { storeId: shop.store.id }), 201);
      await flow.fulfil(shop, order.id);
    }
    const once = await flow.newCustomer('C');
    await flow.addToCart(once, shop.store.id, rice.product.id, rice.kg.id, 1);
    await flow.addToCart(once, shop.store.id, ghee.product.id, ghee.variant.id, 1);
    const { order } = expectStatus(await flow.placeOrder(once, { storeId: shop.store.id }), 201);
    await flow.fulfil(shop, order.id);

    const { recommendations } = expectStatus(await call('get', `/stores/${shop.store.slug}/products/${rice.product.id}/recommendations`, null), 200);
    expect(recommendations.items[0]).toMatchObject({ product: { id: dal.product.id }, reason: 'Bought together in 2 orders here.' });
    expect(recommendations.items.find((i) => i.product.id === ghee.product.id)).toBeUndefined();
  });

  it('suggests alternatives for an unavailable product, for customer and merchant alike', async () => {
    const { shop, rice } = await stocked();
    const sona = await flow.addSimpleProduct(shop, { name: 'Sona Masoori Rice', pricePaise: 9000 });
    expectStatus(await call('post', `${base(shop)}/products/${rice.product.id}/deactivate`, shop.merchant, {}), 200);
    const { alternatives } = expectStatus(await call('get', `/stores/${shop.store.slug}/products/${rice.product.id}/alternatives`, null), 200);
    expect(alternatives.items[0].product.id).toBe(sona.product.id);
    expect(alternatives.items[0].reason).toMatch(/Similar name/);
    const merchantView = expectStatus(await call('get', `${base(shop)}/products/${rice.product.id}/alternatives`, shop.merchant), 200).alternatives;
    expect(merchantView.items[0].product.id).toBe(sona.product.id);
  });
});

describe('customer: replenishment, discovery and the assistant', () => {
  it('predicts when a regular purchase is due from the usual gap', async () => {
    const shop = await liveShop();
    const rice = await flow.addRice(shop);
    const customer = await flow.newCustomer();
    const orders = [];
    for (let i = 0; i < 3; i += 1) {
      await flow.addToCart(customer, shop.store.id, rice.product.id, rice.kg.id, 2);
      const { order } = expectStatus(await flow.placeOrder(customer, { storeId: shop.store.id }), 201);
      await flow.fulfil(shop, order.id);
      orders.push(order.id);
    }
    // Completed 24, 17 and 10 days ago: a week apart, so due 3 days ago.
    for (const [i, days] of [24, 17, 10].entries()) {
      await sql(`update orders set completed_at = now() - make_interval(days => $2::int) where id = $1`, [orders[i], days]);
    }
    const { replenishment } = expectStatus(await call('get', '/me/replenishment', customer.auth), 200);
    expect(replenishment.items[0]).toMatchObject({ product: { id: rice.product.id }, everyDays: 7, status: 'due', usualQuantity: 2, usualVariantId: rice.kg.id, basedOnOrders: 3 });
  });

  it('discovers new-to-you products from the categories you buy', async () => {
    const shop = await liveShop();
    const { category } = expectStatus(await call('post', `${base(shop)}/categories`, shop.merchant, { name: 'Staples' }), 201);
    const dal = await flow.addSimpleProduct(shop, { name: 'Toor Dal', categoryId: category.id });
    const moong = await flow.addSimpleProduct(shop, { name: 'Moong Dal', categoryId: category.id });
    await flow.addSimpleProduct(shop, { name: 'Soap' });
    const customer = await flow.newCustomer();
    await flow.addToCart(customer, shop.store.id, dal.product.id, dal.variant.id, 1);
    const { order } = expectStatus(await flow.placeOrder(customer, { storeId: shop.store.id }), 201);
    await flow.fulfil(shop, order.id);
    const { discover } = expectStatus(await call('get', `/me/discover?storeId=${shop.store.id}`, customer.auth), 200);
    expect(discover.basedOn).toBe('your_categories');
    expect(discover.items.map((i) => i.product.id)).toEqual([moong.product.id]);
    expect(discover.items[0].reason).toContain('Staples');
  });

  it('answers questions from live data and only ever proposes', async () => {
    const shop = await liveShop();
    await flow.addRice(shop);
    await flow.addSimpleProduct(shop, { name: 'Toor Dal' });
    const customer = await flow.newCustomer();
    const before = await writableCounts();
    const ask = async (message, auth = customer.auth) => expectStatus(await call('post', `/stores/${shop.store.slug}/assistant`, auth, { message }), 200).reply;

    expect((await ask('are you open now?')).answer).toMatch(/is open now/);
    expect((await ask('what is the delivery fee?')).answer).toContain('₹30.00');
    const basket = await ask('2 kg rice and toor dal');
    expect(basket).toMatchObject({ kind: 'proposal', intent: 'basket' });
    expect(basket.proposals).toHaveLength(2);
    expect((await ask('compare rice per kg')).answer).toMatch(/₹120\.00\/kg/);
    expect((await ask('my usual', null)).kind).toBe('sign_in');
    expect(await writableCounts()).toEqual(before);
  });
});
