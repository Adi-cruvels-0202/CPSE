import { describe, it, expect, beforeEach, vi } from 'vitest';
import { api, url } from './helpers/app.js';

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
  nextId,
  seedCustomer,
  seedStore,
  seedCategory,
  seedProduct,
  seedProductImage,
  seedProductVariant,
} = await import('./helpers/supabaseMock.js');

const OTHER_CUSTOMER_ID = '9f8a1c2e-5b3d-4a7f-9c1e-2d4b6a8c0e99';
const OTHER_STORE_ID = '11111111-1111-4111-8111-000000000002';

beforeEach(() => {
  resetDb();
  vi.clearAllMocks();
  seedCustomer();
  seedStore();
  seedCategory();
});

/** Every cart route is authenticated; this is the signed-in caller. */
function signIn(id = CUSTOMER_ID) {
  supabaseAdmin.auth.getUser.mockResolvedValue({ data: { user: { id } }, error: null });
  return { Authorization: 'Bearer token-abc' };
}

const cartUrl = (storeId = STORE_ID) => url(`/cart?storeId=${storeId}`);

const addItem = (auth, body) => api().post(url('/cart/items')).set(auth).send(body);

/** Seeds a cart row directly, for the ownership and state tests. */
function seedCart(overrides = {}) {
  const row = {
    id: nextId('c'),
    customer_id: CUSTOMER_ID,
    store_id: STORE_ID,
    checked_out_at: null,
    created_at: '2026-09-17T10:00:00.000Z',
    updated_at: '2026-09-17T10:00:00.000Z',
    ...overrides,
  };
  db.tables.set('carts', [...(db.tables.get('carts') ?? []), row]);
  return row;
}

function seedCartItem(overrides = {}) {
  const row = {
    id: nextId('d'),
    cart_id: null,
    product_id: null,
    variant_id: null,
    quantity: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
  db.tables.set('cart_items', [...(db.tables.get('cart_items') ?? []), row]);
  return row;
}

describe('GET /api/v1/cart (5.1)', () => {
  it('requires a signed-in customer', async () => {
    const res = await api().get(cartUrl());

    expect(res.status).toBe(401);
  });

  it('returns an empty cart without creating one', async () => {
    const auth = signIn();

    const res = await api().get(cartUrl()).set(auth);

    expect(res.status).toBe(200);
    expect(res.body.data.cart).toMatchObject({
      storeId: STORE_ID,
      cartId: null,
      lines: [],
      isCheckoutReady: false,
    });
    expect(res.body.data.cart.totals).toMatchObject({ subtotalPaise: 0, totalPaise: 0 });
    // Browsing while signed in must not litter the table with empty carts.
    expect(db.tables.get('carts') ?? []).toEqual([]);
  });

  it('prices the cart from the live product row, not a stored price', async () => {
    const auth = signIn();
    const product = seedProduct({ price_paise: 10000 });
    await addItem(auth, { storeId: STORE_ID, productId: product.id, quantity: 2 });

    // The merchant reprices while the cart is open.
    product.price_paise = 12000;

    const { body } = await api().get(cartUrl()).set(auth);

    expect(body.data.cart.lines[0]).toMatchObject({ unitPricePaise: 12000, lineTotalPaise: 24000 });
    expect(body.data.cart.totals.subtotalPaise).toBe(24000);
  });

  it('carries the line thumbnail so the cart screen needs no second call', async () => {
    const auth = signIn();
    const product = seedProduct();
    seedProductImage({ product_id: product.id, url: 'https://img/rice.jpg', sort_order: 1 });
    await addItem(auth, { storeId: STORE_ID, productId: product.id });

    const { body } = await api().get(cartUrl()).set(auth);

    expect(body.data.cart.lines[0].imageUrl).toBe('https://img/rice.jpg');
  });

  it('is store-scoped: another store’s cart is a different basket (5.6)', async () => {
    const auth = signIn();
    seedStore({ id: OTHER_STORE_ID, slug: 'other-store' });
    const product = seedProduct();
    await addItem(auth, { storeId: STORE_ID, productId: product.id, quantity: 2 });

    const { body } = await api().get(cartUrl(OTHER_STORE_ID)).set(auth);

    expect(body.data.cart.lines).toEqual([]);
  });

  it('404s for an unknown store', async () => {
    const auth = signIn();

    const res = await api().get(cartUrl('11111111-1111-4111-8111-000000000404')).set(auth);

    expect(res.status).toBe(404);
  });

  it('422s without a storeId — a cart is always somebody’s cart at one store', async () => {
    const auth = signIn();

    const res = await api().get(url('/cart')).set(auth);

    expect(res.status).toBe(422);
  });
});

describe('POST /api/v1/cart/items (5.2, 5.7, 5.8)', () => {
  it('adds a line and creates the cart on first use', async () => {
    const auth = signIn();
    const product = seedProduct({ price_paise: 12900 });

    const res = await addItem(auth, { storeId: STORE_ID, productId: product.id, quantity: 2 });

    expect(res.status).toBe(201);
    expect(res.body.data.cart.lines).toHaveLength(1);
    expect(res.body.data.cart.lines[0]).toMatchObject({
      productId: product.id,
      name: 'Basmati Rice',
      quantity: 2,
      unitPricePaise: 12900,
      lineTotalPaise: 25800,
      isPurchasable: true,
    });
    expect(res.body.data.cart.totals.totalPaise).toBe(25800);
    expect(db.tables.get('carts')).toHaveLength(1);
  });

  it('defaults the quantity to 1', async () => {
    const auth = signIn();
    const product = seedProduct();

    const { body } = await addItem(auth, { storeId: STORE_ID, productId: product.id });

    expect(body.data.cart.lines[0].quantity).toBe(1);
  });

  it('bumps the quantity instead of creating a second identical line', async () => {
    const auth = signIn();
    const product = seedProduct();

    await addItem(auth, { storeId: STORE_ID, productId: product.id, quantity: 2 });
    const { body } = await addItem(auth, { storeId: STORE_ID, productId: product.id, quantity: 3 });

    expect(body.data.cart.lines).toHaveLength(1);
    expect(body.data.cart.lines[0].quantity).toBe(5);
  });

  it('keeps the same product under different variants on separate lines (5.7)', async () => {
    const auth = signIn();
    const product = seedProduct();
    const small = seedProductVariant({ product_id: product.id, name: '1 kg', price_paise: 12900 });
    const large = seedProductVariant({ product_id: product.id, name: '5 kg', price_paise: 59900 });

    await addItem(auth, { storeId: STORE_ID, productId: product.id, variantId: small.id });
    const { body } = await addItem(auth, {
      storeId: STORE_ID,
      productId: product.id,
      variantId: large.id,
    });

    expect(body.data.cart.lines).toHaveLength(2);
    expect(body.data.cart.lines.map((line) => line.variantName)).toEqual(['1 kg', '5 kg']);
    // The variant price is absolute, not a delta (D15).
    expect(body.data.cart.lines[1].unitPricePaise).toBe(59900);
  });

  it('keeps the no-variant line separate from a variant line of the same product', async () => {
    const auth = signIn();
    const product = seedProduct();
    const variant = seedProductVariant({ product_id: product.id, name: '1 kg' });

    await addItem(auth, { storeId: STORE_ID, productId: product.id });
    const { body } = await addItem(auth, {
      storeId: STORE_ID,
      productId: product.id,
      variantId: variant.id,
    });

    expect(body.data.cart.lines).toHaveLength(2);
  });

  it('rejects a quantity of zero, a negative and a fraction (5.8)', async () => {
    const auth = signIn();
    const product = seedProduct();

    for (const quantity of [0, -1, 1.5]) {
      const res = await addItem(auth, { storeId: STORE_ID, productId: product.id, quantity });
      expect(res.status, `quantity ${quantity}`).toBe(422);
    }
  });

  it('rejects a quantity above the per-item cap (5.8)', async () => {
    const auth = signIn();
    const product = seedProduct({ stock: null });

    const res = await addItem(auth, { storeId: STORE_ID, productId: product.id, quantity: 1000 });

    expect(res.status).toBe(422);
  });

  it('rejects more units than the store has in stock (5.8)', async () => {
    const auth = signIn();
    const product = seedProduct({ stock: 3 });

    const res = await addItem(auth, { storeId: STORE_ID, productId: product.id, quantity: 4 });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INSUFFICIENT_STOCK');
    expect(res.body.error.details).toEqual({ available: 3 });
  });

  it('counts the existing line when checking stock, not just the increment', async () => {
    const auth = signIn();
    const product = seedProduct({ stock: 3 });

    await addItem(auth, { storeId: STORE_ID, productId: product.id, quantity: 2 });
    const res = await addItem(auth, { storeId: STORE_ID, productId: product.id, quantity: 2 });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INSUFFICIENT_STOCK');
  });

  it('allows any quantity when the product is not stock-tracked', async () => {
    const auth = signIn();
    const product = seedProduct({ stock: null });

    const res = await addItem(auth, { storeId: STORE_ID, productId: product.id, quantity: 99 });

    expect(res.status).toBe(201);
  });

  it('checks the variant’s stock rather than the parent’s', async () => {
    const auth = signIn();
    const product = seedProduct({ stock: 100 });
    const variant = seedProductVariant({ product_id: product.id, stock: 2 });

    const res = await addItem(auth, {
      storeId: STORE_ID,
      productId: product.id,
      variantId: variant.id,
      quantity: 5,
    });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INSUFFICIENT_STOCK');
  });

  it('refuses a sold-out product', async () => {
    const auth = signIn();
    const product = seedProduct({ stock: 0 });

    const res = await addItem(auth, { storeId: STORE_ID, productId: product.id });

    expect(res.body.error.code).toBe('OUT_OF_STOCK');
  });

  it('refuses an unavailable product', async () => {
    const auth = signIn();
    const product = seedProduct({ is_available: false });

    const res = await addItem(auth, { storeId: STORE_ID, productId: product.id });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('PRODUCT_UNAVAILABLE');
  });

  it('refuses an unavailable variant of an available product', async () => {
    const auth = signIn();
    const product = seedProduct();
    const variant = seedProductVariant({ product_id: product.id, is_available: false });

    const res = await addItem(auth, {
      storeId: STORE_ID,
      productId: product.id,
      variantId: variant.id,
    });

    expect(res.body.error.code).toBe('VARIANT_UNAVAILABLE');
  });

  it("404s for a product belonging to another store", async () => {
    const auth = signIn();
    seedStore({ id: OTHER_STORE_ID, slug: 'other-store' });
    const foreign = seedProduct({ store_id: OTHER_STORE_ID, slug: 'foreign' });

    const res = await addItem(auth, { storeId: STORE_ID, productId: foreign.id });

    expect(res.status).toBe(404);
  });

  it("404s for a variant belonging to another product", async () => {
    const auth = signIn();
    const product = seedProduct();
    const other = seedProduct({ slug: 'other-product' });
    const foreignVariant = seedProductVariant({ product_id: other.id });

    const res = await addItem(auth, {
      storeId: STORE_ID,
      productId: product.id,
      variantId: foreignVariant.id,
    });

    expect(res.status).toBe(404);
  });

  it('rejects unknown body fields rather than dropping them (D20)', async () => {
    const auth = signIn();
    const product = seedProduct();

    const res = await addItem(auth, {
      storeId: STORE_ID,
      productId: product.id,
      unitPricePaise: 1,
    });

    expect(res.status).toBe(422);
  });
});

describe('PATCH /api/v1/cart/items/:itemId (5.3, 5.11)', () => {
  const patch = (auth, itemId, body) =>
    api().patch(url(`/cart/items/${itemId}`)).set(auth).send(body);

  it('updates the quantity and reprices the cart', async () => {
    const auth = signIn();
    const product = seedProduct({ price_paise: 10000 });
    const { body: added } = await addItem(auth, { storeId: STORE_ID, productId: product.id });
    const itemId = added.data.cart.lines[0].id;

    const res = await patch(auth, itemId, { quantity: 4 });

    expect(res.status).toBe(200);
    expect(res.body.data.cart.lines[0].quantity).toBe(4);
    expect(res.body.data.cart.totals.totalPaise).toBe(40000);
  });

  it('refuses a quantity above stock', async () => {
    const auth = signIn();
    const product = seedProduct({ stock: 3 });
    const { body: added } = await addItem(auth, { storeId: STORE_ID, productId: product.id });

    const res = await patch(auth, added.data.cart.lines[0].id, { quantity: 9 });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INSUFFICIENT_STOCK');
  });

  it('rejects a zero quantity — removing is a DELETE, not a quantity of 0', async () => {
    const auth = signIn();
    const product = seedProduct();
    const { body: added } = await addItem(auth, { storeId: STORE_ID, productId: product.id });

    const res = await patch(auth, added.data.cart.lines[0].id, { quantity: 0 });

    expect(res.status).toBe(422);
  });

  it("404s for another customer's cart item, never 403 (5.11)", async () => {
    const auth = signIn();
    const product = seedProduct();
    const foreignCart = seedCart({ id: nextId('c'), customer_id: OTHER_CUSTOMER_ID });
    const foreignItem = seedCartItem({ cart_id: foreignCart.id, product_id: product.id });

    const res = await patch(auth, foreignItem.id, { quantity: 2 });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('404s for a cart item that does not exist', async () => {
    const auth = signIn();

    const res = await patch(auth, 'd1111111-1111-4111-8111-000000009999', { quantity: 2 });

    expect(res.status).toBe(404);
  });

  it('refuses to edit a cart that has already been checked out', async () => {
    const auth = signIn();
    const product = seedProduct();
    const cart = seedCart({ checked_out_at: '2026-09-17T12:00:00.000Z' });
    const item = seedCartItem({ cart_id: cart.id, product_id: product.id });

    const res = await patch(auth, item.id, { quantity: 2 });

    expect(res.status).toBe(409);
  });
});

describe('DELETE /api/v1/cart/items/:itemId (5.4)', () => {
  it('removes the line and returns the repriced cart', async () => {
    const auth = signIn();
    const first = seedProduct({ slug: 'rice-one' });
    const second = seedProduct({ slug: 'rice-two', name: 'Toor Dal' });
    const { body: added } = await addItem(auth, { storeId: STORE_ID, productId: first.id });
    await addItem(auth, { storeId: STORE_ID, productId: second.id });

    const res = await api()
      .delete(url(`/cart/items/${added.data.cart.lines[0].id}`))
      .set(auth);

    expect(res.status).toBe(200);
    expect(res.body.data.cart.lines.map((line) => line.name)).toEqual(['Toor Dal']);
  });

  it("404s for another customer's cart item (5.11)", async () => {
    const auth = signIn();
    const product = seedProduct();
    const foreignCart = seedCart({ id: nextId('c'), customer_id: OTHER_CUSTOMER_ID });
    const foreignItem = seedCartItem({ cart_id: foreignCart.id, product_id: product.id });

    const res = await api().delete(url(`/cart/items/${foreignItem.id}`)).set(auth);

    expect(res.status).toBe(404);
    // And it is still there.
    expect(db.tables.get('cart_items')).toHaveLength(1);
  });
});

describe('DELETE /api/v1/cart (5.5)', () => {
  it('empties the cart but keeps the cart row', async () => {
    const auth = signIn();
    const product = seedProduct();
    await addItem(auth, { storeId: STORE_ID, productId: product.id });

    const res = await api().delete(cartUrl()).set(auth);

    expect(res.status).toBe(200);
    expect(res.body.data.cart.lines).toEqual([]);
    expect(db.tables.get('cart_items')).toEqual([]);
    expect(db.tables.get('carts')).toHaveLength(1);
  });

  it('only clears the named store’s cart (5.6)', async () => {
    const auth = signIn();
    seedStore({ id: OTHER_STORE_ID, slug: 'other-store' });
    const here = seedProduct();
    const there = seedProduct({ store_id: OTHER_STORE_ID, slug: 'there' });
    await addItem(auth, { storeId: STORE_ID, productId: here.id });
    await addItem(auth, { storeId: OTHER_STORE_ID, productId: there.id });

    await api().delete(cartUrl()).set(auth);

    const { body } = await api().get(cartUrl(OTHER_STORE_ID)).set(auth);
    expect(body.data.cart.lines).toHaveLength(1);
  });

  it('is a no-op on a cart that was never created', async () => {
    const auth = signIn();

    const res = await api().delete(cartUrl()).set(auth);

    expect(res.status).toBe(200);
    expect(res.body.data.cart.lines).toEqual([]);
  });
});

describe('POST /api/v1/cart/validate (5.10, 5.12)', () => {
  const validateCart = (auth, body) => api().post(url('/cart/validate')).set(auth).send(body);

  it('reports a valid cart as valid', async () => {
    const auth = signIn();
    const product = seedProduct();
    await addItem(auth, { storeId: STORE_ID, productId: product.id });

    const res = await validateCart(auth, { storeId: STORE_ID });

    expect(res.status).toBe(200);
    expect(res.body.data.cart.isValid).toBe(true);
    expect(res.body.data.cart.issues).toEqual([]);
  });

  it('flags a product that became unavailable while the cart was open', async () => {
    const auth = signIn();
    const product = seedProduct();
    await addItem(auth, { storeId: STORE_ID, productId: product.id });
    product.is_available = false;

    const { body } = await validateCart(auth, { storeId: STORE_ID });

    expect(body.data.cart.isValid).toBe(false);
    expect(body.data.cart.issues[0].code).toBe('PRODUCT_UNAVAILABLE');
    expect(body.data.cart.lines[0].isPurchasable).toBe(false);
    // An unavailable line contributes nothing to the total.
    expect(body.data.cart.totals.subtotalPaise).toBe(0);
  });

  it('flags a line whose stock dropped below the ordered quantity', async () => {
    const auth = signIn();
    const product = seedProduct({ stock: 10 });
    await addItem(auth, { storeId: STORE_ID, productId: product.id, quantity: 5 });
    product.stock = 2;

    const { body } = await validateCart(auth, { storeId: STORE_ID });

    expect(body.data.cart.issues[0]).toMatchObject({ code: 'INSUFFICIENT_STOCK', available: 2 });
  });

  it('flags a sold-out line', async () => {
    const auth = signIn();
    const product = seedProduct({ stock: 10 });
    await addItem(auth, { storeId: STORE_ID, productId: product.id });
    product.stock = 0;

    const { body } = await validateCart(auth, { storeId: STORE_ID });

    expect(body.data.cart.issues[0].code).toBe('OUT_OF_STOCK');
  });

  it('flags a price change against what the client is displaying (5.10)', async () => {
    const auth = signIn();
    const product = seedProduct({ price_paise: 10000 });
    const { body: added } = await addItem(auth, { storeId: STORE_ID, productId: product.id });
    const itemId = added.data.cart.lines[0].id;
    product.price_paise = 11000;

    const { body } = await validateCart(auth, {
      storeId: STORE_ID,
      items: [{ itemId, unitPricePaise: 10000 }],
    });

    expect(body.data.cart.isValid).toBe(false);
    expect(body.data.cart.issues[0]).toMatchObject({
      code: 'PRICE_CHANGED',
      previousUnitPricePaise: 10000,
      unitPricePaise: 11000,
    });
    // A price change does not make the line unorderable — it needs consent.
    expect(body.data.cart.lines[0].isPurchasable).toBe(true);
  });

  it('does not flag a price the client already has right', async () => {
    const auth = signIn();
    const product = seedProduct({ price_paise: 10000 });
    const { body: added } = await addItem(auth, { storeId: STORE_ID, productId: product.id });

    const { body } = await validateCart(auth, {
      storeId: STORE_ID,
      items: [{ itemId: added.data.cart.lines[0].id, unitPricePaise: 10000 }],
    });

    expect(body.data.cart.isValid).toBe(true);
  });

  it('reports every bad line at once, not just the first', async () => {
    const auth = signIn();
    const first = seedProduct({ slug: 'one' });
    const second = seedProduct({ slug: 'two', name: 'Toor Dal', stock: 5 });
    await addItem(auth, { storeId: STORE_ID, productId: first.id });
    await addItem(auth, { storeId: STORE_ID, productId: second.id, quantity: 3 });
    first.is_available = false;
    second.stock = 1;

    const { body } = await validateCart(auth, { storeId: STORE_ID });

    expect(body.data.cart.issues.map((issue) => issue.code)).toEqual([
      'PRODUCT_UNAVAILABLE',
      'INSUFFICIENT_STOCK',
    ]);
  });

  it('flags a product that was deleted outright', async () => {
    const auth = signIn();
    const product = seedProduct();
    await addItem(auth, { storeId: STORE_ID, productId: product.id });
    db.tables.set('products', []);

    const { body } = await validateCart(auth, { storeId: STORE_ID });

    expect(body.data.cart.issues[0].code).toBe('PRODUCT_REMOVED');
    expect(body.data.cart.lines[0].lineTotalPaise).toBe(0);
  });

  it('is not checkout-ready while any issue stands', async () => {
    const auth = signIn();
    const product = seedProduct();
    await addItem(auth, { storeId: STORE_ID, productId: product.id });
    product.is_available = false;

    const { body } = await validateCart(auth, { storeId: STORE_ID });

    expect(body.data.cart.isCheckoutReady).toBe(false);
  });

  it('is not checkout-ready when the cart is empty', async () => {
    const auth = signIn();

    const { body } = await validateCart(auth, { storeId: STORE_ID });

    expect(body.data.cart.isCheckoutReady).toBe(false);
    expect(body.data.cart.isValid).toBe(true);
  });
});
