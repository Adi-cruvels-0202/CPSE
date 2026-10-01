import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../src/context/AuthContext.jsx';
import { AppRoutes } from '../src/router.jsx';
import { clearSession, writeSession } from '../src/lib/tokens.js';
import { outcomeOf } from '../src/routes/payment/PaymentPage.jsx';
import {
  customerFixture,
  fail,
  mockRoutes,
  ok,
  orderDetailFixture,
  orderFixture,
  sessionFixture,
} from './helpers/api.js';

/**
 * Checklist 11.9 — the payment result.
 *
 * The claim under test throughout: the screen reports what the ORDER says, never
 * what the URL the customer arrived on says. A gateway can send someone to a
 * success URL for a payment that never completed.
 */

const ROUTER_FUTURE = { v7_startTransition: true, v7_relativeSplatPath: true };

function renderPayment(path = '/payment/order-1', { order, routes = {}, signedIn = true } = {}) {
  if (signedIn) writeSession(sessionFixture());
  else clearSession();

  const mocked = mockRoutes({
    '/me': ok({ customer: customerFixture() }),
    '/orders/order-1': ok({ order: order ?? orderDetailFixture({ status: 'pending_payment', paymentStatus: 'pending' }) }),
    '/payments/order-1/verify': ok({ order: orderFixture(), payment: { status: 'paid' } }),
    '/payments/order-1/initiate': ok({
      payment: { id: 'pay-1', providerRef: 'mock_abc', status: 'processing' },
      clientPayload: { checkoutUrl: 'http://localhost:3000/mock-payment?ref=mock_abc', isMockProvider: true },
    }),
    '/orders': ok({ orders: [] }, { page: 1, limit: 10, total: 0, totalPages: 0, hasNextPage: false }),
    ...routes,
  });

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

const paid = () =>
  orderDetailFixture({ status: 'placed', statusLabel: 'Order placed', paymentStatus: 'paid' });
const failed = () =>
  orderDetailFixture({ status: 'pending_payment', statusLabel: 'Awaiting payment', paymentStatus: 'failed' });
const cancelled = () =>
  orderDetailFixture({ status: 'cancelled', statusLabel: 'Cancelled', paymentStatus: 'cancelled' });

describe('the four outcomes', () => {
  it('says the payment was received when the order says it was paid', async () => {
    renderPayment('/payment/order-1', { order: paid() });

    expect(await screen.findByRole('heading', { level: 1, name: /payment received/i })).toBeInTheDocument();
    expect(screen.getByText(/your order is confirmed/i)).toBeInTheDocument();
  });

  it('says it failed, and offers another go', async () => {
    renderPayment('/payment/order-1', { order: failed() });

    expect(await screen.findByRole('heading', { level: 1, name: /did not go through/i })).toBeInTheDocument();
    expect(screen.getByText(/nothing has been charged/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try paying again/i })).toBeInTheDocument();
  });

  it('says it was cancelled, and does not offer a retry', async () => {
    renderPayment('/payment/order-1', { order: cancelled() });

    expect(await screen.findByRole('heading', { level: 1, name: /payment cancelled/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /try paying again/i })).not.toBeInTheDocument();
  });

  it('waits when the provider has not decided', async () => {
    renderPayment('/payment/order-1', {
      order: orderDetailFixture({ status: 'pending_payment', paymentStatus: 'processing' }),
      routes: { '/payments/order-1/verify': ok({ order: orderFixture(), payment: { status: 'processing' } }) },
    });

    expect(await screen.findByRole('heading', { level: 1, name: /waiting on your payment/i })).toBeInTheDocument();
    // Awaited, not fetched synchronously: the arrival verify is in flight at first,
    // and the button reads "Checking…" until it settles.
    expect(await screen.findByRole('button', { name: /check again now/i })).toBeInTheDocument();
  });
});

describe('the URL claim decides nothing', () => {
  it('does not claim success just because the URL says so', async () => {
    // A gateway can return someone to a success URL for a payment that failed.
    renderPayment('/payment/order-1?outcome=success', {
      order: failed(),
      routes: { '/payments/order-1/verify': ok({ order: orderFixture(), payment: { status: 'failed' } }) },
    });

    expect(await screen.findByRole('heading', { level: 1, name: /did not go through/i })).toBeInTheDocument();
    expect(screen.queryByText(/payment received/i)).not.toBeInTheDocument();
  });

  it('passes the claim to the server as something to verify', async () => {
    const { calls } = renderPayment('/payment/order-1?outcome=failure');

    await waitFor(() => {
      const verify = calls.find((call) => call.url.includes('/verify'));
      expect(verify).toBeDefined();
      // The mock provider is told which outcome to produce; a real one decides for
      // itself and this is simply absent.
      expect(verify.body).toEqual({ outcome: 'failure' });
    });
  });

  it('verifies once on arrival, not repeatedly', async () => {
    const { calls } = renderPayment('/payment/order-1?outcome=success');

    await waitFor(() => expect(calls.some((call) => call.url.includes('/verify'))).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Asking the provider again about a payment it has answered is noise.
    expect(calls.filter((call) => call.url.includes('/verify'))).toHaveLength(1);
  });

  it('does not verify an order that has already settled', async () => {
    const { calls } = renderPayment('/payment/order-1', { order: paid() });

    await screen.findByRole('heading', { level: 1, name: /payment received/i });
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(calls.some((call) => call.url.includes('/verify'))).toBe(false);
  });
});

describe('a return in a fresh tab', () => {
  it('asks for a sign-in rather than redirecting, and keeps the order', async () => {
    renderPayment('/payment/order-1?outcome=success', { signedIn: false });

    // Losing the customer to a redirect at this moment is the worst outcome.
    expect(await screen.findByRole('heading', { name: /sign in to see your payment/i })).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Sign in' });
    expect(link).toHaveAttribute('href', '/login');
  });

  it('asks the server nothing while signed out', async () => {
    const { calls } = renderPayment('/payment/order-1', { signedIn: false });

    await screen.findByRole('heading', { name: /sign in to see your payment/i });
    expect(calls.some((call) => call.url.includes('/orders/'))).toBe(false);
  });
});

describe('the facts on screen', () => {
  it('shows the order number, amount and shop', async () => {
    renderPayment('/payment/order-1', { order: paid() });

    await screen.findByRole('heading', { level: 1, name: /payment received/i });
    expect(screen.getByText('CPSE-260920-ABC123')).toBeInTheDocument();
    expect(screen.getByText('₹258.00')).toBeInTheDocument();
    expect(screen.getByText('Sharma Kirana Store')).toBeInTheDocument();
  });

  it('links on to the order and the list', async () => {
    renderPayment('/payment/order-1', { order: paid() });

    expect(await screen.findByRole('link', { name: /view the order/i })).toHaveAttribute(
      'href',
      '/orders/order-1',
    );
    expect(screen.getByRole('link', { name: /all orders/i })).toHaveAttribute('href', '/orders');
  });

  it('reports a verify failure without pretending anything settled', async () => {
    renderPayment('/payment/order-1', {
      routes: { '/payments/order-1/verify': fail(503, 'SERVICE_UNAVAILABLE', 'The payment service is busy.') },
    });

    expect(await screen.findByRole('alert')).toHaveTextContent(/payment service is busy/i);
    expect(screen.getByRole('heading', { level: 1, name: /waiting on your payment/i })).toBeInTheDocument();
  });

  it('404s politely for an order that is not theirs', async () => {
    renderPayment('/payment/order-1', {
      routes: { '/orders/order-1': fail(404, 'NOT_FOUND', 'Order was not found.') },
    });

    expect(await screen.findByRole('heading', { name: /that order is not here/i })).toBeInTheDocument();
  });
});

describe('the stand-in gateway', () => {
  it('will not show a payment without a provider reference', async () => {
    renderPayment('/mock-payment');

    expect(await screen.findByRole('heading', { name: /nothing to pay for/i })).toBeInTheDocument();
  });

  it('is unmistakably marked as a test page', async () => {
    renderPayment('/mock-payment?ref=mock_abc', {
      routes: {
        '/orders': ok({ orders: [orderFixture({ status: 'pending_payment' })] }, { page: 1, limit: 20, total: 1, totalPages: 1, hasNextPage: false }),
      },
    });

    // A fake payment page that looks real is the one screen never to ship by accident.
    expect(await screen.findByRole('note')).toHaveTextContent(/test payment page — no money moves/i);
  });

  it('offers all four outcomes a gateway can produce', async () => {
    renderPayment('/mock-payment?ref=mock_abc', {
      routes: {
        '/orders': ok({ orders: [orderFixture({ status: 'pending_payment' })] }, { page: 1, limit: 20, total: 1, totalPages: 1, hasNextPage: false }),
      },
    });

    await screen.findByRole('note');
    for (const label of [/pay successfully/i, /decline the card/i, /cancel and go back/i, /leave it pending/i]) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
  });

  it('shows the amount and reference it was handed', async () => {
    renderPayment('/mock-payment?ref=mock_abc', {
      routes: {
        '/orders': ok({ orders: [orderFixture({ status: 'pending_payment' })] }, { page: 1, limit: 20, total: 1, totalPages: 1, hasNextPage: false }),
      },
    });

    await screen.findByRole('note');
    expect(screen.getByText('mock_abc')).toBeInTheDocument();
    expect(screen.getByText('₹258.00')).toBeInTheDocument();
  });

  it('says so when nothing is awaiting payment', async () => {
    renderPayment('/mock-payment?ref=mock_abc');

    expect(await screen.findByText(/no order is waiting for payment/i)).toBeInTheDocument();
  });
});

describe('outcomeOf', () => {
  it('trusts paymentStatus over anything else', () => {
    expect(outcomeOf({ paymentStatus: 'paid', storeName: 'Shop' }).tone).toBe('done');
    expect(outcomeOf({ paymentStatus: 'failed' }).tone).toBe('stopped');
    expect(outcomeOf({ paymentStatus: 'failed' }).canRetry).toBe(true);
  });

  it('treats a cancelled order as cancelled, whatever the payment says', () => {
    expect(outcomeOf({ status: 'cancelled', paymentStatus: 'pending' }).title).toMatch(/cancelled/i);
    expect(outcomeOf({ status: 'cancelled', paymentStatus: 'pending' }).canRetry).toBe(false);
  });

  it('waits on anything undecided', () => {
    expect(outcomeOf({ status: 'pending_payment', paymentStatus: 'pending' }).tone).toBe('waiting');
    expect(outcomeOf({ status: 'pending_payment', paymentStatus: 'processing' }).tone).toBe('waiting');
  });

  it('waits when there is no order yet, rather than guessing', () => {
    expect(outcomeOf(null).tone).toBe('waiting');
  });
});
