import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { api, url } from './helpers/app.js';
import { ALWAYS_OPEN, addToCart, placeOrder } from './helpers/shopping.js';

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
  seedProductImage,
  defaultVariantOf,
} = await import('./helpers/supabaseMock.js');
const { sniffImageType } = await import('../src/lib/imageUpload.js');

/**
 * The P1 merchant features — MERCHANT_API.md, P1 endpoints: photos, holidays,
 * counter sales and the dashboard.
 */

const MERCHANT_ID = '81111111-1111-4111-8111-000000000001';
const OTHER_MERCHANT_ID = '81111111-1111-4111-8111-000000000099';
const OTHER_STORE_ID = '41111111-1111-4111-8111-0000000000b2';

// The first bytes are what decide the type; the rest is padding.
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(64)]);
const HTML_AS_PNG = Buffer.from('<html><script>alert(1)</script></html>'.padEnd(80, ' '));

let rice;

beforeEach(() => {
  resetDb();
  vi.clearAllMocks();
  seedCustomer();
  seedCustomer({ id: MERCHANT_ID, email: 'owner@shop.in' });
  seedMerchant({ id: MERCHANT_ID, email: 'owner@shop.in' });
  seedCustomer({ id: OTHER_MERCHANT_ID, email: 'other@shop.in' });
  seedMerchant({ id: OTHER_MERCHANT_ID, email: 'other@shop.in' });
  seedStore({ owner_id: MERCHANT_ID, opening_hours: ALWAYS_OPEN });
  seedStore({ id: OTHER_STORE_ID, slug: 'other-shop', owner_id: OTHER_MERCHANT_ID });
  seedCategory();
  rice = seedProduct({ name: 'Basmati Rice', price_paise: 10000, tax_percent: 5, stock: 10, low_stock_threshold: 3 });
});

const as = (id) => {
  supabaseAdmin.auth.getUser.mockResolvedValue({ data: { user: { id } }, error: null });
  return { Authorization: 'Bearer token-abc' };
};
const at = (path, storeId = STORE_ID) => url(`/merchant/stores/${storeId}${path}`);
const upload = (path, buffer, name = 'photo.png', storeId) =>
  api().post(at(path, storeId)).set(as(MERCHANT_ID)).attach('file', buffer, name);

// ── Photos ───────────────────────────────────────────────────────────────────

describe('sniffImageType', () => {
  it('reads the type from the bytes', () => {
    expect(sniffImageType(PNG)).toEqual({ mime: 'image/png', ext: 'png' });
    expect(sniffImageType(JPEG)).toEqual({ mime: 'image/jpeg', ext: 'jpg' });
    expect(sniffImageType(WEBP)).toEqual({ mime: 'image/webp', ext: 'webp' });
    expect(sniffImageType(HTML_AS_PNG)).toBeNull();
  });
});

describe('store logo and cover (D-10)', () => {
  it('stores the logo in the bucket under the store, with a fresh name, and points the store at it', async () => {
    const res = await upload('/logo', PNG, '../../etc/passwd.png');

    expect(res.status).toBe(200);
    const { logoUrl } = res.body.data.store;
    expect(logoUrl).toMatch(new RegExp(`^https://storage\\.test/storage/v1/object/public/catalogue/stores/${STORE_ID}/logo/[0-9a-f-]{36}\\.png$`));
    expect([...db.storage.keys()]).toEqual([logoUrl.split('/public/')[1]]);
    expect([...db.storage.values()][0].contentType).toBe('image/png');
  });

  it('deletes the photo it replaces, but never one it did not store', async () => {
    const first = (await upload('/cover', PNG)).body.data.store.coverImageUrl;
    await upload('/cover', JPEG, 'b.jpg');
    expect(db.storage.size).toBe(1);
    expect([...db.storage.keys()][0]).not.toBe(first.split('/public/')[1]);

    db.tables.get('stores')[0].logo_url = 'https://elsewhere.example/logo.png';
    await upload('/logo', PNG);
    expect(db.storage.size).toBe(2);
  });

  it('refuses a file that only claims to be an image', async () => {
    const res = await upload('/logo', HTML_AS_PNG, 'photo.png');
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('IMAGE_INVALID');
    expect(db.storage.size).toBe(0);
  });

  it('refuses a photo over 5 MB', async () => {
    const big = Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]);
    const res = await upload('/logo', big);
    expect(res.status).toBe(413);
  });

  it('asks for a file when none is sent', async () => {
    const res = await api().post(at('/logo')).set(as(MERCHANT_ID)).send({});
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('IMAGE_REQUIRED');
  });

  it('cannot change another merchant’s store', async () => {
    const res = await upload('/logo', PNG, 'a.png', OTHER_STORE_ID);
    expect(res.status).toBe(404);
    expect(db.storage.size).toBe(0);
  });
});

describe('product photos', () => {
  it('adds photos in order, and customers see the first one', async () => {
    await upload(`/products/${rice.id}/images`, PNG);
    const res = await upload(`/products/${rice.id}/images`, JPEG, 'b.jpg');

    expect(res.status).toBe(201);
    const images = res.body.data.product.images;
    expect(images.map((image) => image.sortOrder)).toEqual([0, 1]);

    const page = await api().get(url(`/stores/sharma-kirana/products/${rice.id}`));
    expect(page.body.data.product.imageUrl).toBe(images[0].url);
  });

  it('removes a photo, and deletes the stored file', async () => {
    const added = (await upload(`/products/${rice.id}/images`, PNG)).body.data.product.images[0];

    const res = await api().delete(at(`/products/${rice.id}/images/${added.id}`)).set(as(MERCHANT_ID));

    expect(res.body.data.product.images).toEqual([]);
    expect(db.storage.size).toBe(0);
  });

  it('will not delete another product’s photo through this one (S-18)', async () => {
    const dal = seedProduct({ slug: 'dal', name: 'Dal' });
    const theirs = seedProductImage({ product_id: dal.id });

    const res = await api().delete(at(`/products/${rice.id}/images/${theirs.id}`)).set(as(MERCHANT_ID));

    expect(res.status).toBe(404);
    expect(db.tables.get('product_images')).toHaveLength(1);
  });

  it('stops at 10 photos', async () => {
    for (let i = 0; i < 10; i += 1) seedProductImage({ product_id: rice.id, sort_order: i });
    const res = await upload(`/products/${rice.id}/images`, PNG);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('IMAGE_LIMIT');
  });
});

// ── Holidays ─────────────────────────────────────────────────────────────────

describe('holidays (S-12)', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-02T05:30:00Z') }));
  afterEach(() => vi.useRealTimers());

  const add = (body) => api().post(at('/holidays')).set(as(MERCHANT_ID)).send(body);

  it('closes the store for customers on that day', async () => {
    const before = await api().get(url('/stores/sharma-kirana'));
    expect(before.body.data.store.hours.isOpen).toBe(true);

    const res = await add({ date: '2026-10-02', reason: 'Diwali' });
    expect(res.status).toBe(201);
    expect(res.body.data.holiday).toMatchObject({ date: '2026-10-02', reason: 'Diwali' });

    const after = await api().get(url('/stores/sharma-kirana'));
    expect(after.body.data.store.hours).toMatchObject({ isOpen: false, opensOnDate: '2026-10-03' });
  });

  it('lists today’s and later ones, and removes one', async () => {
    db.tables.set('store_holidays', [
      { id: '71111111-1111-4111-8111-000000000001', store_id: STORE_ID, holiday_date: '2026-09-01', reason: null, created_at: '…' },
    ]);
    const { body } = await add({ date: '2026-10-15' });

    const list = await api().get(at('/holidays')).set(as(MERCHANT_ID));
    expect(list.body.data.holidays.map((holiday) => holiday.date)).toEqual(['2026-10-15']);

    const removed = await api().delete(at(`/holidays/${body.data.holiday.id}`)).set(as(MERCHANT_ID));
    expect(removed.status).toBe(204);
  });

  it.each([
    ['a past date', { date: '2026-10-01' }],
    ['a date that does not exist', { date: '2026-02-30' }],
    ['another format', { date: '02/10/2026' }],
  ])('refuses %s', async (_label, body) => {
    expect((await add(body)).status).toBe(422);
  });

  it('cannot remove another store’s holiday', async () => {
    db.tables.set('store_holidays', [
      { id: '71111111-1111-4111-8111-000000000002', store_id: OTHER_STORE_ID, holiday_date: '2026-10-20', reason: null, created_at: '…' },
    ]);
    const res = await api().delete(at('/holidays/71111111-1111-4111-8111-000000000002')).set(as(MERCHANT_ID));
    expect(res.status).toBe(404);
    expect(db.tables.get('store_holidays')).toHaveLength(1);
  });
});

// ── Counter sales ────────────────────────────────────────────────────────────

describe('counter sales (§8)', () => {
  const sell = (body, key) => {
    const request = api().post(at('/sales')).set(as(MERCHANT_ID));
    if (key) request.set('Idempotency-Key', key);
    return request.send({ items: [{ variantId: defaultVariantOf(rice).id, quantity: 2 }], paymentMethod: 'upi', ...body });
  };

  it('prices with tax on top, takes the stock and numbers the invoice', async () => {
    const res = await sell({ customerName: 'Walk-in' });

    expect(res.status).toBe(201);
    expect(res.body.data.sale).toMatchObject({
      invoiceNumber: 'INV-000001',
      paymentMethod: 'upi',
      customerName: 'Walk-in',
      totals: { subtotalPaise: 20000, discountPaise: 0, taxPaise: 1000, totalPaise: 21000 },
      itemCount: 1,
    });
    expect(res.body.data.sale.items[0]).toMatchObject({ productName: 'Basmati Rice', variantName: null, taxPaise: 1000, lineTotalPaise: 21000 });
    expect(defaultVariantOf(rice).quantity_on_hand).toBe(8);
    expect((await sell()).body.data.sale.invoiceNumber).toBe('INV-000002');
  });

  it('takes a discount off the bill, but never more than the bill (X-4)', async () => {
    expect((await sell({ discountPaise: 1000 })).body.data.sale.totals.totalPaise).toBe(20000);
    const res = await sell({ discountPaise: 21001 });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatchObject({ code: 'DISCOUNT_TOO_LARGE', details: { maxDiscountPaise: 21000 } });
  });

  it('cannot sell what a customer’s online order holds (X-6)', async () => {
    const customer = as(CUSTOMER_ID);
    await addToCart(customer, { storeId: STORE_ID, productId: rice.id, quantity: 9 });
    await placeOrder(customer, { storeId: STORE_ID });

    const res = await sell();

    expect(res.status).toBe(422);
    expect(res.body.error).toMatchObject({ code: 'INSUFFICIENT_STOCK', details: { productName: 'Basmati Rice', availableQuantity: 1 } });
  });

  it('replays an Idempotency-Key instead of selling twice', async () => {
    await sell({}, 'till-42');
    const again = await sell({}, 'till-42');

    expect(again.status).toBe(200);
    expect(again.body.data.replayed).toBe(true);
    expect(db.tables.get('sales')).toHaveLength(1);
  });

  it('refuses a variant of another store, and the same variant twice', async () => {
    const theirs = defaultVariantOf(seedProduct({ store_id: OTHER_STORE_ID, slug: 'theirs' }));
    expect((await sell({ items: [{ variantId: theirs.id, quantity: 1 }] })).status).toBe(404);

    const id = defaultVariantOf(rice).id;
    expect((await sell({ items: [{ variantId: id, quantity: 1 }, { variantId: id, quantity: 1 }] })).status).toBe(422);
  });

  it('lists sales newest first and shows one, and keeps other stores’ out', async () => {
    const { body } = await sell();
    const list = await api().get(at('/sales')).set(as(MERCHANT_ID));
    expect(list.body.data.sales.map((sale) => sale.id)).toEqual([body.data.sale.id]);
    expect(list.body.data.sales[0]).not.toHaveProperty('items');

    const one = await api().get(at(`/sales/${body.data.sale.id}`)).set(as(MERCHANT_ID));
    expect(one.body.data.sale.items).toHaveLength(1);

    const theirs = await api().get(at(`/sales/${body.data.sale.id}`, OTHER_STORE_ID)).set(as(OTHER_MERCHANT_ID));
    expect(theirs.status).toBe(404);
  });
});

// ── Dashboard ────────────────────────────────────────────────────────────────

describe('dashboard (§9)', () => {
  it('counts today in the store’s own timezone, orders and sales both, and flags low stock', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-02T05:30:00Z') });
    try {
      const customer = as(CUSTOMER_ID);
      await addToCart(customer, { storeId: STORE_ID, productId: rice.id, quantity: 2 });
      const { body } = await placeOrder(customer, { storeId: STORE_ID });
      await api().post(at(`/orders/${body.data.order.id}/accept`)).set(as(MERCHANT_ID)).send({});
      await api()
        .post(at('/sales'))
        .set(as(MERCHANT_ID))
        .send({ items: [{ variantId: defaultVariantOf(rice).id, quantity: 5 }], paymentMethod: 'cash' });

      // An order from 23:00 UTC yesterday is 04:30 today in Kolkata — today, not yesterday.
      db.tables.get('orders').push({
        id: '01111111-1111-4111-8111-0000000000aa', store_id: STORE_ID, order_number: 'X', status: 'completed',
        total_paise: 5000, placed_at: '2026-10-01T23:00:00Z', fulfilment_mode: 'pickup', customer_id: CUSTOMER_ID,
      });

      const res = await api().get(at('/dashboard')).set(as(MERCHANT_ID));

      expect(res.status).toBe(200);
      const { dashboard } = res.body.data;
      expect(dashboard.date).toBe('2026-10-02');
      expect(dashboard.today).toEqual({ ordersCount: 2, ordersRevenuePaise: 21000 + 5000, salesCount: 1, salesRevenuePaise: 52500 });
      expect(dashboard.openOrders).toEqual({ placed: 0, accepted: 1, preparing: 0, ready: 0 });
      // 10 − 5 sold − 2 held = 3 left, at the threshold of 3.
      expect(dashboard.lowStock).toEqual([
        expect.objectContaining({ productName: 'Basmati Rice', availableQuantity: 3, lowStockThreshold: 3 }),
      ]);
      expect(dashboard.recentOrders.map((order) => order.orderNumber)).toContain(body.data.order.orderNumber);
    } finally {
      vi.useRealTimers();
    }
  });
});
