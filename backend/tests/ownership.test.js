import { describe, it, expect, beforeEach, vi } from 'vitest';
import { api, url } from './helpers/app.js';
import { ALWAYS_OPEN, addToCart, createAddress, placeOrder } from './helpers/shopping.js';

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
  seedStore,
  seedCategory,
  seedProduct,
  seedSavedStore,
  seedNotification,
  seedKhataAccount,
  seedKhataTransaction,
} = await import('./helpers/supabaseMock.js');

const VICTIM = CUSTOMER_ID;
const ATTACKER = '9f8a1c2e-5b3d-4a7f-9c1e-2d4b6a8c0e99';

/**
 * Checklist 10.1 and 10.3 — the ownership audit, as tests.
 *
 * Every resource a customer owns is created for VICTIM, then reached for with
 * ATTACKER's valid session. Two things must hold for each one:
 *
 *   404, never 403 — a 403 confirms the resource exists (spec §16), and
 *   nothing of the victim's appears in the attacker's own list responses.
 *
 * Both customers are real, signed-in accounts. Nothing here tests "a stranger
 * cannot read data"; it tests that a legitimate customer cannot read someone
 * else's, which is the failure that actually happens.
 */

beforeEach(() => {
  resetDb();
  vi.clearAllMocks();
  seedCustomer({ id: VICTIM, email: 'victim@cpse.local', full_name: 'Victim Customer' });
  seedCustomer({ id: ATTACKER, email: 'attacker@cpse.local', full_name: 'Attacker Customer' });
  seedStore({ opening_hours: ALWAYS_OPEN, min_order_paise: 0 });
  seedCategory();
});

function signIn(id) {
  supabaseAdmin.auth.getUser.mockResolvedValue({ data: { user: { id } }, error: null });
  return { Authorization: 'Bearer token-abc' };
}

/** Everything the victim owns, built through the real endpoints where possible. */
async function seedVictimsWorld() {
  const auth = signIn(VICTIM);
  const product = seedProduct({ price_paise: 25000, stock: 100 });

  const { body: addressBody } = await createAddress(auth, { label: 'Victim home' });
  const address = addressBody.data.address;

  await addToCart(auth, { storeId: STORE_ID, productId: product.id, quantity: 3 });
  const { body: orderBody } = await placeOrder(auth, { storeId: STORE_ID });
  const order = orderBody.data.order;

  // Checkout consumes the cart, so the victim starts a new one — that live line
  // is what the attacker will try to reach.
  await addToCart(auth, { storeId: STORE_ID, productId: product.id, quantity: 2 });
  const cartItemId = db.tables.get('cart_items').at(-1).id;

  seedSavedStore({ customer_id: VICTIM });
  const notification = seedNotification({ customer_id: VICTIM, title: 'Victim notification' });

  const khata = seedKhataAccount({ customer_id: VICTIM });
  seedKhataTransaction({ account_id: khata.id, type: 'debit', amount_paise: 30000 });

  return { address, cartItemId, order, notification, khata, product };
}

describe('10.1 — another customer’s resource is a 404, never a 403', () => {
  it.each([
    ['GET    address', (w) => ['get', `/addresses/${w.address.id}`]],
    ['PATCH  address', (w) => ['patch', `/addresses/${w.address.id}`]],
    ['DELETE address', (w) => ['delete', `/addresses/${w.address.id}`]],
    ['POST   address default', (w) => ['post', `/addresses/${w.address.id}/default`]],
    ['PATCH  cart item', (w) => ['patch', `/cart/items/${w.cartItemId}`]],
    ['DELETE cart item', (w) => ['delete', `/cart/items/${w.cartItemId}`]],
    ['GET    order', (w) => ['get', `/orders/${w.order.id}`]],
    ['GET    order receipt', (w) => ['get', `/orders/${w.order.id}/receipt`]],
    ['POST   order cancel', (w) => ['post', `/orders/${w.order.id}/cancel`]],
    ['POST   order reorder', (w) => ['post', `/orders/${w.order.id}/reorder`]],
    ['POST   order advance', (w) => ['post', `/orders/${w.order.id}/test-advance`]],
    ['POST   payment initiate', (w) => ['post', `/payments/${w.order.id}/initiate`]],
    ['POST   payment verify', (w) => ['post', `/payments/${w.order.id}/verify`]],
    ['POST   notification read', (w) => ['post', `/notifications/${w.notification.id}/read`]],
    ['GET    khata account', (w) => ['get', `/khata/${w.khata.id}`]],
    ['GET    khata statement', (w) => ['get', `/khata/${w.khata.id}/statement`]],
  ])('%s', async (_label, build) => {
    const world = await seedVictimsWorld();
    const auth = signIn(ATTACKER);
    const [method, path] = build(world);

    const body =
      method === 'patch' && path.includes('/cart/items')
        ? { quantity: 5 }
        : method === 'patch'
          ? { label: 'Taken over' }
          : method === 'post' && path.includes('test-advance')
            ? { status: 'accepted' }
            : method === 'post' && path.includes('verify')
              ? { providerRef: 'mock_x' }
              : {};

    const res = await api()[method](url(path)).set(auth).send(
      method === 'get' || method === 'delete' ? undefined : body,
    );

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    // The message must not confirm what was asked for either.
    expect(JSON.stringify(res.body)).not.toContain('Victim');
  });

  it('leaves the victim’s data untouched after every attempt', async () => {
    const world = await seedVictimsWorld();
    const attacker = signIn(ATTACKER);

    await api().patch(url(`/addresses/${world.address.id}`)).set(attacker).send({ label: 'Taken' });
    await api().delete(url(`/addresses/${world.address.id}`)).set(attacker);
    await api().post(url(`/orders/${world.order.id}/cancel`)).set(attacker).send({});
    await api().patch(url(`/cart/items/${world.cartItemId}`)).set(attacker).send({ quantity: 99 });
    await api().post(url(`/notifications/${world.notification.id}/read`)).set(attacker).send({});

    expect(db.tables.get('addresses')).toHaveLength(1);
    expect(db.tables.get('addresses')[0].label).toBe('Victim home');
    expect(db.tables.get('orders')[0].status).toBe('placed');
    expect(db.tables.get('cart_items')[0].quantity).toBe(2);
    const victimNotification = db.tables
      .get('notifications')
      .find((row) => row.id === world.notification.id);
    expect(victimNotification.read_at).toBeNull();
  });
});

describe('10.3 — no cross-customer data in any list response', () => {
  it('the attacker’s lists are all empty while the victim’s are not', async () => {
    await seedVictimsWorld();
    const attacker = signIn(ATTACKER);

    const [addresses, orders, notifications, khata, saved, cart] = await Promise.all([
      api().get(url('/addresses')).set(attacker),
      api().get(url('/orders')).set(attacker),
      api().get(url('/notifications')).set(attacker),
      api().get(url('/khata')).set(attacker),
      api().get(url('/saved-stores')).set(attacker),
      api().get(url(`/cart?storeId=${STORE_ID}`)).set(attacker),
    ]);

    expect(addresses.body.data.addresses).toEqual([]);
    expect(orders.body.data.orders).toEqual([]);
    expect(notifications.body.data.notifications).toEqual([]);
    expect(notifications.body.data.unreadCount).toBe(0);
    expect(khata.body.data.accounts).toEqual([]);
    expect(khata.body.data.totalOutstandingPaise).toBe(0);
    expect(saved.body.data.savedStores).toEqual([]);
    expect(cart.body.data.cart.lines).toEqual([]);

    // And the victim still sees their own.
    const victim = signIn(VICTIM);
    expect((await api().get(url('/addresses')).set(victim)).body.data.addresses).toHaveLength(1);
    expect((await api().get(url('/orders')).set(victim)).body.data.orders).toHaveLength(1);
  });

  it('no response body mentions the other customer at all', async () => {
    await seedVictimsWorld();
    const attacker = signIn(ATTACKER);

    const responses = await Promise.all(
      [
        '/me',
        '/addresses',
        '/orders',
        '/notifications',
        '/notifications/unread-count',
        '/khata',
        '/saved-stores',
        `/cart?storeId=${STORE_ID}`,
        '/stores/sharma-kirana',
      ].map((path) => api().get(url(path)).set(attacker)),
    );

    for (const res of responses) {
      const text = JSON.stringify(res.body);
      expect(text).not.toContain(VICTIM);
      expect(text).not.toContain('victim@cpse.local');
      expect(text).not.toContain('Victim');
    }
  });

  it('the attacker’s own cart at the same store is a different cart', async () => {
    const world = await seedVictimsWorld();
    const attacker = signIn(ATTACKER);

    await addToCart(attacker, { storeId: STORE_ID, productId: world.product.id, quantity: 1 });

    const mine = await api().get(url(`/cart?storeId=${STORE_ID}`)).set(attacker);
    expect(mine.body.data.cart.lines).toHaveLength(1);
    expect(mine.body.data.cart.lines[0].quantity).toBe(1);

    const theirs = await api().get(url(`/cart?storeId=${STORE_ID}`)).set(signIn(VICTIM));
    // The victim checked out, so theirs is empty — and certainly not the
    // attacker's line.
    expect(theirs.body.data.cart.cartId).not.toBe(mine.body.data.cart.cartId);
  });
});

describe('10.3 — responses never leak internal columns', () => {
  /** Walks a payload and collects every key, at every depth. */
  function allKeys(value, found = new Set()) {
    if (Array.isArray(value)) {
      for (const entry of value) allKeys(entry, found);
    } else if (value && typeof value === 'object') {
      for (const [key, nested] of Object.entries(value)) {
        found.add(key);
        allKeys(nested, found);
      }
    }
    return found;
  }

  /**
   * Columns that must never reach a client: another customer's handle on the
   * row, our idempotency bookkeeping, and the provider's raw payload.
   */
  const FORBIDDEN = [
    'customer_id',
    'customerId',
    'idempotency_key',
    'idempotencyKey',
    'raw_payload',
    'rawPayload',
    'service_role',
    'cart_id',
  ];

  it('no endpoint returns a forbidden key, and none returns snake_case', async () => {
    const world = await seedVictimsWorld();
    const auth = signIn(VICTIM);

    const paths = [
      '/me',
      '/addresses',
      `/addresses/${world.address.id}`,
      '/stores/sharma-kirana',
      '/stores/sharma-kirana/categories',
      '/stores/sharma-kirana/products',
      `/stores/sharma-kirana/products/${world.product.id}`,
      '/stores/sharma-kirana/search?q=ri',
      `/cart?storeId=${STORE_ID}`,
      '/orders',
      `/orders/${world.order.id}`,
      `/orders/${world.order.id}/receipt`,
      '/notifications',
      '/khata',
      `/khata/${world.khata.id}`,
      `/khata/${world.khata.id}/statement`,
      '/saved-stores',
      '/payments/methods',
    ];

    for (const path of paths) {
      const res = await api().get(url(path)).set(auth);
      expect(res.status, path).toBe(200);

      const keys = [...allKeys(res.body.data)];
      for (const forbidden of FORBIDDEN) {
        expect(keys, `${path} leaked ${forbidden}`).not.toContain(forbidden);
      }
      // The API speaks camelCase; a snake_case key means a raw row escaped.
      // `payload` on a notification is a free-form jsonb blob whose keys are
      // deliberately snake_case deep-link ids, so it is excluded.
      const snake = keys.filter(
        (key) => /_/.test(key) && !['order_id', 'order_number', 'store_id', 'khata_account_id', 'status'].includes(key),
      );
      expect(snake, `${path} returned raw columns`).toEqual([]);
    }
  });

  it('a payment response carries no provider internals', async () => {
    const auth = signIn(VICTIM);
    const product = seedProduct({ price_paise: 25000, stock: 10 });
    await addToCart(auth, { storeId: STORE_ID, productId: product.id, quantity: 1 });
    const { body } = await placeOrder(auth, { storeId: STORE_ID, paymentMethod: 'online' });

    const res = await api().post(url(`/payments/${body.data.order.id}/initiate`)).set(auth);

    expect(res.status).toBe(200);
    const text = JSON.stringify(res.body);
    expect(text).not.toContain('raw_payload');
    expect(text).not.toContain(VICTIM);
  });
});

describe('10.1 — a token cannot be pointed at another account', () => {
  it('ignores a customerId sent in the body of PATCH /me', async () => {
    const auth = signIn(ATTACKER);

    const res = await api()
      .patch(url('/me'))
      .set(auth)
      .send({ fullName: 'Renamed', id: VICTIM });

    // D20: an immutable field is a 422, not a silent no-op.
    expect(res.status).toBe(422);
    expect(db.customers.get(VICTIM).full_name).toBe('Victim Customer');
  });

  it('ignores a customerId sent in a query string', async () => {
    await seedVictimsWorld();
    const auth = signIn(ATTACKER);

    const res = await api().get(url(`/orders?customerId=${VICTIM}`)).set(auth);

    // The unknown parameter is rejected outright rather than honoured.
    expect(res.status).toBe(422);
  });

  it('scopes a cart to the caller even when a storeId is shared', async () => {
    await seedVictimsWorld();

    const attackerCart = await api().get(url(`/cart?storeId=${STORE_ID}`)).set(signIn(ATTACKER));

    expect(attackerCart.status).toBe(200);
    expect(attackerCart.body.data.cart.lines).toEqual([]);
  });
});
