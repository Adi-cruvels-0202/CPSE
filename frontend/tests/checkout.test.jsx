import { describe, it, expect } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../src/context/AuthContext.jsx';
import { AppRoutes } from '../src/router.jsx';
import { writeSession } from '../src/lib/tokens.js';
import {
  addressFixture,
  orderDetailFixture,
  cartFixture,
  created,
  customerFixture,
  emptyCartFixture,
  fail,
  mockRoutes,
  ok,
  orderFixture,
  paymentMethodsFixture,
  quoteFixture,
  sessionFixture,
  storeFixture,
} from './helpers/api.js';

/** Checklist 11.8 — checkout, driven by the quote. */

const ROUTER_FUTURE = { v7_startTransition: true, v7_relativeSplatPath: true };
const STORE_ID = '11111111-1111-4111-8111-000000000001';

function renderCheckout({
  cart = cartFixture(),
  store = storeFixture(),
  addresses = [addressFixture()],
  quote = quoteFixture(),
  routes = {},
} = {}) {
  writeSession(sessionFixture());

  const mocked = mockRoutes({
    '/me': ok({ customer: customerFixture() }),
    '/cart': ok({ cart }),
    '/stores/sharma-kirana': ok({ store }),
    '/addresses': ok({ addresses }),
    '/payments/methods': ok(paymentMethodsFixture()),
    '/checkout/quote': ok({ quote }),
    '/orders': created({ order: orderFixture() }),
    // Placing an order navigates to the real order or payment screen, which fetch.
    '/orders/order-1': ok({ order: orderDetailFixture() }),
    ...routes,
  });

  return {
    user: userEvent.setup(),
    ...mocked,
    ...render(
      <MemoryRouter initialEntries={[`/checkout/${STORE_ID}`]} future={ROUTER_FUTURE}>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </MemoryRouter>,
    ),
  };
}

const quoteCalls = (calls) => calls.filter((call) => call.url.includes('/checkout/quote'));
const placeButton = () => screen.getByRole('button', { name: /place order/i });

describe('getting there', () => {
  it('needs a session', async () => {
    mockRoutes({ '/cart': ok({ cart: cartFixture() }) });

    render(
      <MemoryRouter initialEntries={[`/checkout/${STORE_ID}`]} future={ROUTER_FUTURE}>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('reaches the store through the cart’s slug, not the id in the URL', async () => {
    const { calls } = renderCheckout();

    await screen.findByRole('heading', { level: 1, name: 'Checkout' });
    // GET /stores/:slug 404s on a uuid, and the route only carries the id.
    expect(calls.some((call) => call.url.endsWith('/stores/sharma-kirana'))).toBe(true);
    expect(calls.some((call) => call.url.endsWith(`/stores/${STORE_ID}`))).toBe(false);
  });

  it('says the cart is empty rather than showing a form for nothing', async () => {
    renderCheckout({ cart: emptyCartFixture() });

    expect(await screen.findByRole('heading', { name: /your cart is empty/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /place order/i })).not.toBeInTheDocument();
  });

  it('offers a retry when it cannot start', async () => {
    const { user } = renderCheckout({
      routes: { '/cart': [fail(500, 'INTERNAL_ERROR', 'Something went wrong on our end.'), ok({ cart: cartFixture() })] },
    });

    expect(await screen.findByRole('heading', { name: /could not start checkout/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /try again/i }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Checkout' })).toBeInTheDocument();
  });
});

describe('choosing how to get it', () => {
  it('offers only what the shop does, and defaults to pickup', async () => {
    renderCheckout();

    await screen.findByRole('heading', { level: 1, name: 'Checkout' });
    expect(screen.getByRole('radio', { name: /pick it up/i })).toBeChecked();
    expect(screen.getByRole('radio', { name: /have it delivered/i })).toBeInTheDocument();
  });

  it('offers pickup only when the shop does not deliver', async () => {
    renderCheckout({
      store: storeFixture({
        fulfilment: { ...storeFixture().fulfilment, deliveryEnabled: false },
      }),
    });

    await screen.findByRole('heading', { level: 1, name: 'Checkout' });
    expect(screen.queryByRole('radio', { name: /have it delivered/i })).not.toBeInTheDocument();
    // And no address step, since there is nothing to deliver to.
    expect(screen.queryByRole('heading', { name: /where to/i })).not.toBeInTheDocument();
  });

  it('defaults to delivery when that is all the shop does', async () => {
    renderCheckout({
      store: storeFixture({
        fulfilment: { ...storeFixture().fulfilment, pickupEnabled: false },
      }),
      quote: quoteFixture({ fulfilmentMode: 'delivery', address: addressFixture() }),
    });

    expect(await screen.findByRole('radio', { name: /have it delivered/i })).toBeChecked();
  });

  it('names the delivery fee on the choice itself', async () => {
    renderCheckout();

    await screen.findByRole('heading', { level: 1, name: 'Checkout' });
    expect(screen.getByText(/₹29\.00 delivery fee/i)).toBeInTheDocument();
  });

  it('re-quotes when the mode changes, and asks for an address', async () => {
    const { user, calls } = renderCheckout();

    await screen.findByRole('heading', { level: 1, name: 'Checkout' });
    const before = quoteCalls(calls).length;

    await user.click(screen.getByRole('radio', { name: /have it delivered/i }));

    // The fee and the blockers both depend on the mode.
    await waitFor(() => expect(quoteCalls(calls).length).toBeGreaterThan(before));
    const last = quoteCalls(calls).at(-1);
    expect(last.body.fulfilmentMode).toBe('delivery');
    expect(last.body.addressId).toBe('addr-1');
    expect(screen.getByRole('heading', { name: /where to/i })).toBeInTheDocument();
  });

  it('sends no addressId for pickup', async () => {
    const { calls } = renderCheckout();

    await screen.findByRole('heading', { level: 1, name: 'Checkout' });
    await waitFor(() => expect(quoteCalls(calls).length).toBeGreaterThan(0));
    expect('addressId' in quoteCalls(calls)[0].body).toBe(false);
  });
});

describe('choosing where to', () => {
  const delivering = {
    quote: quoteFixture({ fulfilmentMode: 'delivery', address: addressFixture() }),
  };

  it('preselects the default address', async () => {
    const { user } = renderCheckout({
      ...delivering,
      addresses: [
        addressFixture({ id: 'addr-2', recipientName: 'Not Default', isDefault: false }),
        addressFixture(),
      ],
    });

    await screen.findByRole('heading', { level: 1, name: 'Checkout' });
    await user.click(screen.getByRole('radio', { name: /have it delivered/i }));

    // The one they mean nine times out of ten.
    const picked = await screen.findByRole('radio', { name: /test customer/i });
    expect(picked).toBeChecked();
  });

  it('re-quotes when a different address is chosen', async () => {
    const { user, calls } = renderCheckout({
      ...delivering,
      addresses: [addressFixture(), addressFixture({ id: 'addr-2', recipientName: 'Office Person', isDefault: false })],
    });

    await screen.findByRole('heading', { level: 1, name: 'Checkout' });
    await user.click(screen.getByRole('radio', { name: /have it delivered/i }));
    await screen.findByRole('heading', { name: /where to/i });

    await user.click(screen.getByRole('radio', { name: /office person/i }));

    await waitFor(() => expect(quoteCalls(calls).at(-1).body.addressId).toBe('addr-2'));
  });

  it('shows the form straight away when there are no addresses', async () => {
    const { user } = renderCheckout({ ...delivering, addresses: [] });

    await screen.findByRole('heading', { level: 1, name: 'Checkout' });
    await user.click(screen.getByRole('radio', { name: /have it delivered/i }));

    expect(await screen.findByLabelText(/who is it for/i)).toBeInTheDocument();
    expect(screen.getByText(/no addresses saved/i)).toBeInTheDocument();
  });

  it('adds an address without leaving checkout, and selects it', async () => {
    const fresh = addressFixture({ id: 'addr-new', recipientName: 'Brand New' });
    const { user, calls } = renderCheckout({
      ...delivering,
      addresses: [],
      routes: {
        '/addresses': [ok({ addresses: [] }), created({ address: fresh }), ok({ addresses: [fresh] })],
      },
    });

    await screen.findByRole('heading', { level: 1, name: 'Checkout' });
    await user.click(screen.getByRole('radio', { name: /have it delivered/i }));

    for (const [label, value] of [
      ['who is it for', 'Brand New'],
      ['phone', '+919812345678'],
      ['flat, house or building', '9 New Road'],
      ['^city', 'Ludhiana'],
      ['^state', 'Punjab'],
      ['PIN code', '141002'],
    ]) {
      const input = screen.getByLabelText(new RegExp(label, 'i'));
      await user.clear(input);
      await user.type(input, value);
    }
    await user.click(screen.getByRole('button', { name: /use this address/i }));

    await waitFor(() => expect(calls.some((call) => call.method === 'POST' && call.url.endsWith('/addresses'))).toBe(true));
    // The new address becomes the chosen one, and the quote follows.
    await waitFor(() => expect(quoteCalls(calls).at(-1).body.addressId).toBe('addr-new'));
  });

  it('offers to deliver somewhere else', async () => {
    const { user } = renderCheckout({ ...delivering });

    await screen.findByRole('heading', { level: 1, name: 'Checkout' });
    await user.click(screen.getByRole('radio', { name: /have it delivered/i }));
    await user.click(await screen.findByRole('button', { name: /deliver somewhere else/i }));

    expect(screen.getByLabelText(/who is it for/i)).toBeInTheDocument();
  });
});

describe('the review', () => {
  it('shows the lines and the quote’s totals', async () => {
    renderCheckout();

    // The step heading renders before the quote resolves, so the wait is on the
    // content rather than the heading.
    expect(await screen.findByText(/basmati rice/i)).toBeInTheDocument();
    // The line total and the grand total are the same number with one line, so
    // the button says which one this assertion is about.
    expect(screen.getByRole('button', { name: /place order/i })).toHaveTextContent('₹258.00');
  });

  it('shows the delivery fee only when delivering', async () => {
    const { user } = renderCheckout({
      routes: {
        '/checkout/quote': [
          ok({ quote: quoteFixture() }),
          ok({
            quote: quoteFixture({
              fulfilmentMode: 'delivery',
              address: addressFixture(),
              totals: { ...quoteFixture().totals, deliveryFeePaise: 2900, totalPaise: 28700 },
            }),
          }),
        ],
      },
    });

    await screen.findByRole('heading', { name: /check it over/i });
    expect(screen.queryByText(/^Delivery$/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: /have it delivered/i }));

    expect(await screen.findByText('₹287.00')).toBeInTheDocument();
  });

  it('says where it is going', async () => {
    renderCheckout();

    expect(await screen.findByText(/collect from sharma kirana store/i)).toBeInTheDocument();
  });

  it('hides the tax row, because prices are tax-inclusive', async () => {
    renderCheckout();

    await screen.findByRole('heading', { name: /check it over/i });
    expect(screen.queryByText(/^Tax$/)).not.toBeInTheDocument();
  });
});

describe('blockers and warnings', () => {
  it('disables the button and says why, with the shortfall', async () => {
    renderCheckout({
      quote: quoteFixture({
        canPlaceOrder: false,
        blockers: [
          {
            code: 'MINIMUM_ORDER_NOT_MET',
            message: 'Orders from Sharma Kirana Store start at ₹199.00.',
            minOrderPaise: 19900,
            shortfallPaise: 7000,
          },
        ],
      }),
    });

    await screen.findByRole('heading', { level: 1, name: 'Checkout' });
    expect(placeButton()).toBeDisabled();

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/start at ₹199\.00/);
    expect(alert).toHaveTextContent(/Add ₹70\.00 more/);
  });

  it('shows a closed shop as a warning, and still lets the order through', async () => {
    renderCheckout({
      quote: quoteFixture({
        hours: { isOpen: false, opensAt: '08:00' },
        warnings: [
          {
            code: 'STORE_CLOSED',
            message: 'Sharma Kirana Store is closed right now. Your order will be confirmed when they open.',
            opensAt: '08:00',
          },
        ],
        canPlaceOrder: true,
      }),
    });

    await screen.findByRole('heading', { level: 1, name: 'Checkout' });
    // Blocking a closed shop would simply lose the order.
    expect(screen.getByText(/closed right now/i)).toBeInTheDocument();
    expect(placeButton()).toBeEnabled();
  });

  it('renders a missing-address blocker rather than treating it as a failure', async () => {
    // The quote answers 200 with a blocker for anything fixable; it does not error.
    renderCheckout({
      quote: quoteFixture({
        fulfilmentMode: 'delivery',
        address: null,
        canPlaceOrder: false,
        blockers: [{ code: 'ADDRESS_REQUIRED', message: 'Choose a delivery address.' }],
      }),
    });

    await screen.findByRole('heading', { level: 1, name: 'Checkout' });
    expect(await screen.findByText(/choose a delivery address/i)).toBeInTheDocument();
    expect(placeButton()).toBeDisabled();
    // Not an error screen.
    expect(screen.queryByRole('heading', { name: /could not price/i })).not.toBeInTheDocument();
  });

  it('shows an error rather than a broken screen when pricing fails', async () => {
    const { user } = renderCheckout({
      routes: {
        '/checkout/quote': [
          fail(500, 'INTERNAL_ERROR', 'Something went wrong on our end.'),
          ok({ quote: quoteFixture() }),
        ],
      },
    });

    expect(await screen.findByRole('heading', { name: /could not price your order/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /try again/i }));

    expect(await screen.findByRole('button', { name: /place order · ₹258\.00/i })).toBeInTheDocument();
  });
});

describe('placing the order', () => {
  it('sends everything the server needs, including the total the customer saw', async () => {
    const { user, calls } = renderCheckout();

    await screen.findByRole('heading', { level: 1, name: 'Checkout' });
    await user.click(placeButton());

    const post = await waitFor(() => {
      const found = calls.find((call) => call.method === 'POST' && call.url.endsWith('/orders'));
      if (!found) throw new Error('no order POST yet');
      return found;
    });

    expect(post.body).toEqual({
      storeId: STORE_ID,
      fulfilmentMode: 'pickup',
      paymentMethod: 'cash',
      // The server refuses if this no longer matches, so nobody is charged a
      // number they have not seen.
      expectedTotalPaise: 25800,
    });
  });

  it('sends one Idempotency-Key, and the same one on a retry', async () => {
    const { user, calls } = renderCheckout({
      routes: {
        '/orders': [
          fail(503, 'SERVICE_UNAVAILABLE', 'Please try again in a moment.'),
          created({ order: orderFixture() }),
        ],
      },
    });

    await screen.findByRole('heading', { level: 1, name: 'Checkout' });
    await user.click(placeButton());
    await screen.findByRole('alert');
    await user.click(placeButton());

    const posts = calls.filter((call) => call.method === 'POST' && call.url.endsWith('/orders'));
    expect(posts).toHaveLength(2);
    // A new key per tap would place a second order instead of returning the first.
    expect(posts[0].headers['idempotency-key']).toBe(posts[1].headers['idempotency-key']);
    expect(posts[0].headers['idempotency-key']).toBeTruthy();
  });

  it('includes the note when one was written', async () => {
    const { user, calls } = renderCheckout();

    await screen.findByRole('heading', { level: 1, name: 'Checkout' });
    await user.type(screen.getByLabelText(/note for the shop/i), '  Leave at the gate  ');
    await user.click(placeButton());

    const post = await waitFor(() => {
      const found = calls.find((call) => call.method === 'POST' && call.url.endsWith('/orders'));
      if (!found) throw new Error('no order POST yet');
      return found;
    });
    expect(post.body.customerNote).toBe('Leave at the gate');
  });

  it('omits an empty note', async () => {
    const { user, calls } = renderCheckout();

    await screen.findByRole('heading', { level: 1, name: 'Checkout' });
    await user.click(placeButton());

    const post = await waitFor(() => {
      const found = calls.find((call) => call.method === 'POST' && call.url.endsWith('/orders'));
      if (!found) throw new Error('no order POST yet');
      return found;
    });
    expect('customerNote' in post.body).toBe(false);
  });

  it('sends a cash order to its confirmation', async () => {
    const { user } = renderCheckout();

    await screen.findByRole('heading', { level: 1, name: 'Checkout' });
    await user.click(placeButton());

    // Lands on the order itself, with the confirmation banner.
    expect(await screen.findByText(/order placed\./i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'CPSE-260920-ABC123' })).toBeInTheDocument();
  });

  it('sends an online order to the payment screen instead', async () => {
    const { user } = renderCheckout({
      routes: {
        '/orders': created({ order: orderFixture({ status: 'pending_payment' }) }),
      },
    });

    await screen.findByRole('heading', { level: 1, name: 'Checkout' });
    await user.click(await screen.findByRole('radio', { name: /pay online/i }));
    await user.click(placeButton());

    // An online order is not placed until the provider confirms, so the payment
    // screen is where it goes.
    expect(await screen.findByRole('heading', { level: 1, name: /payment|waiting/i })).toBeInTheDocument();
  });

  it('warns about the hand-off before it happens', async () => {
    const { user } = renderCheckout();

    await screen.findByRole('heading', { level: 1, name: 'Checkout' });
    await user.click(await screen.findByRole('radio', { name: /pay online/i }));

    expect(screen.getByText(/taken to our payment partner/i)).toBeInTheDocument();
  });

  it('shows the total on the button', async () => {
    renderCheckout();

    expect(await screen.findByRole('button', { name: /place order · ₹258\.00/i })).toBeInTheDocument();
  });

  it('refuses a total that moved, and re-quotes so the customer sees it', async () => {
    const { user, calls } = renderCheckout({
      routes: {
        '/orders': fail(422, 'TOTAL_CHANGED', 'The total has changed since you last saw it. Please review your order.'),
      },
    });

    await screen.findByRole('heading', { level: 1, name: 'Checkout' });
    const before = quoteCalls(calls).length;
    await user.click(placeButton());

    expect(await screen.findByRole('alert')).toHaveTextContent(/total has changed/i);
    // Re-quoted, so the new number is on screen before they tap again.
    await waitFor(() => expect(quoteCalls(calls).length).toBeGreaterThan(before));
  });

  it('reports an item that sold out at the last moment', async () => {
    const { user } = renderCheckout({
      routes: {
        '/orders': fail(422, 'ITEM_UNAVAILABLE', 'Basmati Rice sold out while you were checking out.'),
      },
    });

    await screen.findByRole('heading', { level: 1, name: 'Checkout' });
    await user.click(placeButton());

    expect(await screen.findByRole('alert')).toHaveTextContent(/sold out while you were checking out/i);
  });

  it('disables the button while placing, so one tap is one order', async () => {
    let release;
    const pending = new Promise((settle) => {
      release = settle;
    });
    const { user } = renderCheckout({ routes: { '/orders': () => pending } });

    await screen.findByRole('heading', { level: 1, name: 'Checkout' });
    await user.click(placeButton());

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /placing your order/i })).toBeDisabled(),
    );
    release(created({ order: orderFixture() }));
  });

  it('offers the way back to the cart', async () => {
    renderCheckout();

    expect(await screen.findByRole('link', { name: /back to cart/i })).toHaveAttribute(
      'href',
      `/cart/${STORE_ID}`,
    );
  });
});

/**
 * The regression that hung checkout for five minutes.
 *
 * `storeSlug` was in the cart *fixture* and not in the cart *payload*. The store
 * query is chained off it, so it never became enabled, so `store.data` stayed null
 * — and the screen's guard waited on exactly that. Every test passed while the
 * real screen span forever.
 *
 * The backend now sends the field. These cover the other half: a screen must never
 * wait on something that cannot arrive.
 */
describe('a cart with no storeSlug still reaches checkout', () => {
  const slugless = () => {
    const cart = cartFixture();
    delete cart.storeSlug;
    return cart;
  };

  it('renders instead of spinning forever', async () => {
    renderCheckout({ cart: slugless() });

    // The whole bug in one assertion.
    expect(await screen.findByRole('heading', { level: 1, name: 'Checkout' })).toBeInTheDocument();
    expect(screen.queryByText(/getting checkout ready/i)).not.toBeInTheDocument();
  });

  it('still offers both ways to get the order, and lets one be chosen', async () => {
    const { user } = renderCheckout({ cart: slugless() });

    await screen.findByRole('heading', { level: 1, name: 'Checkout' });
    expect(screen.getByRole('radio', { name: /pick it up/i })).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: /have it delivered/i }));
    expect(screen.getByRole('radio', { name: /have it delivered/i })).toBeChecked();
  });

  it('still places the order, because the quote is the authority', async () => {
    const { user, calls } = renderCheckout({ cart: slugless() });

    await screen.findByRole('heading', { level: 1, name: 'Checkout' });
    await user.click(screen.getByRole('button', { name: /place order/i }));

    await waitFor(() =>
      expect(calls.some((call) => call.method === 'POST' && call.url.endsWith('/orders'))).toBe(
        true,
      ),
    );
  });

  it('does not ask for a store it cannot name', async () => {
    const { calls } = renderCheckout({ cart: slugless() });

    await screen.findByRole('heading', { level: 1, name: 'Checkout' });
    expect(calls.some((call) => call.url.includes('/stores/undefined'))).toBe(false);
    expect(calls.some((call) => call.url.includes('/stores/null'))).toBe(false);
  });

  it('renders when the store request itself fails', async () => {
    renderCheckout({ routes: { '/stores/sharma-kirana': fail(500, 'INTERNAL_ERROR') } });

    // A shop we cannot load costs the fulfilment detail, not the whole screen.
    expect(await screen.findByRole('heading', { level: 1, name: 'Checkout' })).toBeInTheDocument();
  });
});
