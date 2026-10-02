import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { api, url } from './helpers/app.js';
import { ALWAYS_OPEN, addToCart, placeOrder, advance } from './helpers/shopping.js';

vi.mock('../src/lib/supabase.js', async () => {
  const { createSupabaseMock } = await import('./helpers/supabaseMock.js');
  return createSupabaseMock();
});

const { supabaseAdmin } = await import('../src/lib/supabase.js');
const {
  db,
  CUSTOMER_ID,
  STORE_ID,
  resetDb,
  seedCustomer,
  seedMerchant,
  seedStore,
  seedCategory,
  seedProduct,
  defaultVariantOf,
} = await import('./helpers/supabaseMock.js');

/**
 * A merchant's stock — MERCHANT_API.md, Inventory; MERCHANT_RULES §5; D-5.
 */

const OTHER_MERCHANT_ID = '81111111-1111-4111-8111-000000000099';
const OTHER_STORE_ID = '41111111-1111-4111-8111-0000000000b2';

let rice;
let variant;

beforeEach(() => {
  resetDb();
  vi.clearAllMocks();
  seedCustomer();
  seedMerchant();
  seedStore({ owner_id: CUSTOMER_ID, opening_hours: ALWAYS_OPEN });
  seedStore({ id: OTHER_STORE_ID, slug: 'other-shop', owner_id: OTHER_MERCHANT_ID });
  seedCategory();
  rice = seedProduct({ name: 'Basmati Rice', price_paise: 12500, stock: 10, low_stock_threshold: 3 });
  variant = defaultVariantOf(rice);
  variant.sku = 'RICE-1';
});

function signIn() {
  supabaseAdmin.auth.getUser.mockResolvedValue({ data: { user: { id: CUSTOMER_ID } }, error: null });
  return { Authorization: 'Bearer token-abc' };
}

const at = (path, storeId = STORE_ID) => url(`/merchant/stores/${storeId}/inventory${path}`);
const move = (path, body, storeId) => api().post(at(path, storeId)).set(signIn()).send({ variantId: variant.id, ...body });
const history = (query = '') => api().get(at(`/history${query}`)).set(signIn());

/** A customer order holding `quantity` units, as the cart and checkout make it. */
async function customerOrder(quantity) {
  const auth = signIn();
  await addToCart(auth, { storeId: STORE_ID, productId: rice.id, quantity });
  const { body } = await placeOrder(auth, { storeId: STORE_ID });
  return body.data.order;
}

describe('POST …/inventory/stock-in', () => {
  it('adds stock and answers with the variant and its ledger entry', async () => {
    const res = await move('/stock-in', { quantity: 5, unitCostPaise: 10000, notes: 'Delivery' });

    expect(res.status).toBe(200);
    expect(res.body.data.variant).toMatchObject({
      id: variant.id,
      productName: 'Basmati Rice',
      sku: 'RICE-1',
      quantityOnHand: 15,
      reservedQuantity: 0,
      availableQuantity: 15,
      isLowStock: false,
    });
    expect(res.body.data.entry).toMatchObject({
      movementType: 'stock_in',
      productName: 'Basmati Rice',
      variantName: 'Default',
      onHandChange: 5,
      onHandAfter: 15,
      availableAfter: 15,
      unitCostPaise: 10000,
      notes: 'Delivery',
      reference: null,
      performedBy: { type: 'merchant', id: CUSTOMER_ID },
    });
  });

  it.each([
    ['zero', { quantity: 0 }],
    ['a fraction', { quantity: 1.5 }],
    ['more than 100000', { quantity: 100_001 }],
    ['a reason, which stock in does not take', { quantity: 1, reason: 'damaged' }],
  ])('refuses %s', async (_label, body) => {
    expect((await move('/stock-in', body)).status).toBe(422);
  });
});

describe('POST …/inventory/stock-out (I-2)', () => {
  it('removes stock with a reason', async () => {
    const res = await move('/stock-out', { quantity: 2, reason: 'expired' });
    expect(res.body.data.variant.quantityOnHand).toBe(8);
    expect(res.body.data.entry).toMatchObject({ movementType: 'stock_out', onHandChange: -2, reason: 'expired' });
  });

  it('cannot take units held for a customer’s order', async () => {
    await customerOrder(8);

    const res = await move('/stock-out', { quantity: 3, reason: 'lost' });

    expect(res.status).toBe(422);
    expect(res.body.error).toMatchObject({ code: 'INSUFFICIENT_STOCK', details: { availableQuantity: 2 } });
    expect(variant.quantity_on_hand).toBe(10);
  });

  it('refuses a reason outside the list', async () => {
    expect((await move('/stock-out', { quantity: 1, reason: 'gift' })).status).toBe(422);
  });
});

describe('POST …/inventory/adjust (I-3)', () => {
  it('sets on hand after a count, and flags low stock', async () => {
    const res = await move('/adjust', { newQuantity: 3, reason: 'Counted the shelf' });

    expect(res.body.data.variant).toMatchObject({ quantityOnHand: 3, isLowStock: true });
    expect(res.body.data.entry).toMatchObject({ movementType: 'adjustment', onHandChange: -7, reason: 'Counted the shelf' });
  });

  it('cannot go below what open orders hold', async () => {
    await customerOrder(4);

    const res = await move('/adjust', { newQuantity: 3, reason: 'Count' });

    expect(res.status).toBe(422);
    expect(res.body.error).toMatchObject({ code: 'BELOW_RESERVED', details: { reservedQuantity: 4 } });
  });

  it('needs a reason, and a number that differs from now', async () => {
    expect((await move('/adjust', { newQuantity: 4 })).status).toBe(422);
    expect((await move('/adjust', { newQuantity: 10, reason: 'Count' })).status).toBe(422);
  });
});

describe('what cannot be moved', () => {
  it('stock of a product that is not counted (I-9)', async () => {
    rice.track_inventory = false;

    const res = await move('/stock-in', { quantity: 5 });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('NOT_TRACKED');
  });

  it('a variant of another store — the same 404 as none', async () => {
    const theirs = defaultVariantOf(seedProduct({ store_id: OTHER_STORE_ID, slug: 'theirs' }));

    const res = await move('/stock-in', { variantId: theirs.id, quantity: 5 });

    expect(res.status).toBe(404);
    expect(theirs.quantity_on_hand).toBe(40);
  });

  it('anything in another merchant’s store', async () => {
    expect((await move('/stock-in', { quantity: 5 }, OTHER_STORE_ID)).status).toBe(404);
  });
});

describe('GET …/inventory/history', () => {
  // Newest-first is ordered by created_at; each movement gets its own second,
  // so the order is decided by the code and not by how fast the test ran.
  let clock = Date.parse('2026-10-03T09:00:00Z');
  beforeEach(() => vi.useFakeTimers({ toFake: ['Date'] }));
  afterEach(() => vi.useRealTimers());
  const tick = () => vi.setSystemTime((clock += 1000));

  it('shows every movement newest first, including the ones orders make, with the order number', async () => {
    tick();
    await move('/stock-in', { quantity: 5 });
    tick();
    const order = await customerOrder(2);
    tick();
    await advance(signIn(), order.id, 'rejected', 'Out of stock');

    const { body } = await history();

    expect(body.data.entries.map((entry) => entry.movementType)).toEqual([
      'order_released',
      'order_reserved',
      'stock_in',
    ]);
    expect(body.data.entries[1]).toMatchObject({
      reservedChange: 2,
      availableAfter: 13,
      reference: { type: 'order', id: order.id, number: order.orderNumber },
      performedBy: { type: 'customer', id: CUSTOMER_ID },
    });
    expect(body.data.entries[0].performedBy).toEqual({ type: 'system', id: null });
    expect(body.meta).toMatchObject({ page: 1, total: 3 });
  });

  it('filters by movement type, product, variant and date', async () => {
    tick();
    await move('/stock-in', { quantity: 5 });
    tick();
    await move('/stock-out', { quantity: 1, reason: 'damaged' });
    const dal = defaultVariantOf(seedProduct({ slug: 'dal', name: 'Dal' }));
    tick();
    await move('/stock-in', { variantId: dal.id, quantity: 3 });

    const types = async (query) => (await history(query)).body.data.entries.map((e) => [e.productName, e.movementType]);

    expect(await types('?movementType=stock_out')).toEqual([['Basmati Rice', 'stock_out']]);
    expect(await types(`?productId=${rice.id}`)).toEqual([['Basmati Rice', 'stock_out'], ['Basmati Rice', 'stock_in']]);
    expect(await types(`?variantId=${dal.id}`)).toEqual([['Dal', 'stock_in']]);
    expect(await types('?to=2000-01-01T00:00:00Z')).toEqual([]);
  });

  it('treats another store’s product as missing rather than empty', async () => {
    const theirs = seedProduct({ store_id: OTHER_STORE_ID, slug: 'theirs' });
    expect((await history(`?productId=${theirs.id}`)).status).toBe(404);
  });

  it('refuses a range that ends before it starts', async () => {
    expect((await history('?from=2026-10-02T00:00:00Z&to=2026-10-01T00:00:00Z')).status).toBe(422);
  });
});
