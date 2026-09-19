import { describe, it, expect, beforeEach, vi } from 'vitest';
import crypto from 'node:crypto';
import { api, url } from './helpers/app.js';
import { ALWAYS_OPEN } from './helpers/shopping.js';

vi.mock('../src/lib/supabase.js', async () => {
  const { createSupabaseMock } = await import('./helpers/supabaseMock.js');
  return createSupabaseMock();
});

const { supabaseAdmin } = await import('../src/lib/supabase.js');
const {
  CUSTOMER_ID,
  STORE_ID,
  resetDb,
  seedCustomer,
  seedStore,
  seedCategory,
  seedProduct,
  seedProductImage,
  seedProductVariant,
  seedKhataAccount,
  seedKhataTransaction,
} = await import('./helpers/supabaseMock.js');
const { env } = await import('../src/config/env.js');

/**
 * The whole customer journey, end to end, in the order a customer walks it:
 *
 *   store link → store page → save the store → categories → product list →
 *   product detail → cart → address → checkout quote → order → payment →
 *   notifications → order history → order status → receipt → reorder → khata
 *
 * The per-module suites cover the edges. This one is the seam test: it fails
 * if any two steps stop fitting together, which is the failure the unit-level
 * tests cannot see.
 */

beforeEach(() => {
  resetDb();
  vi.clearAllMocks();
  seedCustomer();
  seedStore({ opening_hours: ALWAYS_OPEN, min_order_paise: 19900, delivery_fee_paise: 2900 });
  seedCategory();
});

const auth = { Authorization: 'Bearer token-abc' };

function signIn() {
  supabaseAdmin.auth.getUser.mockResolvedValue({ data: { user: { id: CUSTOMER_ID } }, error: null });
}

describe('the customer journey', () => {
  it('walks from a shared store link to a completed pickup order', async () => {
    const product = seedProduct({ name: 'Basmati Rice', price_paise: 12500, stock: 20 });
    seedProductImage({ product_id: product.id, url: 'https://img/rice.jpg' });

    // 1. Store discovery — a plain shared link, no session at all.
    const storePage = await api().get(url('/stores/sharma-kirana'));
    expect(storePage.status).toBe(200);
    expect(storePage.body.data.store.hours.isOpen).toBe(true);
    expect(storePage.body.data.store.isSaved).toBeNull();

    // 2. Categories, still anonymous.
    const categories = await api().get(url('/stores/sharma-kirana/categories'));
    expect(categories.body.data.categories).toHaveLength(1);
    const categoryId = categories.body.data.categories[0].id;

    // 3. Product listing, filtered by that category.
    const listing = await api().get(
      url(`/stores/sharma-kirana/products?categoryId=${categoryId}`),
    );
    expect(listing.body.data.products[0]).toMatchObject({
      name: 'Basmati Rice',
      isPurchasable: true,
      imageUrl: 'https://img/rice.jpg',
    });

    // 4. Product detail.
    const detail = await api().get(url(`/stores/sharma-kirana/products/${product.id}`));
    expect(detail.body.data.product.images).toHaveLength(1);

    // 5. Signing in and filling the cart.
    signIn();
    const added = await api()
      .post(url('/cart/items'))
      .set(auth)
      .send({ storeId: STORE_ID, productId: product.id, quantity: 2 });
    expect(added.status).toBe(201);
    expect(added.body.data.cart.totals.totalPaise).toBe(25000);

    // 6. Validating the cart before checkout.
    const validated = await api()
      .post(url('/cart/validate'))
      .set(auth)
      .send({ storeId: STORE_ID });
    expect(validated.body.data.cart.isValid).toBe(true);

    // 7. Quoting for pickup.
    const quoted = await api()
      .post(url('/checkout/quote'))
      .set(auth)
      .send({ storeId: STORE_ID, fulfilmentMode: 'pickup' });
    expect(quoted.body.data.quote.canPlaceOrder).toBe(true);
    expect(quoted.body.data.quote.totals.totalPaise).toBe(25000);

    // 8. Placing it, with the total the customer was just shown.
    const placed = await api()
      .post(url('/orders'))
      .set(auth)
      .set('Idempotency-Key', 'journey-key-1')
      .send({
        storeId: STORE_ID,
        fulfilmentMode: 'pickup',
        paymentMethod: 'cash',
        expectedTotalPaise: quoted.body.data.quote.totals.totalPaise,
      });
    expect(placed.status).toBe(201);
    const orderId = placed.body.data.order.id;

    // The cart is empty and the stock has moved.
    const emptied = await api().get(url(`/cart?storeId=${STORE_ID}`)).set(auth);
    expect(emptied.body.data.cart.lines).toEqual([]);

    // 9. Order history.
    const history = await api().get(url('/orders')).set(auth);
    expect(history.body.data.orders.map((order) => order.id)).toEqual([orderId]);

    // 10. Order status, all the way to completed.
    for (const status of ['accepted', 'preparing', 'ready_for_pickup', 'completed']) {
      const advanced = await api()
        .post(url(`/orders/${orderId}/test-advance`))
        .set(auth)
        .send({ status });
      expect(advanced.status, status).toBe(200);
    }

    const finished = await api().get(url(`/orders/${orderId}`)).set(auth);
    expect(finished.body.data.order.status).toBe('completed');
    expect(finished.body.data.order.isCancellable).toBe(false);
    expect(finished.body.data.order.timeline.steps.every((step) => step.reachedAt)).toBe(true);

    // 11. Receipt.
    const receipt = await api().get(url(`/orders/${orderId}/receipt`)).set(auth);
    expect(receipt.body.data.receipt.totals.totalPaise).toBe(25000);

    // 12. Reorder puts it all back in the cart.
    const again = await api().post(url(`/orders/${orderId}/reorder`)).set(auth);
    expect(again.body.data.isComplete).toBe(true);
    expect(again.body.data.cart.totals.totalPaise).toBe(25000);
  });

  it('walks a paid online delivery order from search to out-for-delivery', async () => {
    const product = seedProduct({ name: 'Toor Dal', slug: 'toor-dal', price_paise: 10000, stock: 20 });
    const variant = seedProductVariant({
      product_id: product.id,
      name: '5 kg',
      price_paise: 24000,
      stock: 5,
    });

    // 1. Finding it by search rather than by browsing.
    const found = await api().get(url('/stores/sharma-kirana/search?q=dal'));
    expect(found.body.data.products.map((row) => row.name)).toEqual(['Toor Dal']);

    signIn();

    // 2. Adding the 5 kg variant — an absolute price, not a delta.
    await api()
      .post(url('/cart/items'))
      .set(auth)
      .send({ storeId: STORE_ID, productId: product.id, variantId: variant.id });

    // 3. An address, which becomes the default automatically.
    const address = await api().post(url('/addresses')).set(auth).send({
      recipientName: 'Aditya Suresh',
      phone: '+919876543210',
      line1: '221B Model Town',
      city: 'Ludhiana',
      state: 'Punjab',
      postalCode: '141002',
    });
    expect(address.body.data.address.isDefault).toBe(true);
    const addressId = address.body.data.address.id;

    // 4. Quoting for delivery adds the fee.
    const quoted = await api()
      .post(url('/checkout/quote'))
      .set(auth)
      .send({ storeId: STORE_ID, fulfilmentMode: 'delivery', addressId });
    expect(quoted.body.data.quote.totals).toMatchObject({
      subtotalPaise: 24000,
      deliveryFeePaise: 2900,
      totalPaise: 26900,
    });

    // 5. Placing it online leaves it awaiting payment.
    const placed = await api().post(url('/orders')).set(auth).send({
      storeId: STORE_ID,
      fulfilmentMode: 'delivery',
      addressId,
      paymentMethod: 'online',
    });
    const orderId = placed.body.data.order.id;
    expect(placed.body.data.order.status).toBe('pending_payment');

    // 6. Initiating gives the client the gateway payload.
    const initiated = await api().post(url(`/payments/${orderId}/initiate`)).set(auth);
    const providerRef = initiated.body.data.payment.providerRef;
    expect(initiated.body.data.clientPayload.checkoutUrl).toContain(providerRef);

    // 7. The gateway's signed webhook is what actually places the order.
    const event = { event: 'success', providerRef, amountPaise: 26900 };
    const raw = JSON.stringify(event);
    const webhook = await api()
      .post(url('/payments/webhook'))
      .set('Content-Type', 'application/json')
      .set(
        'X-CPSE-Signature',
        crypto.createHmac('sha256', env.PAYMENT_WEBHOOK_SECRET).update(raw).digest('hex'),
      )
      .send(raw);
    expect(webhook.body.data).toMatchObject({ applied: true, status: 'paid' });

    const paid = await api().get(url(`/orders/${orderId}`)).set(auth);
    expect(paid.body.data.order.status).toBe('placed');
    expect(paid.body.data.order.paymentStatus).toBe('paid');

    // 8. Through to the rider.
    for (const status of ['accepted', 'preparing', 'out_for_delivery']) {
      await api().post(url(`/orders/${orderId}/test-advance`)).set(auth).send({ status });
    }

    const enRoute = await api().get(url(`/orders/${orderId}`)).set(auth);
    expect(enRoute.body.data.order.status).toBe('out_for_delivery');
    expect(enRoute.body.data.order.fulfilment.address.line1).toBe('221B Model Town');
    // A paid order that is already on its way cannot be cancelled by the app.
    const cancelled = await api().post(url(`/orders/${orderId}/cancel`)).set(auth).send({});
    expect(cancelled.status).toBe(409);
  });

  it('walks the Phase 9 screens: save a store, read notifications, open the khata', async () => {
    const product = seedProduct({ name: 'Basmati Rice', price_paise: 25000, stock: 20 });

    // 1. A shared link, then the heart button — which needs a session.
    const anonymous = await api().get(url('/stores/sharma-kirana'));
    expect(anonymous.body.data.store.isSaved).toBeNull();

    const refused = await api().post(url(`/stores/${STORE_ID}/save`));
    expect(refused.status).toBe(401);

    signIn();
    const saved = await api().post(url(`/stores/${STORE_ID}/save`)).set(auth);
    expect(saved.body.data.store.isSaved).toBe(true);

    // Tapping it twice is not an error, and does not save it twice.
    await api().post(url(`/stores/${STORE_ID}/save`)).set(auth);
    const savedList = await api().get(url('/saved-stores')).set(auth);
    expect(savedList.body.data.savedStores).toHaveLength(1);
    // The list carries the slug, so the screen can link straight back.
    expect(savedList.body.data.savedStores[0].store.slug).toBe('sharma-kirana');

    // The store page now reflects it.
    const personalised = await api().get(url('/stores/sharma-kirana')).set(auth);
    expect(personalised.body.data.store.isSaved).toBe(true);

    // 2. Nothing has happened yet, so there is nothing to read.
    const quiet = await api().get(url('/notifications')).set(auth);
    expect(quiet.body.data.notifications).toEqual([]);
    expect(quiet.body.data.unreadCount).toBe(0);

    // 3. Placing an order, then advancing it, writes the notifications.
    await api()
      .post(url('/cart/items'))
      .set(auth)
      .send({ storeId: STORE_ID, productId: product.id, quantity: 1 });
    const placed = await api()
      .post(url('/orders'))
      .set(auth)
      .send({ storeId: STORE_ID, fulfilmentMode: 'pickup', paymentMethod: 'cash' });
    const orderId = placed.body.data.order.id;
    const orderNumber = placed.body.data.order.orderNumber;

    await api().post(url(`/orders/${orderId}/test-advance`)).set(auth).send({ status: 'accepted' });

    const inbox = await api().get(url('/notifications')).set(auth);
    expect(inbox.body.data.unreadCount).toBe(2);
    expect(inbox.body.data.notifications.map((entry) => entry.type)).toEqual([
      'order_status_changed',
      'order_placed',
    ]);
    // Newest first, and each one can be opened straight to the order.
    expect(inbox.body.data.notifications[0].payload.order_id).toBe(orderId);
    expect(inbox.body.data.notifications[0].title).toContain(orderNumber);

    // 4. The badge, then reading one, then reading the rest.
    const badge = await api().get(url('/notifications/unread-count')).set(auth);
    expect(badge.body.data.unreadCount).toBe(2);

    const first = inbox.body.data.notifications[0].id;
    const read = await api().post(url(`/notifications/${first}/read`)).set(auth);
    expect(read.body.data.notification.isRead).toBe(true);
    expect((await api().get(url('/notifications/unread-count')).set(auth)).body.data.unreadCount).toBe(1);

    const readAll = await api().post(url('/notifications/read-all')).set(auth);
    expect(readAll.body.data).toMatchObject({ updated: 1, unreadCount: 0 });

    const unreadOnly = await api().get(url('/notifications?unreadOnly=true')).set(auth);
    expect(unreadOnly.body.data.notifications).toEqual([]);

    // 5. The khata the merchant side keeps: readable, and only readable.
    const account = seedKhataAccount({ store_id: STORE_ID });
    seedKhataTransaction({
      account_id: account.id,
      type: 'debit',
      amount_paise: 50000,
      description: 'August groceries',
      occurred_at: '2026-08-20T10:00:00.000Z',
    });
    seedKhataTransaction({
      account_id: account.id,
      type: 'credit',
      amount_paise: 20000,
      description: 'Part payment',
      occurred_at: '2026-09-10T10:00:00.000Z',
    });

    const khataList = await api().get(url('/khata')).set(auth);
    expect(khataList.body.data.totalOutstandingPaise).toBe(30000);
    expect(khataList.body.data.accounts[0].store.name).toBe('Sharma Kirana Store');

    const detail = await api().get(url(`/khata/${account.id}`)).set(auth);
    expect(detail.body.data.totals).toMatchObject({
      openingPaise: 0,
      debitPaise: 50000,
      creditPaise: 20000,
      outstandingPaise: 30000,
    });
    expect(detail.body.data.transactions).toHaveLength(2);

    // September only: August's debit is what the period opens with.
    const statement = await api()
      .get(url(`/khata/${account.id}/statement?from=2026-09-01T00:00:00Z`))
      .set(auth);
    expect(statement.body.data.totals).toMatchObject({
      openingPaise: 50000,
      debitPaise: 0,
      creditPaise: 20000,
      closingPaise: 30000,
      transactionCount: 1,
    });

    // 6. And there is no way to pay it off through this API (9.9).
    const write = await api()
      .post(url(`/khata/${account.id}/transactions`))
      .set(auth)
      .send({ type: 'credit', amountPaise: 30000 });
    expect(write.status).toBe(404);

    const unsaved = await api().delete(url(`/stores/${STORE_ID}/save`)).set(auth);
    expect(unsaved.body.data.store.isSaved).toBe(false);
    expect((await api().get(url('/saved-stores')).set(auth)).body.data.savedStores).toEqual([]);
  });

  it('keeps two stores’ carts and orders apart the whole way through', async () => {
    const OTHER_STORE_ID = '11111111-1111-4111-8111-000000000002';
    seedStore({ id: OTHER_STORE_ID, slug: 'other-store', opening_hours: ALWAYS_OPEN, min_order_paise: 0 });
    const here = seedProduct({ price_paise: 20000, stock: 10 });
    const there = seedProduct({ store_id: OTHER_STORE_ID, slug: 'there', name: 'Ghee', price_paise: 30000, stock: 10 });

    signIn();
    await api().post(url('/cart/items')).set(auth).send({ storeId: STORE_ID, productId: here.id });
    await api()
      .post(url('/cart/items'))
      .set(auth)
      .send({ storeId: OTHER_STORE_ID, productId: there.id });

    const first = await api().get(url(`/cart?storeId=${STORE_ID}`)).set(auth);
    const second = await api().get(url(`/cart?storeId=${OTHER_STORE_ID}`)).set(auth);
    expect(first.body.data.cart.totals.totalPaise).toBe(20000);
    expect(second.body.data.cart.totals.totalPaise).toBe(30000);

    // Ordering from one store leaves the other basket alone.
    await api()
      .post(url('/orders'))
      .set(auth)
      .send({ storeId: STORE_ID, fulfilmentMode: 'pickup', paymentMethod: 'cash' });

    const untouched = await api().get(url(`/cart?storeId=${OTHER_STORE_ID}`)).set(auth);
    expect(untouched.body.data.cart.lines).toHaveLength(1);

    const orders = await api().get(url(`/orders?storeId=${OTHER_STORE_ID}`)).set(auth);
    expect(orders.body.data.orders).toEqual([]);
  });
});
