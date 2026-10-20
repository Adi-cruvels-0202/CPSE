import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../src/context/AuthContext.jsx';
import { AppRoutes } from '../src/router.jsx';
import { writeSession } from '../src/lib/tokens.js';
import {
  addressFixture,
  cartFixture,
  created,
  customerFixture,
  fail,
  mockRoutes,
  ok,
  orderDetailFixture,
  orderFixture,
  paymentMethodsFixture,
  quoteFixture,
  receiptFixture,
  sessionFixture,
  storeFixture,
} from './helpers/api.js';

/**
 * The customer side of the roadmap's later phases (§5 P2–P5): refunds and
 * substitutions on an order, coupons/points/khata at checkout, quick checkout
 * and the usual basket, repeat shopping, lists, preferences, points and
 * messages — each against the payloads the backend actually returns.
 */

const ROUTER_FUTURE = { v7_startTransition: true, v7_relativeSplatPath: true };
const STORE_ID = '11111111-1111-4111-8111-000000000001';
const PRODUCT = { id: 'p-1', storeId: STORE_ID, name: 'Basmati Rice', pricePaise: 12900, isPurchasable: true, stock: 10, imageUrl: null, defaultVariantId: 'v-1', store: { id: STORE_ID, slug: 'sharma-kirana', name: 'Sharma Kirana Store' } };

function renderAt(path, routes = {}, { signedIn = true } = {}) {
  if (signedIn) writeSession(sessionFixture());
  const mocked = mockRoutes({ '/me': ok({ customer: customerFixture() }), '/notifications/unread-count': ok({ unreadCount: 0 }), ...routes });
  return {
    user: userEvent.setup(),
    ...mocked,
    ...render(
      <MemoryRouter initialEntries={[path]} future={ROUTER_FUTURE}>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </MemoryRouter>,
    ),
  };
}

const byMethod = (calls, method, part) => calls.filter((c) => c.method === method && c.url.includes(part));

afterEach(() => vi.unstubAllGlobals());

// ── Orders: refunds and substitutions ───────────────────────────────────────

const refund = {
  id: 'r-1', orderId: 'order-1', kind: 'cancellation', status: 'processing', statusLabel: 'Being processed', amountPaise: 25800,
  method: 'provider', methodLabel: 'Back to the account you paid from', reference: 'rfnd_42', reason: 'Store rejected the order',
  failureReason: null, nextStep: 'Banks usually show it in 5–7 working days.', isFinal: false,
  events: [
    { fromStatus: null, toStatus: 'initiated', label: 'Refund started', source: 'system', note: null, at: '2026-09-20T17:00:00Z' },
    { fromStatus: 'initiated', toStatus: 'processing', label: 'Being processed', source: 'provider', note: null, at: '2026-09-20T17:05:00Z' },
  ],
};

describe('refund tracking on an order', () => {
  it('shows the amount, where it goes, its progress and reference', async () => {
    renderAt('/orders/order-1', {
      '/orders/order-1': ok({ order: orderDetailFixture({ status: 'cancelled', statusLabel: 'Cancelled', paymentStatus: 'paid', isCancellable: false, refund, refundAdjustments: [] }) }),
    });
    const card = await screen.findByTestId('refund');
    expect(card).toHaveTextContent('Refund of ₹258.00');
    expect(card).toHaveTextContent('Back to the account you paid from');
    expect(card).toHaveTextContent('Reference: rfnd_42');
    expect(card).toHaveTextContent('Why: Store rejected the order');
    expect(within(card).getByRole('list', { name: 'Refund progress' }).children).toHaveLength(2);
    // The generic "will be refunded" notice is for orders without a refund record.
    expect(screen.queryByText(/will be refunded to the account you paid from/)).not.toBeInTheDocument();
  });

  it('shows the refund on the receipt', async () => {
    renderAt('/orders/order-1/receipt', {
      '/orders/order-1/receipt': ok({ receipt: receiptFixture({ status: 'cancelled', refund: { status: 'refunded', statusLabel: 'Refunded', amountPaise: 25800, method: 'khata_credit', reference: null, refundedAt: '2026-09-21T10:00:00Z' } }) }),
    });
    const block = await screen.findByTestId('receipt-refund');
    expect(block).toHaveTextContent('₹258.00');
    expect(block).toHaveTextContent('Your khata with this shop');
    expect(block).toHaveTextContent('Refunded');
  });

  it('says GST is added on top, as the receipt shows it', async () => {
    renderAt('/orders/order-1/receipt', { '/orders/order-1/receipt': ok({ receipt: receiptFixture() }) });
    expect(await screen.findByText(/Item prices are before GST, which is shown on its own line\./)).toBeInTheDocument();
    expect(screen.queryByText(/Prices include tax/)).not.toBeInTheDocument();
  });
});

describe('substitutions', () => {
  const sub = (over = {}) => ({
    id: 's-1', orderId: 'order-1', orderItemId: 'item-1', original: { name: 'Basmati Rice', variantName: '1 kg', quantity: 2, unitPricePaise: 12900 },
    proposed: { productId: 'p-2', variantId: 'v-2', name: 'Sona Masoori Rice', variantName: '1 kg', quantity: 2, unitPricePaise: 11000, linePaise: 22000 },
    originalLinePaise: 25800, savingPaise: 3800, merchantNote: 'Basmati is out today', customerNote: null, status: 'pending', autoApproved: false, createdAt: '2026-09-20T16:30:00Z', ...over,
  });

  it('the customer accepts a replacement with a note, and sees the result', async () => {
    let current = sub();
    const { user, calls } = renderAt('/orders/order-1', {
      '/orders/order-1': () => ok({ order: orderDetailFixture({ substitutions: [current] }) }),
      '/substitutions/s-1/respond': ({ options }) => {
        current = sub({ status: 'approved', customerNote: JSON.parse(options.body).note });
        return ok({ substitution: current });
      },
    });
    const row = await screen.findByTestId('substitution');
    expect(row).toHaveTextContent('you pay ₹38.00 less');
    expect(row).toHaveTextContent('The shop says: “Basmati is out today”');
    await user.type(within(row).getByRole('textbox'), 'Fine, thanks');
    await user.click(within(row).getByRole('button', { name: 'Accept' }));
    expect(byMethod(calls, 'POST', '/substitutions/s-1/respond')[0].body).toEqual({ approve: true, note: 'Fine, thanks' });
    await waitFor(() => expect(screen.getByTestId('substitution')).toHaveTextContent('Accepted'));
    expect(within(screen.getByTestId('substitution')).queryByRole('button', { name: 'Accept' })).not.toBeInTheDocument();
  });

  it('shows why a response was refused', async () => {
    const { user } = renderAt('/orders/order-1', {
      '/orders/order-1': ok({ order: orderDetailFixture({ substitutions: [sub()] }) }),
      '/substitutions/s-1/respond': fail(409, 'SUBSTITUTION_CLOSED', 'The shop withdrew this suggestion.'),
    });
    await user.click(await screen.findByRole('button', { name: 'Decline' }));
    expect(await screen.findByText('The shop withdrew this suggestion.')).toBeInTheDocument();
  });
});

// ── Checkout benefits ───────────────────────────────────────────────────────

function checkoutRoutes({ quote = () => ok({ quote: quoteFixture() }), store = storeFixture(), khata = [], loyalty = null, coupons = [] } = {}) {
  return {
    '/cart': ok({ cart: cartFixture() }),
    '/stores/sharma-kirana': ok({ store }),
    '/stores/sharma-kirana/offers': ok({ offers: [], coupons }),
    [`/stores/${STORE_ID}/loyalty`]: loyalty ? ok({ loyalty }) : fail(404, 'NOT_FOUND', 'No loyalty.'),
    '/me/preferences': ok({ preferences: { preferredSubstitution: 'allow_similar' } }),
    '/khata': ok({ accounts: khata }),
    '/addresses': ok({ addresses: [addressFixture()] }),
    '/payments/methods': ok(paymentMethodsFixture()),
    '/checkout/quote': quote,
    '/orders': created({ order: orderFixture() }),
    '/orders/order-1': ok({ order: orderDetailFixture() }),
  };
}

describe('coupons and points at checkout', () => {
  it('a coupon re-prices the order through the quote and goes with the order', async () => {
    const quote = ({ options }) => {
      const body = JSON.parse(options.body);
      return ok({
        quote: body.couponCode
          ? quoteFixture({ totals: { ...quoteFixture().totals, discountPaise: 2580, totalPaise: 23220 }, benefits: { coupon: { code: body.couponCode, applies: true, discountPaise: 2580 }, loyalty: null } })
          : quoteFixture(),
      });
    };
    const { user, calls } = renderAt(`/checkout/${STORE_ID}`, checkoutRoutes({ quote, coupons: [{ id: 'c-1', code: 'WELCOME10', title: '10% off your first order', minOrderPaise: 0 }] }));
    await user.click(await screen.findByRole('button', { name: /WELCOME10/ }));
    expect(await screen.findByText('Coupon WELCOME10')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /place order · ₹232\.20/i })).toBeInTheDocument();
    expect(byMethod(calls, 'POST', '/checkout/quote').at(-1).body).toMatchObject({ couponCode: 'WELCOME10' });
    await user.click(screen.getByRole('button', { name: /place order/i }));
    await waitFor(() => expect(byMethod(calls, 'POST', '/orders').length).toBe(1));
    expect(byMethod(calls, 'POST', '/orders')[0].body).toMatchObject({ couponCode: 'WELCOME10', substitutionPreference: 'allow_similar', expectedTotalPaise: 23220 });
  });

  it('a coupon the server refuses blocks the order with its reason, and can be removed', async () => {
    const quote = ({ options }) => {
      const body = JSON.parse(options.body);
      return ok({ quote: body.couponCode ? quoteFixture({ blockers: [{ code: 'COUPON_INVALID', message: 'This coupon has expired.' }], canPlaceOrder: false }) : quoteFixture() });
    };
    const { user } = renderAt(`/checkout/${STORE_ID}`, checkoutRoutes({ quote }));
    await user.type(await screen.findByRole('textbox', { name: 'Coupon code' }), 'old5');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(await screen.findByText('This coupon has expired.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /place order/i })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /place order/i })).toBeEnabled());
  });

  it('asking for every point drops to the most this order allows, shown as its own line', async () => {
    const loyalty = { store: { id: STORE_ID, name: 'Sharma Kirana Store' }, program: { pointValuePaise: 100, summary: '1 point per ₹100' }, balance: { points: 80, valuePaise: 8000 }, rewards: [], history: [] };
    const capped = { balancePoints: 80, pointValuePaise: 100, maxRedeemablePoints: 50 };
    // As the backend does: no loyalty block until points are asked for; too many is a blocker with the cap.
    const quote = ({ options }) => {
      const { redeemPoints } = JSON.parse(options.body);
      if (!redeemPoints) return ok({ quote: quoteFixture() });
      if (redeemPoints > 50) {
        return ok({ quote: quoteFixture({ canPlaceOrder: false, blockers: [{ code: 'ABOVE_MAX_REDEEM', message: 'Points can pay for at most 50% of this order — up to 50 points.', maxRedeemablePoints: 50 }], benefits: { coupon: null, loyalty: { ...capped, pointsUsed: 0, discountPaise: 0 } } }) });
      }
      return ok({ quote: quoteFixture({ totals: { ...quoteFixture().totals, discountPaise: 5000, totalPaise: 20800 }, benefits: { coupon: null, loyalty: { ...capped, pointsUsed: 50, discountPaise: 5000 } } }) });
    };
    const { user, calls } = renderAt(`/checkout/${STORE_ID}`, checkoutRoutes({ quote, loyalty }));
    await user.click(await screen.findByRole('checkbox', { name: /use my points — you have 80/i }));
    await waitFor(() => expect(byMethod(calls, 'POST', '/checkout/quote').map((c) => c.body.redeemPoints ?? 0)).toEqual([0, 80, 50]));
    expect(await screen.findByText('50 points')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /place order · ₹208\.00/i })).toBeEnabled();
  });

  it('offers khata only where the shop allows it and has given credit', async () => {
    renderAt(`/checkout/${STORE_ID}`, checkoutRoutes({
      store: storeFixture({ payment: { online: true, cashOnDelivery: true, khata: true } }),
      khata: [{ id: 'k-1', storeId: STORE_ID, isActive: true, availableCreditPaise: 40000 }],
    }));
    expect(await screen.findByRole('radio', { name: /add to my khata/i })).toBeInTheDocument();
    expect(screen.getByText(/₹400\.00 of credit available/)).toBeInTheDocument();
  });

  it('does not offer khata without a credit limit', async () => {
    renderAt(`/checkout/${STORE_ID}`, checkoutRoutes({
      store: storeFixture({ payment: { online: true, cashOnDelivery: true, khata: true } }),
      khata: [{ id: 'k-1', storeId: STORE_ID, isActive: true, availableCreditPaise: null }],
    }));
    await screen.findByRole('radio', { name: /cash/i });
    expect(screen.queryByRole('radio', { name: /add to my khata/i })).not.toBeInTheDocument();
  });

  it('shows how close delivery is to free', async () => {
    const quote = () => ok({ quote: quoteFixture({ fulfilmentMode: 'delivery', freeDelivery: { thresholdPaise: 50000, remainingPaise: 24200, isUnlocked: false } }) });
    renderAt(`/checkout/${STORE_ID}`, checkoutRoutes({ quote }));
    expect(await screen.findByText(/more for free delivery/)).toHaveTextContent('Add ₹242.00 more for free delivery');
  });
});

// ── Cart: quick checkout and the usual basket ───────────────────────────────

describe('quick checkout and the usual basket', () => {
  it('quick checkout opens the review with the saved choices made', async () => {
    const { user, calls } = renderAt(`/cart/${STORE_ID}`, {
      ...checkoutRoutes(),
      '/cart/validate': ok({ cart: cartFixture() }),
      '/checkout/quick': ok({ settings: { fulfilmentMode: 'pickup', addressId: null, paymentMethod: 'online', substitutionPreference: 'no_substitutions' }, quote: quoteFixture() }),
    });
    await user.click(await screen.findByRole('button', { name: /quick checkout/i }));
    expect(byMethod(calls, 'POST', '/checkout/quick')[0].body).toEqual({ storeId: STORE_ID });
    expect(await screen.findByRole('radio', { name: /pay online/i })).toBeChecked();
    expect(screen.getByRole('radio', { name: /no replacements/i })).toBeChecked();
  });

  it('adds the usual items that are missing, and reports any that could not go in', async () => {
    const smart = { rule: 'Products in at least half of your last ten completed orders at this store.', basedOnOrders: 4, usual: [], missingFromCart: [{ ...PRODUCT, id: 'p-9', name: 'Toor Dal', usualQuantity: 2 }] };
    let added = false;
    const { user, calls } = renderAt(`/cart/${STORE_ID}`, {
      '/cart': ok({ cart: cartFixture() }),
      '/stores/sharma-kirana': ok({ store: storeFixture() }),
      '/me/smart-cart': () => ok({ smartCart: added ? { ...smart, missingFromCart: [] } : smart }),
      '/me/smart-cart/add': () => {
        added = true;
        return ok({ storeId: STORE_ID, added: [{ productId: 'p-9', name: 'Toor Dal', quantity: 2 }], failed: [{ productId: 'p-8', name: 'Ghee', code: 'OUT_OF_STOCK', message: 'Sold out' }], isComplete: false });
      },
    });
    expect(await screen.findByText('Toor Dal × 2')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add them' }));
    expect(byMethod(calls, 'POST', '/me/smart-cart/add')[0].body).toEqual({ storeId: STORE_ID, onlyMissing: true });
    expect(await screen.findByText(/Added 1 item\. Not added: Ghee \(Sold out\)/)).toBeInTheDocument();
  });
});

// ── Repeat shopping and lists ───────────────────────────────────────────────

describe('my shopping', () => {
  it('buy again adds the usual size and quantity through the cart', async () => {
    const { user, calls } = renderAt('/my-shopping', {
      '/me/insights': ok({ insights: { basedOn: { completedOrders: 0 } } }),
      '/me/buy-again': ok({ products: [{ ...PRODUCT, usualVariantId: 'v-1kg', usualQuantity: 2, timesBought: 3, lastBoughtAt: '2026-09-01T10:00:00Z' }] }),
      '/cart/items': created({ cart: cartFixture() }),
      '/me/replenishment': ok({ replenishment: { items: [], rule: '' } }),
    });
    await user.click(await screen.findByRole('tab', { name: 'Buy again' }));
    expect(await screen.findByText(/Bought 3 times/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add Basmati Rice to cart' }));
    expect(byMethod(calls, 'POST', '/cart/items')[0].body).toEqual({ storeId: STORE_ID, productId: 'p-1', variantId: 'v-1kg', quantity: 2 });
    expect(await screen.findByRole('link', { name: 'In cart ✓' })).toBeInTheDocument();
  });

  it('a product that can no longer be bought says so instead of offering Add', async () => {
    const { user } = renderAt('/my-shopping', {
      '/me/insights': ok({ insights: { basedOn: { completedOrders: 0 } } }),
      '/me/buy-again': ok({ products: [] }),
      '/me/favourites': ok({ products: [{ ...PRODUCT, isPurchasable: false }] }),
    });
    await user.click(await screen.findByRole('tab', { name: 'Favourites' }));
    expect(await screen.findByText('Not available')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add basmati/i })).not.toBeInTheDocument();
  });
});

describe('shopping lists', () => {
  const list = (items) => ({ id: 'l-1', kind: 'list', name: 'Weekly', store: null, repeatEveryDays: null, items, updatedAt: '2026-09-20T00:00:00Z' });

  it('adds a free-text line, ticks it, and puts products in the cart', async () => {
    let items = [{ id: 'i-1', label: 'Basmati Rice', quantity: 1, isChecked: false, variantId: null, product: PRODUCT, isUnavailable: false }];
    const { user, calls } = renderAt('/lists/l-1', {
      '/me/lists/l-1': () => ok({ list: list(items) }),
      '/me/lists/l-1/items': ({ options }) => {
        items = [...items, { id: 'i-2', label: JSON.parse(options.body).label, quantity: 1, isChecked: false, variantId: null, product: null }];
        return created({ list: list(items) });
      },
      '/me/lists/l-1/items/i-2': ({ options }) => {
        items = items.map((i) => (i.id === 'i-2' ? { ...i, isChecked: JSON.parse(options.body).isChecked } : i));
        return ok({ list: list(items) });
      },
      '/me/lists/l-1/add-to-cart': ok({ storeId: STORE_ID, added: [{ name: 'Basmati Rice' }], failed: [], skipped: [] }),
    });
    await user.type(await screen.findByRole('textbox', { name: 'Add to the list' }), 'Matches');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(await screen.findByText('Matches')).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: 'Got Matches' }));
    expect(byMethod(calls, 'PATCH', '/me/lists/l-1/items/i-2')[0].body).toEqual({ isChecked: true });
    await user.click(screen.getByRole('button', { name: /put the unticked products in my cart/i }));
    expect(await screen.findByText(/Added 1 to your cart/)).toBeInTheDocument();
  });

  it('a template needs a shop before it can be created', async () => {
    const { user } = renderAt('/lists', {
      '/me/lists': ok({ lists: [] }),
      '/saved-stores': ok({ savedStores: [{ store: storeFixture() }] }),
    });
    await user.click(await screen.findByRole('radio', { name: 'Repeat template' }));
    await user.type(screen.getByLabelText(/^Name/), 'Monthly ration');
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Shop' }), STORE_ID);
    expect(screen.getByRole('button', { name: 'Create' })).toBeEnabled();
  });
});

// ── Preferences ─────────────────────────────────────────────────────────────

describe('preferences and consent', () => {
  const prefs = { birthday: null, activityTracking: true, occasionOffers: false, preferredFulfilment: null, preferredPaymentMethod: null, preferredSubstitution: 'contact_me', preferredLanguage: null, defaultAddressId: null };

  it('saves shopping preferences and warns before deleting activity', async () => {
    const { user, calls } = renderAt('/account/preferences', {
      '/me/preferences': ({ options }) => ok({ preferences: options.method === 'PATCH' ? { ...prefs, ...JSON.parse(options.body) } : prefs }),
      '/me/store-preferences': ok({ stores: [] }),
    });
    await user.click(await screen.findByRole('radio', { name: 'Delivery' }));
    await user.click(screen.getByRole('radio', { name: 'Online' }));
    await user.click(screen.getByRole('checkbox', { name: /remember what i look at/i }));
    expect(screen.getByText('Saving will delete your viewing history.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save preferences' }));
    expect(byMethod(calls, 'PATCH', '/me/preferences')[0].body).toEqual({
      preferredFulfilment: 'delivery', preferredPaymentMethod: 'online', preferredSubstitution: 'contact_me', activityTracking: false, occasionOffers: false, birthday: null,
    });
    expect(await screen.findByText('Saved.')).toBeInTheDocument();
  });

  it('turns a shop’s offers on and off', async () => {
    const { user, calls } = renderAt('/account/preferences', {
      '/me/preferences': ok({ preferences: prefs }),
      '/me/store-preferences': ok({ stores: [{ store: { id: STORE_ID, slug: 'sharma-kirana', name: 'Sharma Kirana Store' }, allowPromotions: false, allowReminders: true }] }),
      [`/stores/${STORE_ID}/preferences`]: ({ options }) => ok({ preferences: { allowPromotions: true, allowReminders: true, ...JSON.parse(options.body) } }),
    });
    await user.click(await screen.findByRole('checkbox', { name: 'Offers and announcements' }));
    expect(byMethod(calls, 'PUT', `/stores/${STORE_ID}/preferences`)[0].body).toEqual({ allowPromotions: true });
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Offers and announcements' })).toBeChecked());
  });
});

// ── Points ──────────────────────────────────────────────────────────────────

describe('points', () => {
  const loyalty = (points) => ({
    store: { id: STORE_ID, slug: 'sharma-kirana', name: 'Sharma Kirana Store' },
    program: { summary: '1 point per ₹100; 1 point = ₹1.' },
    balance: { points, valuePaise: points * 100, lifetimeEarned: 150, lifetimeRedeemed: 150 - points },
    rewards: [{ id: 'rw-1', name: '₹50 off', pointsCost: 50, canRedeem: points >= 50 }, { id: 'rw-2', name: 'Free delivery', pointsCost: 500, canRedeem: false }],
    history: [{ id: 'h-1', label: 'Earned on order CPSE-1', points: 20, at: '2026-09-01T00:00:00Z', note: null }],
  });

  it('redeems a reward into a coupon code and updates the balance', async () => {
    const { user } = renderAt(`/points/${STORE_ID}`, {
      [`/stores/${STORE_ID}/loyalty`]: ok({ loyalty: loyalty(120) }),
      [`/stores/${STORE_ID}/loyalty/rewards/rw-1/redeem`]: created({ coupon: { code: 'RWD-AB12' }, ...loyalty(70) }),
    });
    expect(await screen.findByText('Earned on order CPSE-1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Not enough points' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Redeem' }));
    expect(await screen.findByText('RWD-AB12')).toBeInTheDocument();
    expect(screen.getByText('70')).toBeInTheDocument();
  });
});

// ── Messages ────────────────────────────────────────────────────────────────

describe('messages', () => {
  const conversation = (over = {}) => ({
    id: 'cv-1', kind: 'order', kindLabel: 'About an order', subject: 'Where is it?', status: 'awaiting_store', statusLabel: 'Waiting for the store',
    store: { id: STORE_ID, name: 'Sharma Kirana Store' }, order: { id: 'order-1', orderNumber: 'CPSE-1' }, lastMessageAt: '2026-09-20T10:00:00Z',
    messages: [{ id: 'm-1', from: 'customer', body: 'Not here yet.', at: '2026-09-20T10:00:00Z' }], ...over,
  });

  it('starts a conversation about an order', async () => {
    const { user, calls } = renderAt('/messages/new?orderId=order-1', {
      '/conversations': created({ conversation: conversation() }),
      '/conversations/cv-1': ok({ conversation: conversation() }),
    });
    await user.type(await screen.findByLabelText(/^Subject/), 'Where is it?');
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'Not here yet.');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(byMethod(calls, 'POST', '/conversations')[0].body).toEqual({ kind: 'order', orderId: 'order-1', subject: 'Where is it?', message: 'Not here yet.' });
    expect(await screen.findByRole('heading', { name: 'Where is it?' })).toBeInTheDocument();
  });

  it('replies, and escalates an order conversation to support with a reason', async () => {
    let current = conversation();
    const { user, calls } = renderAt('/messages/cv-1', {
      '/conversations/cv-1': () => ok({ conversation: current }),
      '/conversations/cv-1/messages': ({ options }) => {
        current = conversation({ messages: [...current.messages, { id: 'm-2', from: 'customer', body: JSON.parse(options.body).body, at: '2026-09-20T11:00:00Z' }] });
        return created({ conversation: current });
      },
      '/conversations/cv-1/escalate': () => {
        current = conversation({ status: 'escalated', statusLabel: 'With CPSE support' });
        return ok({ conversation: current });
      },
    });
    await user.type(await screen.findByRole('textbox', { name: 'Your reply' }), 'Any news?');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('Any news?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Ask CPSE support' }));
    await user.type(screen.getByLabelText(/What went wrong/), 'No reply for two days');
    await user.click(screen.getByRole('button', { name: 'Ask support to step in' }));
    expect(byMethod(calls, 'POST', '/escalate')[0].body).toEqual({ reason: 'No reply for two days' });
    expect(await screen.findByText('With CPSE support')).toBeInTheDocument();
  });

  it('a question to a shop cannot be escalated', async () => {
    renderAt('/messages/cv-1', { '/conversations/cv-1': ok({ conversation: conversation({ kind: 'question', kindLabel: 'Question', order: null }) }) });
    await screen.findByRole('textbox', { name: 'Your reply' });
    expect(screen.queryByRole('button', { name: 'Ask CPSE support' })).not.toBeInTheDocument();
  });
});

// ── Store page, product page, activity and nearby offers ────────────────────

describe('store page extras', () => {
  const storeRoutes = {
    '/stores/sharma-kirana': ok({ store: storeFixture() }),
    '/stores/sharma-kirana/categories': ok({ categories: [] }),
    '/stores/sharma-kirana/products': ok({ products: [] }, { page: 1, limit: 20, total: 0, totalPages: 0, hasNextPage: false }),
    '/stores/sharma-kirana/offers': ok({
      offers: [{ id: 'of-1', title: 'Mango week', productId: 'p-5', productName: 'Alphonso', variantName: '1 dozen', offerPricePaise: 50000, listPricePaise: 60000, endsAt: '2026-10-17T18:29:59Z', unitsLeft: 15, batchExpiresOn: null }],
      coupons: [{ id: 'c-1', code: 'FIRST50', title: '₹50 off your first order', minOrderPaise: 30000, endsAt: null }],
    }),
    '/me/events': created({ recorded: true }),
  };

  it('shows live offers and coupons, and records the visit for a signed-in customer', async () => {
    const { calls } = renderAt('/store/sharma-kirana', storeRoutes);
    expect(await screen.findByTestId('offer')).toHaveTextContent('Mango week');
    expect(screen.getByTestId('offer')).toHaveTextContent('15 left at this price');
    expect(screen.getByTestId('coupon')).toHaveTextContent('FIRST50');
    expect(screen.getByRole('link', { name: 'Ask the shop' })).toHaveAttribute('href', expect.stringContaining(`/messages/new?storeId=${STORE_ID}`));
    await waitFor(() => expect(byMethod(calls, 'POST', '/me/events')[0]?.body).toEqual({ eventType: 'store_view', storeId: STORE_ID }));
  });

  it('records nothing for a visitor who is not signed in', async () => {
    const { calls } = renderAt('/store/sharma-kirana', storeRoutes, { signedIn: false });
    await screen.findByTestId('offer');
    expect(byMethod(calls, 'POST', '/me/events')).toHaveLength(0);
  });
});

describe('offers near you', () => {
  it('asks for location only on tap, and lists offers nearest first', async () => {
    const getCurrentPosition = vi.fn((success) => success({ coords: { latitude: 30.90123, longitude: 75.85789 } }));
    Object.defineProperty(window.navigator, 'geolocation', { value: { getCurrentPosition }, configurable: true });
    const { user, calls } = renderAt('/', {
      '/stores': ok({ stores: [] }, { page: 1, limit: 20, total: 0, totalPages: 0, hasNextPage: false }),
      '/orders': ok({ orders: [] }),
      '/saved-stores': ok({ savedStores: [] }),
      '/offers/nearby': ok({ offers: [{ id: 'of-1', title: 'Mango week', productId: 'p-5', productName: 'Alphonso', offerPricePaise: 50000, listPricePaise: 60000, endsAt: '2026-10-17T18:29:59Z', distanceKm: 1.2, store: { id: STORE_ID, slug: 'sharma-kirana', name: 'Sharma Kirana Store' } }] }),
    });
    await user.click(await screen.findByRole('button', { name: 'Show offers near me' }));
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/1\.2 km away/)).toBeInTheDocument();
    const nearby = calls.find((c) => c.url.includes('/offers/nearby'));
    // Rounded before it leaves the device, and sent without a token.
    expect(new URL(nearby.url).searchParams.get('lat')).toBe('30.9');
    expect(nearby.headers.authorization).toBeUndefined();
  });
});

// ── Smaller paths ───────────────────────────────────────────────────────────

describe('smaller paths', () => {
  it('recently viewed lists what was opened, and the habits summary shows', async () => {
    const { user } = renderAt('/my-shopping', {
      '/me/insights': ok({ insights: { basedOn: { completedOrders: 6, since: '2026-05-01' }, averageOrderPaise: 45000, purchaseFrequency: { ordersLast180Days: 6, ordersPer30Days: 1 }, favouriteStores: [{ store: { id: STORE_ID, name: 'Sharma Kirana Store' }, orders: 6 }], frequentProducts: [{ productId: 'p-1', name: 'Milk', orders: 5, units: 9 }] } }),
      '/me/buy-again': ok({ products: [] }),
      '/me/recently-viewed': ok({ products: [{ ...PRODUCT, viewedAt: '2026-09-20T10:00:00Z' }] }),
    });
    expect(await screen.findByText('Your shopping at a glance')).toBeInTheDocument();
    expect(screen.getByText('₹450.00')).toBeInTheDocument();
    expect(screen.getByText(/Most from: Sharma Kirana Store \(6\)/)).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Recently viewed' }));
    expect(await screen.findByText(/^Viewed/)).toBeInTheDocument();
  });

  it('a special request carries its type', async () => {
    const { user, calls } = renderAt(`/messages/new?storeId=${STORE_ID}&storeName=Sharma`, {
      '/conversations': created({ conversation: { id: 'cv-9', kind: 'special_request', subject: 'Cake', status: 'awaiting_store', statusLabel: 'Waiting', messages: [] } }),
      '/conversations/cv-9': ok({ conversation: { id: 'cv-9', kind: 'special_request', subject: 'Cake', status: 'awaiting_store', statusLabel: 'Waiting', messages: [] } }),
    });
    await user.click(await screen.findByRole('radio', { name: 'A special request' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Kind of request' }), 'bulk_order');
    await user.type(screen.getByLabelText(/^Subject/), 'Cake');
    await user.type(screen.getByRole('textbox', { name: 'Message' }), '20 kg flour for a function');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(byMethod(calls, 'POST', '/conversations')[0].body).toEqual({ kind: 'special_request', storeId: STORE_ID, requestType: 'bulk_order', subject: 'Cake', message: '20 kg flour for a function' });
  });

  it('birthday offers are opt-in and send month and day only', async () => {
    const prefs = { birthday: null, activityTracking: true, occasionOffers: false, preferredFulfilment: null, preferredPaymentMethod: null, preferredSubstitution: 'contact_me' };
    const { user, calls } = renderAt('/account/preferences', {
      '/me/preferences': ({ options }) => ok({ preferences: options.method === 'PATCH' ? { ...prefs, ...JSON.parse(options.body) } : prefs }),
      '/me/store-preferences': ok({ stores: [] }),
    });
    expect(screen.queryByRole('combobox', { name: 'Birthday month' })).not.toBeInTheDocument();
    await user.click(await screen.findByRole('checkbox', { name: /birthday offers/i }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Birthday month' }), '3');
    await user.type(screen.getByRole('spinbutton', { name: 'Birthday day' }), '14');
    await user.click(screen.getByRole('button', { name: 'Save preferences' }));
    expect(byMethod(calls, 'PATCH', '/me/preferences')[0].body).toMatchObject({ occasionOffers: true, birthday: { month: 3, day: 14 } });
  });

  it('sharing a shop copies its link when the browser cannot share', async () => {
    Object.defineProperty(window.navigator, 'share', { value: undefined, configurable: true });
    const { user } = renderAt('/store/sharma-kirana', {
      '/stores/sharma-kirana': ok({ store: storeFixture() }),
      '/stores/sharma-kirana/categories': ok({ categories: [] }),
      '/stores/sharma-kirana/products': ok({ products: [] }, { page: 1, limit: 20, total: 0, totalPages: 0, hasNextPage: false }),
      '/stores/sharma-kirana/offers': ok({ offers: [], coupons: [] }),
      '/me/events': created({ recorded: true }),
    });
    await user.click(await screen.findByRole('button', { name: 'Share' }));
    expect(await screen.findByText('Link copied.')).toBeInTheDocument();
    // user-event provides the clipboard; what the page wrote is readable back.
    expect(await window.navigator.clipboard.readText()).toBe(`${window.location.origin}/store/sharma-kirana`);
    expect(screen.getByRole('link', { name: 'WhatsApp' }).getAttribute('href')).toContain(encodeURIComponent(`${window.location.origin}/store/sharma-kirana`));
  });

  it('the khata statement names each entry, its due date and how it was paid', async () => {
    renderAt('/khata/khata-1', {
      '/khata/khata-1': ok({
        account: { id: 'khata-1', storeId: STORE_ID, store: { id: STORE_ID, slug: 'sharma-kirana', name: 'Sharma Kirana Store' }, balancePaise: 2500, outstandingPaise: 2500, creditPaise: 0, isSettled: false },
        period: { from: null, to: null },
        totals: { openingPaise: 0, debitPaise: 5000, creditPaise: 2500, closingPaise: 2500, transactionCount: 3 },
        transactions: [
          { id: 't-1', type: 'debit', entryKind: 'charge', entryLabel: 'Purchase on credit', amountPaise: 5000, signedAmountPaise: 5000, description: null, dueDate: '2026-10-01', paymentMethod: null, orderId: null, occurredAt: '2026-09-01T10:00:00Z' },
          { id: 't-2', type: 'credit', entryKind: 'payment', entryLabel: 'Payment received', amountPaise: 2000, signedAmountPaise: -2000, description: null, dueDate: null, paymentMethod: 'upi', orderId: null, occurredAt: '2026-09-10T10:00:00Z' },
          { id: 't-3', type: 'credit', entryKind: 'refund_credit', entryLabel: 'Refund credited', amountPaise: 500, signedAmountPaise: -500, description: 'Order CPSE-3 cancelled', dueDate: null, paymentMethod: null, orderId: 'order-3', occurredAt: '2026-09-12T10:00:00Z' },
        ],
      }, { page: 1, limit: 50, total: 3, totalPages: 1, hasNextPage: false }),
      '/khata/khata-1/statement': ok({
        account: { id: 'khata-1', storeId: STORE_ID, store: { id: STORE_ID, slug: 'sharma-kirana', name: 'Sharma Kirana Store' }, balancePaise: 2500, outstandingPaise: 2500, creditPaise: 0, isSettled: false },
        period: { from: null, to: null },
        totals: { openingPaise: 0, debitPaise: 5000, creditPaise: 2500, closingPaise: 2500, transactionCount: 3 },
        transactions: [
          { id: 't-1', type: 'debit', entryKind: 'charge', entryLabel: 'Purchase on credit', amountPaise: 5000, signedAmountPaise: 5000, description: null, dueDate: '2026-10-01', paymentMethod: null, orderId: null, occurredAt: '2026-09-01T10:00:00Z' },
          { id: 't-2', type: 'credit', entryKind: 'payment', entryLabel: 'Payment received', amountPaise: 2000, signedAmountPaise: -2000, description: null, dueDate: null, paymentMethod: 'upi', orderId: null, occurredAt: '2026-09-10T10:00:00Z' },
          { id: 't-3', type: 'credit', entryKind: 'refund_credit', entryLabel: 'Refund credited', amountPaise: 500, signedAmountPaise: -500, description: 'Order CPSE-3 cancelled', dueDate: null, paymentMethod: null, orderId: 'order-3', occurredAt: '2026-09-12T10:00:00Z' },
        ],
      }),
    });
    expect(await screen.findByText('Purchase on credit')).toBeInTheDocument();
    expect(screen.getByText(/due 1 Oct 2026|due Oct 1, 2026|due 01/)).toBeInTheDocument();
    expect(screen.getByText(/· upi/)).toBeInTheDocument();
    expect(screen.getByText('Order CPSE-3 cancelled')).toBeInTheDocument();
    expect(screen.getByText(/· Refund credited/)).toBeInTheDocument();
  });
});

describe('comparing pack sizes', () => {
  it('shows the price per kg of each weight, and of the chosen one', async () => {
    const product = {
      id: 'p-1', storeId: STORE_ID, name: 'Basmati Rice', pricePaise: 6500, mrpPaise: null, taxPercent: 0, unit: 'kg', isPurchasable: true, stock: 8, images: [], imageUrl: null,
      variants: [
        { id: 'v-1', name: '1 kg', pricePaise: 12000, weightGrams: 1000, pricePerKgPaise: 12000, stock: 3, isPurchasable: true },
        { id: 'v-2', name: '500 g', pricePaise: 6500, weightGrams: 500, pricePerKgPaise: 13000, stock: 5, isPurchasable: true },
        { id: 'v-3', name: 'Loose', pricePaise: 100, weightGrams: null, pricePerKgPaise: null, stock: 5, isPurchasable: true },
      ],
    };
    const { user } = renderAt('/store/sharma-kirana/product/p-1', {
      '/stores/sharma-kirana/products/p-1': ok({ product }),
      '/me/favourites': ok({ products: [] }),
      '/me/events': created({ recorded: true }),
    });
    expect(await screen.findByText(/₹130\/kg/)).toBeInTheDocument();
    expect(screen.getByText(/₹120\/kg/)).toBeInTheDocument();
    expect(screen.queryByTestId('per-kg')).not.toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: /500 g/ }));
    expect(screen.getByTestId('per-kg')).toHaveTextContent('₹130.00 per kg');
    await user.click(screen.getByRole('radio', { name: /Loose/ }));
    expect(screen.queryByTestId('per-kg')).not.toBeInTheDocument();
  });
});

// ── Intelligence (§5 P6, Phase E) ───────────────────────────────────────────

describe('shop assistant and plain-words search', () => {
  const storeRoutes = {
    '/stores/sharma-kirana': ok({ store: storeFixture() }),
    '/stores/sharma-kirana/categories': ok({ categories: [] }),
    '/stores/sharma-kirana/products': ok({ products: [] }, { page: 1, limit: 20, total: 0, totalPages: 0, hasNextPage: false }),
    '/stores/sharma-kirana/offers': ok({ offers: [], coupons: [] }),
    '/me/events': created({ recorded: true }),
    '/me/discover': ok({ discover: { basedOn: 'your_categories', items: [{ product: { ...PRODUCT, id: 'p-7', name: 'Moong Dal' }, reason: 'New to you, from Staples you often buy.' }], offers: [] } }),
  };

  it('turns a typed list into a basket and adds it only when asked, reporting failures', async () => {
    let added = 0;
    const { user, calls } = renderAt('/store/sharma-kirana', {
      ...storeRoutes,
      '/stores/sharma-kirana/assistant': ok({ reply: { kind: 'proposal', intent: 'basket', answer: 'Here is a basket for your list — ₹396.00 before delivery and GST.', source: 'This shop’s catalogue.', unmatched: [{ text: 'unicorn' }], proposals: [
        { text: '2 kg rice', product: PRODUCT, suggestion: { variantId: 'v-1', variantName: '1 kg', quantity: 2 }, reason: 'Matches the size you wrote.', add: { storeId: STORE_ID, productId: 'p-1', variantId: 'v-1', quantity: 2 } },
        { text: 'dal', product: { ...PRODUCT, id: 'p-2', name: 'Toor Dal' }, suggestion: { variantId: 'v-2', variantName: 'Default', quantity: 1 }, reason: null, add: { storeId: STORE_ID, productId: 'p-2', variantId: 'v-2', quantity: 1 } },
      ] } }),
      '/cart/items': () => (++added === 2 ? fail(409, 'OUT_OF_STOCK', 'Sold out') : created({ cart: cartFixture() })),
    });
    expect(await screen.findByText('New for you here')).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: 'Ask the shop assistant' }), '2 kg rice, dal and unicorn');
    await user.click(screen.getByRole('button', { name: 'Ask' }));
    const reply = await screen.findByTestId('assistant-reply');
    expect(reply).toHaveTextContent('Not found here: unicorn.');
    expect(byMethod(calls, 'POST', '/cart/items')).toHaveLength(0);
    await user.click(within(reply).getByRole('button', { name: 'Add all 2 to cart' }));
    expect(await within(reply).findByText(/Added 1 to your cart\. Not added: Toor Dal \(Sold out\)/)).toBeInTheDocument();
    expect(byMethod(calls, 'POST', '/cart/items').map((c) => c.body)).toEqual([
      { storeId: STORE_ID, productId: 'p-1', variantId: 'v-1', quantity: 2 },
      { storeId: STORE_ID, productId: 'p-2', variantId: 'v-2', quantity: 1 },
    ]);
  });

  it('a visitor gets answers but is asked to sign in before adding', async () => {
    const { user } = renderAt('/store/sharma-kirana', {
      ...storeRoutes,
      '/stores/sharma-kirana/assistant': ok({ reply: { kind: 'results', intent: 'search', answer: 'I found 1 for “rice”.', results: [{ product: PRODUCT, suggestion: { variantId: 'v-1', variantName: '1 kg', quantity: 1 }, add: { storeId: STORE_ID, productId: 'p-1', variantId: 'v-1', quantity: 1 } }] } }),
    }, { signedIn: false });
    await user.type(await screen.findByRole('textbox', { name: 'Ask the shop assistant' }), 'rice');
    await user.click(screen.getByRole('button', { name: 'Ask' }));
    const reply = await screen.findByTestId('assistant-reply');
    expect(reply).toHaveTextContent('I found 1 for “rice”.');
    expect(within(reply).getByRole('link', { name: 'Sign in' })).toBeInTheDocument();
    expect(within(reply).queryByRole('button', { name: /add/i })).not.toBeInTheDocument();
  });

  it('listens where the browser can', async () => {
    class FakeRecognition { start() { setTimeout(() => this.onresult({ results: [[{ transcript: 'are you open' }]] }), 0); } }
    window.SpeechRecognition = FakeRecognition;
    const { user } = renderAt('/store/sharma-kirana', storeRoutes);
    const speak = await screen.findByRole('button', { name: 'Speak' });
    // A drawn microphone, not an emoji.
    expect(speak.querySelector('svg')).not.toBeNull();
    expect(speak.textContent).not.toMatch(/\p{Extended_Pictographic}/u);
    await user.click(speak);
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Ask the shop assistant' })).toHaveValue('are you open'));
    delete window.SpeechRecognition;
  });

  it('a search with a size and budget is read in plain words', async () => {
    renderAt('/store/sharma-kirana/search?q=2%20kg%20rice%20under%20300', {
      '/stores/sharma-kirana/search': ok({ products: [] }, { page: 1, limit: 20, total: 0, totalPages: 0, hasNextPage: false }),
      '/stores/sharma-kirana/smart-search': ok({ search: { interpretation: 'rice · about 2 kg · under ₹300.00', results: [{ product: PRODUCT, suggestion: { variantId: 'v-1', variantName: '1 kg', quantity: 2 }, totalPaise: 24000, reason: 'The size you asked for.', add: { storeId: STORE_ID, productId: 'p-1', variantId: 'v-1', quantity: 2 } }] } }),
      '/me/events': created({ recorded: true }),
    });
    const smart = await screen.findByTestId('smart-results');
    expect(smart).toHaveTextContent('Understood as: rice · about 2 kg · under ₹300.00');
    expect(smart).toHaveTextContent('2 × 1 kg · ₹240.00 · The size you asked for.');
  });
});

describe('product page suggestions', () => {
  it('shows what is bought together, and alternatives first when the product is sold out', async () => {
    const product = { id: 'p-1', storeId: STORE_ID, name: 'Basmati Rice', pricePaise: 12000, mrpPaise: null, taxPercent: 0, unit: 'kg', isPurchasable: false, stock: 0, images: [], imageUrl: null, variants: [] };
    renderAt('/store/sharma-kirana/product/p-1', {
      '/stores/sharma-kirana/products/p-1': ok({ product }),
      '/stores/sharma-kirana/products/p-1/recommendations': ok({ recommendations: { items: [{ product: { ...PRODUCT, id: 'p-2', name: 'Toor Dal' }, reason: 'Bought together in 4 orders here.' }], rule: '' } }),
      '/stores/sharma-kirana/products/p-1/alternatives': ok({ alternatives: { items: [{ product: { ...PRODUCT, id: 'p-3', name: 'Sona Masoori Rice' }, reason: 'Similar name, same category, cheaper.', score: 0.7 }] } }),
      '/me/favourites': ok({ products: [] }),
      '/me/events': created({ recorded: true }),
    });
    expect(await screen.findByRole('heading', { name: 'Instead, try' })).toBeInTheDocument();
    expect(screen.getByText(/Similar name, same category, cheaper/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Often bought with this' })).toBeInTheDocument();
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings.indexOf('Instead, try')).toBeLessThan(headings.indexOf('Often bought with this'));
  });
});

describe('due again', () => {
  it('lists regular purchases by when they are due, ready to add', async () => {
    const { user, calls } = renderAt('/my-shopping', {
      '/me/insights': ok({ insights: { basedOn: { completedOrders: 0 } } }),
      '/me/replenishment': ok({ replenishment: { rule: 'Products you bought on 3 or more days in the last year.', items: [{ product: PRODUCT, everyDays: 7, lastBoughtOn: '2026-10-01', dueOn: '2026-10-08', dueInDays: -3, status: 'due', usualQuantity: 2, usualVariantId: 'v-1kg', basedOnOrders: 3 }] } }),
      '/cart/items': created({ cart: cartFixture() }),
    });
    expect(await screen.findByText(/Due now · you buy it about every 7 days/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add Basmati Rice to cart' }));
    expect(byMethod(calls, 'POST', '/cart/items')[0].body).toEqual({ storeId: STORE_ID, productId: 'p-1', variantId: 'v-1kg', quantity: 2 });
  });
});

// ── Phone-width layout (found at 375 px in a real browser) ─────────────────

describe('phone-width layout', () => {
  it('rows of an input and buttons let the input shrink instead of widening the page', async () => {
    const { readFileSync } = await import('node:fs');
    const global = readFileSync(`${process.cwd()}/src/styles/global.css`, 'utf8').replace(/\s+/g, ' ');
    expect(global).toMatch(/\.inline-form \.field__input \{ flex: 1; min-width: 0; \}/);
    expect(global).toMatch(/\.inline-form \.btn \{ flex-shrink: 0; \}/);
  });

  it('the assistant, coupon, list and reply rows use it (not the password-toggle layout)', async () => {
    renderAt('/store/sharma-kirana', {
      '/stores/sharma-kirana': ok({ store: storeFixture() }),
      '/stores/sharma-kirana/categories': ok({ categories: [] }),
      '/stores/sharma-kirana/products': ok({ products: [] }, { page: 1, limit: 20, total: 0, totalPages: 0, hasNextPage: false }),
      '/stores/sharma-kirana/offers': ok({ offers: [], coupons: [] }),
      '/me/events': created({ recorded: true }),
      '/me/discover': ok({ discover: { basedOn: 'popular_here', items: [], offers: [] } }),
    });
    const input = await screen.findByRole('textbox', { name: 'Ask the shop assistant' });
    expect(input.closest('form')).toHaveClass('inline-form');
    const { readFileSync } = await import('node:fs');
    for (const file of ['src/routes/checkout/CheckoutSections.jsx', 'src/routes/engage/ListsPage.jsx', 'src/routes/engage/MessagesPage.jsx', 'src/routes/store/ShopAssistant.jsx']) {
      const source = readFileSync(`${process.cwd()}/${file}`, 'utf8');
      expect(source, file).toContain('className="inline-form"');
      expect(source, file).not.toContain('field__with-action');
    }
  });
});
