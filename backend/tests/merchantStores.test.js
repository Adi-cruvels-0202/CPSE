import { describe, it, expect, beforeEach, vi } from 'vitest';
import { api, url } from './helpers/app.js';
import { ALWAYS_OPEN, addToCart, placeOrder, asShopper } from './helpers/shopping.js';

vi.mock('../src/lib/supabase.js', async () => {
  const { createSupabaseMock } = await import('./helpers/supabaseMock.js');
  return createSupabaseMock();
});

const { supabaseAdmin } = await import('../src/lib/supabase.js');
const {
  db,
  CUSTOMER_ID,
  STORE_ID,
  SHOPPER_ID,
  resetDb,
  seedCustomer,
  seedMerchant,
  seedStore,
  seedCategory,
  seedProduct,
  seedProductImage,
} = await import('./helpers/supabaseMock.js');
const { slugify } = await import('../src/modules/merchantStores/merchantStore.service.js');

/**
 * A merchant's stores — MERCHANT_API.md, Stores; MERCHANT_RULES §2.
 */

const OTHER_MERCHANT_ID = '81111111-1111-4111-8111-000000000099';
const OTHER_STORE_ID = '41111111-1111-4111-8111-0000000000b2';

const WEEK = {
  mon: [{ open: '09:00', close: '13:00' }, { open: '16:00', close: '21:30' }],
  tue: [{ open: '09:00', close: '21:30' }],
  wed: [],
  thu: [{ open: '09:00', close: '21:30' }],
  fri: [{ open: '09:00', close: '21:30' }],
  sat: [{ open: '09:00', close: '23:00' }],
  sun: [{ open: '18:00', close: '01:00' }],
};

beforeEach(() => {
  resetDb();
  vi.clearAllMocks();
  seedCustomer();
  seedMerchant();
});

function signIn(id = CUSTOMER_ID) {
  supabaseAdmin.auth.getUser.mockResolvedValue({ data: { user: { id } }, error: null });
  return { Authorization: 'Bearer token-abc' };
}

const storesUrl = (path = '') => url(`/merchant/stores${path}`);
const create = (body) => api().post(storesUrl()).set(signIn()).send({ name: 'Sharma Kirana', ...body });
const storeRow = (id) => db.tables.get('stores').find((row) => row.id === id);

/** A store this merchant owns, unpublished, with nothing filled in. */
const seedOwnStore = (overrides = {}) =>
  seedStore({
    owner_id: CUSTOMER_ID,
    is_published: false,
    address_line1: null,
    city: null,
    phone: null,
    opening_hours: {},
    ...overrides,
  });

describe('POST /api/v1/merchant/stores', () => {
  it('creates an unpublished store with the starting settings (S-6, S-7)', async () => {
    const res = await create({ shopCategory: 'grocery' });

    expect(res.status).toBe(201);
    expect(res.body.data.store).toMatchObject({
      name: 'Sharma Kirana',
      slug: 'sharma-kirana',
      shopCategory: 'grocery',
      isPublished: false,
      fulfilment: { pickupEnabled: true, deliveryEnabled: false },
      paymentMethods: { cash: true, online: false },
      openingHours: {},
      timezone: 'Asia/Kolkata',
      publicPath: '/store/sharma-kirana',
    });
    expect(storeRow(res.body.data.store.id).owner_id).toBe(CUSTOMER_ID);
  });

  it('makes the link unique with -2, -3 when the name is taken (S-4)', async () => {
    seedStore({ slug: 'sharma-kirana', owner_id: OTHER_MERCHANT_ID });

    const second = await create();
    const third = await create();

    expect(second.body.data.store.slug).toBe('sharma-kirana-2');
    expect(third.body.data.store.slug).toBe('sharma-kirana-3');
  });

  it('refuses a chosen link that another store has', async () => {
    seedStore({ slug: 'my-shop', owner_id: OTHER_MERCHANT_ID });

    const res = await create({ slug: 'my-shop' });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'SLUG_TAKEN', details: { slug: 'my-shop' } });
  });

  it('stores the address in CPSE’s structured form', async () => {
    const res = await create({
      address: { line1: '12 MG Road', city: 'Pune', state: 'MH', postalCode: '411001' },
    });

    expect(res.body.data.store.address).toEqual({
      line1: '12 MG Road',
      line2: null,
      city: 'Pune',
      state: 'MH',
      postalCode: '411001',
      country: 'IN',
    });
  });

  it.each([
    ['a one-letter name', { name: 'S' }],
    ['a slug with capitals and spaces', { slug: 'My Shop!' }],
    ['an unknown shop category', { shopCategory: 'casino' }],
    ['a bad phone', { phone: '12' }],
    ['an unknown time zone', { timezone: 'Asia/Kolkatta' }],
    ['an address without a city', { address: { line1: '12 MG Road' } }],
  ])('refuses %s', async (_label, body) => {
    const res = await create(body);
    expect(res.status).toBe(422);
  });
});

describe('slugify (S-4)', () => {
  it.each([
    ['Sharma Kirana', 'sharma-kirana'],
    ['  Café  Delhi  ', 'cafe-delhi'],
    ['A&B -- Stores!!', 'a-b-stores'],
    ['ॐ', 'store'],
  ])('%s → %s', (name, slug) => {
    expect(slugify(name)).toBe(slug);
  });
});

describe('reading stores', () => {
  it('lists only this merchant’s stores, newest first, in every state', async () => {
    seedOwnStore({ id: STORE_ID, slug: 'older', created_at: '2026-10-01T09:00:00Z' });
    seedOwnStore({ id: OTHER_STORE_ID, slug: 'newer', is_published: true, created_at: '2026-10-02T09:00:00Z' });
    seedStore({ id: '41111111-1111-4111-8111-0000000000b3', slug: 'theirs', owner_id: OTHER_MERCHANT_ID });

    const { body } = await api().get(storesUrl()).set(signIn());

    expect(body.data.stores.map((store) => store.slug)).toEqual(['newer', 'older']);
  });

  it('answers another merchant’s store and a missing one with the same 404', async () => {
    seedStore({ owner_id: OTHER_MERCHANT_ID });

    const theirs = await api().get(storesUrl(`/${STORE_ID}`)).set(signIn());
    const missing = await api().get(storesUrl(`/${OTHER_STORE_ID}`)).set(signIn());

    expect(theirs.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(theirs.body.error.message).toBe(missing.body.error.message);
  });

  it('cannot change another merchant’s store', async () => {
    seedStore({ owner_id: OTHER_MERCHANT_ID, name: 'Theirs' });

    const res = await api().patch(storesUrl(`/${STORE_ID}`)).set(signIn()).send({ name: 'Mine now' });

    expect(res.status).toBe(404);
    expect(storeRow(STORE_ID).name).toBe('Theirs');
  });
});

describe('PATCH /api/v1/merchant/stores/:storeId', () => {
  it('changes only what was sent', async () => {
    seedOwnStore({ description: 'Groceries' });

    const { body } = await api().patch(storesUrl(`/${STORE_ID}`)).set(signIn()).send({ name: 'New Name' });

    expect(body.data.store).toMatchObject({ name: 'New Name', description: 'Groceries' });
  });

  it('clears the address with null', async () => {
    seedOwnStore({ address_line1: '12 MG Road', city: 'Pune' });

    const { body } = await api().patch(storesUrl(`/${STORE_ID}`)).set(signIn()).send({ address: null });

    expect(body.data.store.address).toBeNull();
  });

  it('lets the link change while unpublished', async () => {
    seedOwnStore({ slug: 'old-link' });

    const { body } = await api().patch(storesUrl(`/${STORE_ID}`)).set(signIn()).send({ slug: 'new-link' });

    expect(body.data.store.slug).toBe('new-link');
  });

  it('keeps the link fixed once published — it is in shared links and QR codes (S-5)', async () => {
    seedOwnStore({ slug: 'old-link', is_published: true });

    const res = await api().patch(storesUrl(`/${STORE_ID}`)).set(signIn()).send({ slug: 'new-link' });

    expect(res.status).toBe(409);
    expect(storeRow(STORE_ID).slug).toBe('old-link');
  });

  it('accepts the current link unchanged on a published store', async () => {
    seedOwnStore({ slug: 'same-link', is_published: true });

    const res = await api()
      .patch(storesUrl(`/${STORE_ID}`))
      .set(signIn())
      .send({ slug: 'same-link', name: 'Renamed' });

    expect(res.status).toBe(200);
  });

  it('refuses a link another store has', async () => {
    seedOwnStore({ slug: 'mine' });
    seedStore({ id: OTHER_STORE_ID, slug: 'taken', owner_id: OTHER_MERCHANT_ID });

    const res = await api().patch(storesUrl(`/${STORE_ID}`)).set(signIn()).send({ slug: 'taken' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SLUG_TAKEN');
  });

  it('refuses an empty update', async () => {
    seedOwnStore();
    const res = await api().patch(storesUrl(`/${STORE_ID}`)).set(signIn()).send({});
    expect(res.status).toBe(422);
  });
});

describe('publishing (S-8, S-9)', () => {
  const publish = () => api().post(storesUrl(`/${STORE_ID}/publish`)).set(signIn());
  const unpublish = () => api().post(storesUrl(`/${STORE_ID}/unpublish`)).set(signIn());
  const customerPage = () => api().get(url(`/stores/${storeRow(STORE_ID).slug}`));

  it('lists everything a customer would miss', async () => {
    seedOwnStore();

    const res = await publish();

    expect(res.status).toBe(422);
    expect(res.body.error).toMatchObject({
      code: 'STORE_INCOMPLETE',
      details: { missing: ['address', 'phone', 'openingHours'] },
    });
    expect(storeRow(STORE_ID).is_published).toBe(false);
  });

  it('publishes a complete store, and customers can then open it', async () => {
    seedOwnStore({ address_line1: '12 MG Road', city: 'Pune', phone: '+919876543210', opening_hours: WEEK });

    expect((await customerPage()).status).toBe(404);
    const res = await publish();

    expect(res.status).toBe(200);
    expect(res.body.data.store.isPublished).toBe(true);
    expect((await customerPage()).status).toBe(200);
  });

  it('is 409 when already published', async () => {
    seedOwnStore({ is_published: true });
    expect((await publish()).status).toBe(409);
  });

  it('unpublishing hides it from customers again — page, cart and saved stores', async () => {
    seedOwnStore({ is_published: true });
    seedCategory();
    const product = seedProduct();
    db.tables.set('saved_stores', [{ customer_id: SHOPPER_ID, store_id: STORE_ID, created_at: '2026-10-01T09:00:00Z' }]);

    const res = await unpublish();

    expect(res.status).toBe(200);
    expect((await customerPage()).status).toBe(404);
    expect(
      (await addToCart(asShopper(), { storeId: STORE_ID, productId: product.id })).status,
    ).toBe(404);
    const saved = await api().get(url('/saved-stores')).set(asShopper());
    expect(saved.body.data.savedStores).toEqual([]);
  });

  it('is 409 to unpublish a store that is not published', async () => {
    seedOwnStore();
    expect((await unpublish()).status).toBe(409);
  });

  it('takes no body', async () => {
    seedOwnStore();
    const res = await api().post(storesUrl(`/${STORE_ID}/publish`)).set(signIn()).send({ force: true });
    expect(res.status).toBe(422);
  });
});

describe('PUT /api/v1/merchant/stores/:storeId/hours (D-8)', () => {
  const putHours = (body) => api().put(storesUrl(`/${STORE_ID}/hours`)).set(signIn()).send(body);

  beforeEach(() => seedOwnStore());

  it('replaces the week, including a window past midnight', async () => {
    const res = await putHours({ timezone: 'Asia/Kolkata', openingHours: WEEK });

    expect(res.status).toBe(200);
    expect(res.body.data.store.openingHours).toEqual(WEEK);
    expect(storeRow(STORE_ID).opening_hours.sun).toEqual([{ open: '18:00', close: '01:00' }]);
  });

  it.each([
    ['a missing day', { ...WEEK, sun: undefined }],
    ['four windows in a day', { ...WEEK, mon: [1, 2, 3, 4].map(() => ({ open: '09:00', close: '10:00' })) }],
    ['a time that is not HH:MM', { ...WEEK, tue: [{ open: '9am', close: '21:30' }] }],
    ['a window that opens and closes at once', { ...WEEK, tue: [{ open: '09:00', close: '09:00' }] }],
    ['an unknown day', { ...WEEK, funday: [] }],
  ])('refuses %s', async (_label, openingHours) => {
    const res = await putHours({ openingHours: JSON.parse(JSON.stringify(openingHours)) });
    expect(res.status).toBe(422);
  });

  it('refuses an unknown time zone', async () => {
    expect((await putHours({ timezone: 'Mars/Olympus', openingHours: WEEK })).status).toBe(422);
  });
});

describe('PUT /api/v1/merchant/stores/:storeId/delivery', () => {
  const putDelivery = (body) => api().put(storesUrl(`/${STORE_ID}/delivery`)).set(signIn()).send(body);
  const settings = {
    pickupEnabled: true,
    deliveryEnabled: true,
    deliveryFeePaise: 3000,
    minOrderPaise: 19900,
    freeDeliveryThresholdPaise: 99900,
    deliveryRadiusKm: 5,
  };

  beforeEach(() => seedOwnStore());

  it('saves the delivery settings', async () => {
    const { body } = await putDelivery(settings);
    expect(body.data.store.fulfilment).toEqual(settings);
  });

  it('defaults the threshold and radius to none', async () => {
    const { body } = await putDelivery({ ...settings, freeDeliveryThresholdPaise: undefined, deliveryRadiusKm: undefined });
    expect(body.data.store.fulfilment).toMatchObject({ freeDeliveryThresholdPaise: null, deliveryRadiusKm: null });
  });

  it('refuses a store that offers neither pickup nor delivery', async () => {
    const res = await putDelivery({ ...settings, pickupEnabled: false, deliveryEnabled: false });
    expect(res.status).toBe(422);
  });

  it('refuses rupees where paise are expected', async () => {
    expect((await putDelivery({ ...settings, deliveryFeePaise: 29.5 })).status).toBe(422);
  });
});

describe('PUT /api/v1/merchant/stores/:storeId/payments (S-16)', () => {
  const putPayments = (body) => api().put(storesUrl(`/${STORE_ID}/payments`)).set(signIn()).send(body);

  it('refuses a store that takes nothing', async () => {
    seedOwnStore();
    expect((await putPayments({ cash: false, online: false })).status).toBe(422);
  });

  it('is what the customer store page shows, and what checkout enforces', async () => {
    seedOwnStore({ is_published: true, opening_hours: ALWAYS_OPEN });
    seedCategory();
    const product = seedProduct({ price_paise: 25000 });

    const { body } = await putPayments({ cash: true, online: false });
    expect(body.data.store.paymentMethods).toEqual({ cash: true, online: false });

    const page = await api().get(url(`/stores/${storeRow(STORE_ID).slug}`));
    expect(page.body.data.store.payment).toEqual({ online: false, cashOnDelivery: true });

    const customer = asShopper();
    await addToCart(customer, { storeId: STORE_ID, productId: product.id });
    const online = await placeOrder(customer, { storeId: STORE_ID, paymentMethod: 'online' });
    expect(online.status).toBe(422);
    expect(online.body.error).toMatchObject({
      code: 'PAYMENT_METHOD_UNAVAILABLE',
      details: { accepts: { cash: true, online: false } },
    });

    const cash = await placeOrder(customer, { storeId: STORE_ID, paymentMethod: 'cash' });
    expect(cash.status).toBe(201);
  });
});

describe('DELETE /api/v1/merchant/stores/:storeId (S-19)', () => {
  const remove = (body, id = STORE_ID) => api().delete(storesUrl(`/${id}`)).set(signIn()).send(body);
  const rows = (table) => db.tables.get(table) ?? [];

  it('deletes the store and everything in it once its name is typed', async () => {
    seedOwnStore({ name: 'Sharma Kirana' });
    seedCategory();
    const product = seedProduct();
    seedProductImage({ product_id: product.id });

    const res = await remove({ confirmName: 'Sharma Kirana' });

    expect(res.status).toBe(204);
    expect(storeRow(STORE_ID)).toBeUndefined();
    expect(rows('products')).toEqual([]);
    expect(rows('product_variants')).toEqual([]);
    expect(rows('product_images')).toEqual([]);
    expect(rows('categories')).toEqual([]);
  });

  it('refuses when the typed name does not match, and keeps the store', async () => {
    seedOwnStore({ name: 'Sharma Kirana' });

    const res = await remove({ confirmName: 'Sharma' });

    expect(res.status).toBe(422);
    expect(res.body.error.details.issues[0].field).toBe('confirmName');
    expect(storeRow(STORE_ID)).toBeDefined();
  });

  it('requires the confirmation', async () => {
    seedOwnStore();
    expect((await remove({})).status).toBe(422);
  });

  it('refuses while an order is still in progress (409)', async () => {
    seedOwnStore({ name: 'Sharma Kirana', is_published: true, opening_hours: ALWAYS_OPEN, min_order_paise: 0 });
    seedCategory();
    const product = seedProduct();
    const customer = asShopper();
    await addToCart(customer, { storeId: STORE_ID, productId: product.id });
    expect((await placeOrder(customer, { storeId: STORE_ID, paymentMethod: 'cash' })).status).toBe(201);

    const res = await remove({ confirmName: 'Sharma Kirana' });

    expect(res.status).toBe(409);
    expect(storeRow(STORE_ID)).toBeDefined();
  });

  it('takes past orders with it once they are finished', async () => {
    seedOwnStore({ name: 'Sharma Kirana', is_published: true, opening_hours: ALWAYS_OPEN, min_order_paise: 0 });
    seedCategory();
    const product = seedProduct();
    const customer = asShopper();
    await addToCart(customer, { storeId: STORE_ID, productId: product.id });
    const order = await placeOrder(customer, { storeId: STORE_ID, paymentMethod: 'cash' });
    rows('orders').find((row) => row.id === order.body.data.order.id).status = 'completed';

    expect((await remove({ confirmName: 'Sharma Kirana' })).status).toBe(204);
    expect(rows('orders')).toEqual([]);
    expect(rows('order_items')).toEqual([]);
  });

  it("answers 404 for another merchant's store and leaves it alone", async () => {
    seedStore({ id: OTHER_STORE_ID, slug: 'other', name: 'Other', owner_id: OTHER_MERCHANT_ID });

    expect((await remove({ confirmName: 'Other' }, OTHER_STORE_ID)).status).toBe(404);
    expect(storeRow(OTHER_STORE_ID)).toBeDefined();
  });
});
