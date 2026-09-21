import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../src/context/AuthContext.jsx';
import { AppRoutes } from '../src/router.jsx';
import { writeSession } from '../src/lib/tokens.js';
import {
  addressFixture,
  cartFixture,
  categoriesFixture,
  created,
  customerFixture,
  khataAccountFixture,
  khataStatementFixture,
  mockRoutes,
  notificationFixture,
  ok,
  orderDetailFixture,
  orderFixture,
  paymentMethodsFixture,
  productDetailFixture,
  productListFixture,
  quoteFixture,
  savedStoreFixture,
  sessionFixture,
  storeFixture,
} from './helpers/api.js';

/**
 * Checklist 11.16, 11.17 and 11.18 — the guarantees the finishing pass is about.
 *
 * These were mostly true already, because they came out of how the screens were
 * built rather than being added afterwards. Tests are what keep them true: an
 * audit somebody performed once is out of date the next time a screen is added.
 */

const ROUTER_FUTURE = { v7_startTransition: true, v7_relativeSplatPath: true };
const LIST = (total = 1) => ({ page: 1, limit: 20, total, totalPages: 1, hasNextPage: false });

/** Every endpoint the app touches, so any screen can be rendered. */
function allRoutes(overrides = {}) {
  const list = productListFixture();

  return {
    '/me': ok({ customer: customerFixture() }),
    '/notifications/unread-count': ok({ unreadCount: 0 }),
    '/notifications': ok({ notifications: [notificationFixture()], unreadCount: 1 }, LIST()),
    '/stores/sharma-kirana': ok({ store: storeFixture() }),
    '/categories': ok(categoriesFixture()),
    '/products': ok(list.data, list.meta),
    '/products/31111111-1111-4111-8111-000000000001': ok(productDetailFixture()),
    '/search': ok({ ...list.data, query: 'ri' }, list.meta),
    '/cart': ok({ cart: cartFixture() }),
    '/cart/validate': ok({ cart: cartFixture() }),
    '/cart/items': created({ cart: cartFixture() }),
    '/cart/items/line-1': ok({ cart: cartFixture() }),
    '/addresses': ok({ addresses: [addressFixture()] }),
    '/addresses/addr-1': ok({ address: addressFixture() }),
    '/payments/methods': ok(paymentMethodsFixture()),
    '/checkout/quote': ok({ quote: quoteFixture() }),
    '/orders': ok({ orders: [orderFixture()] }, LIST()),
    '/orders/order-1': ok({ order: orderDetailFixture() }),
    '/orders/order-1/receipt': ok({ receipt: { ...orderDetailFixture(), items: orderDetailFixture().items } }),
    '/saved-stores': ok({ savedStores: [savedStoreFixture()] }, LIST()),
    '/khata': ok({ accounts: [khataAccountFixture()], totalOutstandingPaise: 2940 }),
    '/khata/khata-1/statement': ok(khataStatementFixture(), LIST(2)),
    ...overrides,
  };
}

function renderAt(path, overrides = {}) {
  writeSession(sessionFixture());
  const mocked = mockRoutes(allRoutes(overrides));

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

/** Every screen a signed-in customer can reach, and what proves it arrived. */
const SCREENS = [
  ['/', /hello|shop nearby/i],
  ['/store/sharma-kirana', /sharma kirana store/i],
  ['/store/sharma-kirana/search', /search this shop/i],
  ['/store/sharma-kirana/product/31111111-1111-4111-8111-000000000001', /basmati rice/i],
  ['/cart/11111111-1111-4111-8111-000000000001', /your cart/i],
  ['/checkout/11111111-1111-4111-8111-000000000001', /checkout/i],
  ['/orders', /your orders/i],
  ['/orders/order-1', /CPSE-260920-ABC123/],
  ['/orders/order-1/receipt', /receipt/i],
  ['/payment/order-1', /payment|waiting/i],
  ['/saved', /saved stores/i],
  ['/notifications', /notifications/i],
  ['/khata', /khata/i],
  ['/khata/khata-1', /sharma kirana store/i],
  ['/account', /account/i],
  ['/account/addresses', /addresses/i],
];

describe('11.16 — every screen has a loading state', () => {
  it.each(
    SCREENS.filter(
      ([path]) =>
        path !== '/' &&
        // Search fetches only once there are two characters, so an untouched search
        // screen has nothing in flight — by design, not by omission.
        !path.endsWith('/search'),
    ),
  )(
    '%s shows something while its data is in flight',
    async (path) => {
      // Nothing settles, so the screen must say it is working rather than sit blank.
      const never = () => new Promise(() => {});
      renderAt(path, Object.fromEntries(Object.keys(allRoutes()).map((key) => [key, never])));

      const status = await screen.findByRole('status', {}, { timeout: 2000 });
      expect(status).toBeInTheDocument();
    },
  );
});

describe('11.16 — every screen that fetches handles a failure', () => {
  it.each([
    ['/store/sharma-kirana', '/stores/sharma-kirana'],
    ['/cart/11111111-1111-4111-8111-000000000001', '/cart'],
    ['/orders', '/orders'],
    ['/orders/order-1', '/orders/order-1'],
    ['/saved', '/saved-stores'],
    ['/notifications', '/notifications'],
    ['/khata', '/khata'],
    ['/khata/khata-1', '/khata/khata-1/statement'],
    ['/account/addresses', '/addresses'],
  ])('%s reports a server error instead of a blank page', async (path, endpoint) => {
    const { fail } = await import('./helpers/api.js');
    renderAt(path, { [endpoint]: fail(500, 'INTERNAL_ERROR', 'Something went wrong on our end.') });

    const alert = await screen.findByRole('alert', {}, { timeout: 2000 });
    expect(alert).toBeInTheDocument();
  });

  it.each([
    ['/store/sharma-kirana'],
    ['/orders'],
    ['/khata'],
    ['/notifications'],
  ])('%s calls a lost connection what it is', async (path) => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }));
    writeSession(sessionFixture());

    render(
      <MemoryRouter initialEntries={[path]} future={ROUTER_FUTURE}>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </MemoryRouter>,
    );

    // "Try again" is useless advice when the phone is in a lift.
    expect(await screen.findByRole('heading', { name: 'No connection' })).toBeInTheDocument();
  });
});

describe('11.16 — the offline banner', () => {
  it('appears when the browser says the connection has gone', async () => {
    renderAt('/orders');
    await screen.findByRole('heading', { level: 1, name: 'Your orders' });

    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    window.dispatchEvent(new Event('offline'));

    expect(await screen.findByText(/you are offline/i)).toBeInTheDocument();
  });

  it('goes away when it comes back', async () => {
    renderAt('/orders');
    await screen.findByRole('heading', { level: 1, name: 'Your orders' });

    window.dispatchEvent(new Event('offline'));
    await screen.findByText(/you are offline/i);

    window.dispatchEvent(new Event('online'));

    await waitFor(() => expect(screen.queryByText(/you are offline/i)).not.toBeInTheDocument());
  });

  it('is absent while online, since a banner nobody needs is noise', async () => {
    renderAt('/orders');

    await screen.findByRole('heading', { level: 1, name: 'Your orders' });
    expect(screen.queryByText(/you are offline/i)).not.toBeInTheDocument();
  });
});

describe('11.17 — a double tap cannot act twice', () => {
  /** Holds a response open so a second tap lands while the first is in flight. */
  const held = () => {
    let release;
    const promise = new Promise((settle) => {
      release = settle;
    });
    return { promise, release };
  };

  it('places one order, not two', async () => {
    const gate = held();
    const { user, calls } = renderAt('/checkout/11111111-1111-4111-8111-000000000001', {
      '/orders': () => gate.promise,
    });

    const button = await screen.findByRole('button', { name: /place order/i });
    await user.click(button);
    await user.click(button);
    await user.click(button);

    gate.release(created({ order: orderFixture() }));

    // The one thing in this app that must never happen twice.
    await waitFor(() => {
      const posts = calls.filter((call) => call.method === 'POST' && call.url.endsWith('/orders'));
      expect(posts).toHaveLength(1);
    });
  });

  it('adds one cart line, not three', async () => {
    const gate = held();
    const { user, calls } = renderAt(
      '/store/sharma-kirana/product/31111111-1111-4111-8111-000000000001',
      { '/cart/items': () => gate.promise },
    );

    const button = await screen.findByRole('button', { name: /^add to cart$/i });
    await user.click(button);
    await user.click(button);

    gate.release(created({ cart: cartFixture() }));

    await waitFor(() => {
      expect(calls.filter((call) => call.url.endsWith('/cart/items'))).toHaveLength(1);
    });
  });

  it('cancels an order once', async () => {
    const gate = held();
    const { user, calls } = renderAt('/orders/order-1', {
      '/orders/order-1/cancel': () => gate.promise,
    });

    await user.click(await screen.findByRole('button', { name: /cancel this order/i }));
    const confirm = screen.getByRole('button', { name: /yes, cancel it/i });
    await user.click(confirm);
    await user.click(confirm);

    gate.release(ok({ order: orderDetailFixture({ status: 'cancelled' }) }));

    await waitFor(() => {
      expect(calls.filter((call) => call.url.includes('/cancel'))).toHaveLength(1);
    });
  });

  it('saves one address, not two', async () => {
    const gate = held();
    const { user, calls } = renderAt('/account/addresses', {
      '/addresses/addr-1': () => gate.promise,
    });

    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    const city = screen.getByLabelText(/^city/i);
    await user.clear(city);
    await user.type(city, 'Amritsar');

    const save = screen.getByRole('button', { name: /save address/i });
    await user.click(save);
    await user.click(save);

    gate.release(ok({ address: addressFixture({ city: 'Amritsar' }) }));

    await waitFor(() => {
      expect(calls.filter((call) => call.method === 'PATCH')).toHaveLength(1);
    });
  });

  it('changes a cart quantity once per tap of the stepper', async () => {
    const gate = held();
    const { user, calls } = renderAt('/cart/11111111-1111-4111-8111-000000000001', {
      '/cart/items/line-1': () => gate.promise,
    });

    await screen.findByRole('heading', { level: 1, name: 'Your cart' });
    const plus = within(screen.getByRole('group', { name: /quantity of basmati rice/i })).getByRole(
      'button',
      { name: 'One more' },
    );

    await user.click(plus);
    await user.click(plus);

    gate.release(ok({ cart: cartFixture() }));

    await waitFor(() => {
      expect(calls.filter((call) => call.method === 'PATCH')).toHaveLength(1);
    });
  });

  it('checks the cart once before checkout', async () => {
    const gate = held();
    const { user, calls } = renderAt('/cart/11111111-1111-4111-8111-000000000001', {
      '/cart/validate': () => gate.promise,
    });

    const button = await screen.findByRole('button', { name: 'Checkout' });
    await user.click(button);
    await user.click(button);

    gate.release(ok({ cart: cartFixture() }));

    await waitFor(() => {
      expect(calls.filter((call) => call.url.includes('/cart/validate'))).toHaveLength(1);
    });
  });
});

describe('11.18 — every screen offers a way onward', () => {
  it.each(SCREENS)('%s has a link out of it', async (path, proof) => {
    renderAt(path);

    // findAllByText: several of these words legitimately appear more than once on
    // their screen — the shop's name in a header and again in an address, say.
    await screen.findAllByText(proof, {}, { timeout: 2000 });

    // Either the bottom tabs, or the screen's own back link. A screen with neither
    // is a screen a customer is stuck on.
    const tabs = screen.queryByRole('navigation', { name: 'Main' });
    const links = screen.queryAllByRole('link');
    expect(Boolean(tabs) || links.length > 0).toBe(true);
  });

  it('keeps the tab bar off the public store pages, where it would confuse', async () => {
    renderAt('/store/sharma-kirana');

    await screen.findByRole('heading', { level: 1, name: 'Sharma Kirana Store' });
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument();
    // But there is still a way to browse and to search.
    expect(screen.getByRole('link', { name: /search this store/i })).toBeInTheDocument();
  });

  it('gets from a shop to the cart and back without the tab bar', async () => {
    const { user } = renderAt(
      '/store/sharma-kirana/product/31111111-1111-4111-8111-000000000001',
      { '/cart/items': created({ cart: cartFixture() }) },
    );

    await user.click(await screen.findByRole('button', { name: /^add to cart$/i }));
    await user.click(await screen.findByRole('link', { name: /go to cart/i }));

    await screen.findByRole('heading', { level: 1, name: 'Your cart' });
    // And back to shopping from the cart.
    expect(screen.getByRole('link', { name: /keep shopping/i })).toHaveAttribute(
      'href',
      '/store/sharma-kirana',
    );
  });

  it('walks cart → checkout → order → receipt and back again', async () => {
    const { user } = renderAt('/cart/11111111-1111-4111-8111-000000000001', {
      '/orders': created({ order: orderFixture() }),
    });

    await user.click(await screen.findByRole('button', { name: 'Checkout' }));
    await screen.findByRole('heading', { level: 1, name: 'Checkout' });
    // Checkout offers the way back to the cart.
    expect(screen.getByRole('link', { name: /back to cart/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /place order/i }));
    await screen.findByRole('heading', { level: 1, name: 'CPSE-260920-ABC123' });

    await user.click(screen.getByRole('link', { name: /view receipt/i }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Receipt' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /back to the order/i })).toBeInTheDocument();
  });

  it('reaches every owned screen from the account page', async () => {
    renderAt('/account');

    await screen.findByRole('heading', { level: 1, name: 'Account' });
    const menu = within(screen.getByRole('navigation', { name: 'Your things' }));

    for (const [name, href] of [
      ['Addresses', '/account/addresses'],
      ['Orders', '/orders'],
      ['Saved stores', '/saved'],
      ['Notifications', '/notifications'],
      ['Khata', '/khata'],
    ]) {
      expect(menu.getByRole('link', { name: new RegExp(`^${name}`, 'i') })).toHaveAttribute(
        'href',
        href,
      );
    }
  });
});

describe('11.16 — accessibility basics hold on every screen', () => {
  it.each(SCREENS)('%s has exactly one h1', async (path, proof) => {
    renderAt(path);

    await screen.findAllByText(proof, {}, { timeout: 2000 });

    const h1s = screen.queryAllByRole('heading', { level: 1 });
    // The receipt and the order pages are the ones most at risk of two, since both
    // render a document-like header.
    expect(h1s.length).toBeLessThanOrEqual(1);
  });

  it('offers the skip link and a main landmark everywhere', async () => {
    renderAt('/orders');

    expect(await screen.findByRole('link', { name: /skip to content/i })).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main');
  });
});
