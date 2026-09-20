import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../src/context/AuthContext.jsx';
import { AppRoutes } from '../src/router.jsx';
import { writeSession } from '../src/lib/tokens.js';
import {
  cartFixture,
  categoriesFixture,
  customerFixture,
  mockRoutes,
  ok,
  productDetailFixture,
  productListFixture,
  sessionFixture,
  storeFixture,
} from './helpers/api.js';

/**
 * Checklist 11.1 and 11.18 — what is reachable, by whom.
 *
 * The load-bearing claim is that a public store page opens for someone with no
 * account, because that is how a shared link or a QR code is used (spec: public
 * store pages). A regression there is invisible to a developer who is always
 * signed in, so it is asserted from a genuinely empty session.
 */

/** Matches the flags App.jsx passes, so tests exercise the real behaviour. */
const ROUTER_FUTURE = { v7_startTransition: true, v7_relativeSplatPath: true };

function renderAt(path, { signedIn = false } = {}) {
  // Matched by URL, not by order: the store page and the auth provider both
  // fetch on mount and either can win.
  if (signedIn) writeSession(sessionFixture());

  const list = productListFixture();

  mockRoutes({
    '/me': ok({ customer: customerFixture() }),
    '/categories': ok(categoriesFixture()),
    '/products/': ok(productDetailFixture()),
    '/products': ok(list.data, list.meta),
    '/stores/sharma-kirana': ok({ store: storeFixture() }),
    '/cart': ok({ cart: cartFixture() }),
    '/addresses': ok({ addresses: [] }),
    '/payments/methods': ok({ methods: [{ code: 'cash', label: 'Cash', description: 'Pay at the shop' }] }),
    // Checkout reaches the store by slug, which it gets from the cart.
    '/checkout/quote': ok({ quote: null }),
  });

  return render(
    <MemoryRouter initialEntries={[path]} future={ROUTER_FUTURE}>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </MemoryRouter>,
  );
}

const PUBLIC_PATHS = [
  ['/', 'Shop nearby'],
  ['/login', 'Sign in'],
  ['/register', 'Create account'],
  ['/forgot-password', 'Forgot password'],
  // No recovery token in the URL, so the screen says the link will not work
  // rather than showing a form that cannot submit. The form itself is covered in
  // tests/auth-screens.test.jsx.
  ['/reset-password', 'That link will not work'],
  ['/store/sharma-kirana', 'Sharma Kirana Store'],
  // The search screen has no h1 of its own — it is one input and its results —
  // so it is covered in tests/store-search.test.jsx rather than by heading here.
  // The real product page; its h1 is the product's own name.
  ['/store/sharma-kirana/product/abc', 'Basmati Rice'],
  ['/payment/order-1', 'Payment result'],
  ['/mock-payment', 'Mock gateway'],
];

const GATED_PATHS = [
  '/cart/store-1',
  '/checkout/store-1',
  '/orders',
  '/orders/order-1',
  '/orders/order-1/receipt',
  '/saved',
  '/notifications',
  '/khata',
  '/khata/account-1',
  '/account',
  '/account/addresses',
];

describe('public routes open with no session at all', () => {
  it.each(PUBLIC_PATHS)('%s renders "%s"', async (path, heading) => {
    renderAt(path);

    expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeInTheDocument();
  });

  it('the search screen opens with no session', async () => {
    renderAt('/store/sharma-kirana/search');

    expect(await screen.findByLabelText(/search this shop/i)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Sign in' })).not.toBeInTheDocument();
  });

  it('a store link never redirects to login', async () => {
    renderAt('/store/sharma-kirana');

    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(
      'Sharma Kirana Store',
    );
    expect(screen.queryByRole('heading', { name: 'Sign in' })).not.toBeInTheDocument();
  });
});

describe('gated routes send a stranger to sign in', () => {
  it.each(GATED_PATHS)('%s redirects', async (path) => {
    renderAt(path);

    expect(await screen.findByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument();
  });
});

describe('gated routes open for a signed-in customer', () => {
  it.each([
    ['/orders', 'Your orders'],
    ['/saved', 'Saved stores'],
    ['/khata', 'Khata'],
    ['/account', 'Account'],
    ['/account/addresses', 'Addresses'],
    ['/cart/store-1', 'Your cart'],
    ['/checkout/store-1', 'Checkout'],
    ['/notifications', 'Notifications'],
  ])('%s renders "%s"', async (path, heading) => {
    renderAt(path, { signedIn: true });

    expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeInTheDocument();
  });

  it('shows a spinner rather than a redirect while the session is being checked', () => {
    writeSession(sessionFixture());
    // The profile call never settles.
    mockRoutes({ '/me': () => new Promise(() => {}) });

    render(
      <MemoryRouter initialEntries={['/orders']} future={ROUTER_FUTURE}>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </MemoryRouter>,
    );

    // Bouncing to login and back is the single most obvious way an app looks
    // broken to a returning customer.
    expect(screen.getByRole('status')).toHaveTextContent(/checking your session/i);
    expect(screen.queryByRole('heading', { name: 'Sign in' })).not.toBeInTheDocument();
  });
});

describe('the rest of the map', () => {
  it('answers an unknown path with a not-found screen, not a blank page', async () => {
    renderAt('/this/does/not/exist');

    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });

  it('sends a bare /cart back to the shop, since there is no store to show', async () => {
    renderAt('/cart', { signedIn: true });

    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(/hello|shop nearby/i);
  });

  it('names the checklist item on every screen that is not built yet', async () => {
    renderAt('/orders', { signedIn: true });

    expect(await screen.findByText(/checklist 11\.10/)).toBeInTheDocument();
  });
});

describe('the shell', () => {
  it('hides the bottom tabs from a visitor who is not signed in', async () => {
    renderAt('/');

    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument();
  });

  it('shows the bottom tabs to a signed-in customer', async () => {
    renderAt('/orders', { signedIn: true });

    const nav = await screen.findByRole('navigation', { name: 'Main' });
    expect(nav).toBeInTheDocument();
    for (const label of ['Shop', 'Orders', 'Saved', 'Account']) {
      expect(screen.getByRole('link', { name: label })).toBeInTheDocument();
    }
  });

  it('hides the tabs on a public store page even when signed in', async () => {
    renderAt('/store/sharma-kirana', { signedIn: true });

    await screen.findByRole('heading', { level: 1, name: 'Sharma Kirana Store' });
    await waitFor(() =>
      expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument(),
    );
  });

  it('marks the current tab for assistive tech, not just with colour', async () => {
    renderAt('/orders', { signedIn: true });

    const ordersTab = await screen.findByRole('link', { name: 'Orders' });
    expect(ordersTab).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Saved' })).not.toHaveAttribute('aria-current');
  });

  it('offers a skip link and a main landmark', async () => {
    renderAt('/');

    expect(await screen.findByRole('link', { name: /skip to content/i })).toHaveAttribute(
      'href',
      '#main',
    );
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main');
  });
});
