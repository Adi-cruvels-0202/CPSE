import { describe, it, expect } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../src/context/AuthContext.jsx';
import { AppRoutes } from '../src/router.jsx';
import { writeSession } from '../src/lib/tokens.js';
import { formatWhen, meaningFor, toneFor } from '../src/lib/orderStatus.js';
import {
  cartFixture,
  customerFixture,
  fail,
  mockRoutes,
  noContent,
  ok,
  orderDetailFixture,
  orderFixture,
  orderItemFixture,
  receiptFixture,
  sessionFixture,
} from './helpers/api.js';

/** Checklist 11.10 and 11.11 — order history, detail, receipt and reorder. */

const ROUTER_FUTURE = { v7_startTransition: true, v7_relativeSplatPath: true };
const LIST_META = { page: 1, limit: 10, total: 1, totalPages: 1, hasNextPage: false };

function renderAt(path, { orders = [orderFixture()], meta = LIST_META, routes = {} } = {}) {
  writeSession(sessionFixture());

  const mocked = mockRoutes({
    '/me': ok({ customer: customerFixture() }),
    '/orders': ok({ orders }, meta),
    '/orders/order-1': ok({ order: orderDetailFixture() }),
    '/orders/order-1/receipt': ok({ receipt: receiptFixture() }),
    '/cart': ok({ cart: cartFixture() }),
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

describe('the order list', () => {
  it('needs a session', async () => {
    mockRoutes({ '/orders': ok({ orders: [] }, LIST_META) });

    render(
      <MemoryRouter initialEntries={['/orders']} future={ROUTER_FUTURE}>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('shows enough on each row to decide whether to open it', async () => {
    renderAt('/orders');

    await screen.findByRole('heading', { level: 1, name: 'Your orders' });
    expect(screen.getByText('Sharma Kirana Store')).toBeInTheDocument();
    expect(screen.getByText('CPSE-260920-ABC123')).toBeInTheDocument();
    expect(screen.getByText('Order placed')).toBeInTheDocument();
    expect(screen.getByText('₹258.00')).toBeInTheDocument();

    // The meta line is separate elements now, so each piece is asserted on its
    // own rather than as one run of text.
    const row = screen.getByRole('link', { name: /sharma kirana store/i });
    expect(row).toHaveTextContent('1 item');
    expect(row).toHaveTextContent('Pickup');
  });

  it('draws a progress track on a live order and none on a finished one', async () => {
    const { container } = renderAt('/orders');

    await screen.findByRole('heading', { level: 1, name: 'Your orders' });
    // 'placed' is step one of four, so the track is there and partly filled.
    expect(container.querySelector('.order-row__track')).not.toBeNull();
  });

  it('draws no track once the order is over', async () => {
    const { container } = renderAt('/orders', {
      orders: [orderFixture({ status: 'completed', statusLabel: 'Completed' })],
    });

    // The filter chip is also called "Completed", so this is scoped to the row.
    await screen.findByRole('link', { name: /sharma kirana store/i });
    // A progress bar on a finished order is decoration; on a cancelled one it
    // would be a lie.
    expect(container.querySelector('.order-row__track')).toBeNull();
  });

  it('links each row to the order', async () => {
    renderAt('/orders');

    const link = await screen.findByRole('link', { name: /sharma kirana store/i });
    expect(link).toHaveAttribute('href', '/orders/order-1');
  });

  it('filters by status through the URL', async () => {
    const { user, calls } = renderAt('/orders');

    await screen.findByRole('heading', { level: 1, name: 'Your orders' });
    await user.click(screen.getByRole('button', { name: 'Completed' }));

    await waitFor(() => {
      const last = calls.filter((call) => call.url.includes('/orders?')).at(-1);
      expect(new URL(last.url).searchParams.get('status')).toBe('completed');
    });
  });

  it('reads the filter from the URL, so a filtered view can be shared', async () => {
    const { calls } = renderAt('/orders?status=cancelled');

    await waitFor(() => {
      const first = calls.find((call) => call.url.includes('/orders?'));
      expect(new URL(first.url).searchParams.get('status')).toBe('cancelled');
    });
    expect(screen.getByRole('button', { name: 'Cancelled' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('says so when there are none at all', async () => {
    renderAt('/orders', { orders: [], meta: { ...LIST_META, total: 0 } });

    expect(
      await screen.findByRole('heading', { name: /have not ordered anything yet/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /find a shop/i })).toBeInTheDocument();
  });

  it('offers a way out of an empty filter', async () => {
    const { user, calls } = renderAt('/orders?status=completed', {
      orders: [],
      meta: { ...LIST_META, total: 0 },
    });

    expect(await screen.findByRole('heading', { name: /no completed orders/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /show all orders/i }));

    await waitFor(() => {
      const last = calls.filter((call) => call.url.includes('/orders?')).at(-1);
      expect(new URL(last.url).searchParams.has('status')).toBe(false);
    });
  });

  it('pages through older orders', async () => {
    const { user, calls } = renderAt('/orders', {
      meta: { page: 1, limit: 10, total: 25, totalPages: 3, hasNextPage: true },
    });

    await user.click(await screen.findByRole('button', { name: /show older orders/i }));

    await waitFor(() => {
      const last = calls.filter((call) => call.url.includes('/orders?')).at(-1);
      expect(new URL(last.url).searchParams.get('page')).toBe('2');
    });
  });

  it('offers a retry when the list will not load', async () => {
    const { user } = renderAt('/orders', {
      routes: {
        '/orders': [fail(500, 'INTERNAL_ERROR', 'Something went wrong on our end.'), ok({ orders: [orderFixture()] }, LIST_META)],
      },
    });

    expect(await screen.findByRole('heading', { name: /could not load your orders/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /try again/i }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Your orders' })).toBeInTheDocument();
  });
});

describe('the order detail', () => {
  it('shows the number, shop, status and what it means', async () => {
    renderAt('/orders/order-1');

    expect(
      await screen.findByRole('heading', { level: 1, name: 'CPSE-260920-ABC123' }),
    ).toBeInTheDocument();
    // The shop's name appears in the header line and again under "Collect from",
    // so the assertion says which.
    expect(screen.getByText(/sharma kirana store · 20 sep/i)).toBeInTheDocument();
    expect(screen.getByText('Order placed', { selector: '.status' })).toBeInTheDocument();
    // `statusLabel` names the state; this says what it means for the customer now.
    expect(screen.getByText(/sent to the shop/i)).toBeInTheDocument();
  });

  it('shows the items and the totals from the order’s own snapshot', async () => {
    renderAt('/orders/order-1');

    await screen.findByRole('heading', { level: 1, name: 'CPSE-260920-ABC123' });
    expect(screen.getByText('Basmati Rice')).toBeInTheDocument();
    expect(screen.getByText(/2 × ₹129\.00/)).toBeInTheDocument();
  });

  it('shows the timeline this order actually takes', async () => {
    renderAt('/orders/order-1');

    await screen.findByRole('heading', { name: 'Progress' });
    // A pickup order has no "out for delivery" step — the server decides the path.
    expect(screen.getByText('Ready for pickup')).toBeInTheDocument();
    expect(screen.queryByText('Out for delivery')).not.toBeInTheDocument();
  });

  it('marks the current step for assistive tech, not only with colour', async () => {
    renderAt('/orders/order-1');

    await screen.findByRole('heading', { name: 'Progress' });
    const current = screen.getByText('Order placed', { selector: '.timeline__label' });
    expect(current.closest('li')).toHaveAttribute('aria-current', 'step');
  });

  it('shows what happened instead of a path for a cancelled order', async () => {
    renderAt('/orders/order-1', {
      routes: {
        '/orders/order-1': ok({
          order: orderDetailFixture({
            status: 'cancelled',
            statusLabel: 'Cancelled',
            isCancellable: false,
            cancellationReason: 'Changed my mind',
            timeline: {
              steps: [],
              history: [
                { fromStatus: null, toStatus: 'placed', label: 'Order placed', at: '2026-09-20T16:17:28Z' },
                { fromStatus: 'placed', toStatus: 'cancelled', label: 'Cancelled', note: 'Changed my mind', at: '2026-09-20T17:00:00Z' },
              ],
            },
          }),
        }),
      },
    });

    await screen.findByRole('heading', { name: 'Progress' });
    expect(screen.getByText('Cancelled', { selector: '.timeline__label' })).toBeInTheDocument();
    expect(screen.getByText(/reason given: changed my mind/i)).toBeInTheDocument();
  });

  it('says where to collect it, from the order’s snapshot', async () => {
    renderAt('/orders/order-1');

    await screen.findByRole('heading', { name: /collect from/i });
    expect(screen.getByText('14 Model Town Road')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /call the shop/i })).toHaveAttribute(
      'href',
      'tel:+919812345601',
    );
  });

  it('says where it is going for a delivery order', async () => {
    renderAt('/orders/order-1', {
      routes: {
        '/orders/order-1': ok({
          order: orderDetailFixture({
            fulfilmentMode: 'delivery',
            fulfilment: {
              mode: 'delivery',
              deliverTo: {
                recipientName: 'Test Customer',
                line1: '221B Model Town',
                city: 'Ludhiana',
                state: 'Punjab',
                postalCode: '141002',
                phone: '+919876543210',
              },
            },
          }),
        }),
      },
    });

    await screen.findByRole('heading', { name: /delivering to/i });
    expect(screen.getByText('221B Model Town')).toBeInTheDocument();
  });

  it('shows the customer’s note back to them', async () => {
    renderAt('/orders/order-1', {
      routes: {
        '/orders/order-1': ok({ order: orderDetailFixture({ customerNote: 'Leave at the gate' }) }),
      },
    });

    await screen.findByRole('heading', { name: 'Your note' });
    expect(screen.getByText('Leave at the gate')).toBeInTheDocument();
  });

  it('confirms an order that was just placed', async () => {
    // Checkout navigates here with state.justPlaced.
    writeSession(sessionFixture());
    mockRoutes({
      '/me': ok({ customer: customerFixture() }),
      '/orders/order-1': ok({ order: orderDetailFixture() }),
    });

    render(
      <MemoryRouter
        initialEntries={[{ pathname: '/orders/order-1', state: { justPlaced: true } }]}
        future={ROUTER_FUTURE}
      >
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText(/order placed\./i)).toBeInTheDocument();
    expect(screen.getByText(/has it now/i)).toBeInTheDocument();
  });

  it('pushes an unpaid order towards paying', async () => {
    renderAt('/orders/order-1', {
      routes: {
        '/orders/order-1': ok({
          order: orderDetailFixture({ status: 'pending_payment', statusLabel: 'Awaiting payment' }),
        }),
      },
    });

    expect(await screen.findByText(/not confirmed until the payment goes through/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /finish paying/i })).toHaveAttribute(
      'href',
      '/payment/order-1',
    );
  });

  it('404s politely for an order that is not theirs', async () => {
    renderAt('/orders/order-1', {
      routes: { '/orders/order-1': fail(404, 'NOT_FOUND', 'Order was not found.') },
    });

    expect(await screen.findByRole('heading', { name: /that order is not here/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument();
  });
});

describe('cancelling', () => {
  it('asks first', async () => {
    const { user, calls } = renderAt('/orders/order-1');

    await user.click(await screen.findByRole('button', { name: /cancel this order/i }));

    expect(screen.getByRole('alertdialog')).toHaveTextContent(/cancel cpse-260920-abc123/i);
    expect(calls.some((call) => call.url.includes('/cancel'))).toBe(false);
  });

  it('cancels on confirmation and re-reads the order', async () => {
    const { user, calls } = renderAt('/orders/order-1', {
      routes: {
        '/orders/order-1/cancel': ok({ order: orderDetailFixture({ status: 'cancelled' }) }),
        '/orders/order-1': [
          ok({ order: orderDetailFixture() }),
          ok({ order: orderDetailFixture({ status: 'cancelled', statusLabel: 'Cancelled', isCancellable: false }) }),
        ],
      },
    });

    await user.click(await screen.findByRole('button', { name: /cancel this order/i }));
    await user.click(screen.getByRole('button', { name: /yes, cancel it/i }));

    await waitFor(() => expect(calls.some((call) => call.url.includes('/cancel'))).toBe(true));
    expect(await screen.findByText('Cancelled')).toBeInTheDocument();
  });

  it('says where the money goes before cancelling a paid online order', async () => {
    const { user } = renderAt('/orders/order-1', {
      routes: {
        '/orders/order-1': ok({
          order: orderDetailFixture({ paymentStatus: 'paid', paymentMethod: 'online' }),
        }),
      },
    });

    await user.click(await screen.findByRole('button', { name: /cancel this order/i }));

    const dialog = within(screen.getByRole('alertdialog'));
    expect(dialog.getByText(/refunded to\s+the account you paid from/i)).toBeInTheDocument();
    expect(dialog.getByText(/within 7 working days/i)).toBeInTheDocument();
  });

  it('does not promise a refund on a cash order', async () => {
    const { user } = renderAt('/orders/order-1', {
      routes: {
        '/orders/order-1': ok({ order: orderDetailFixture({ paymentStatus: 'pending' }) }),
      },
    });

    await user.click(await screen.findByRole('button', { name: /cancel this order/i }));

    expect(within(screen.getByRole('alertdialog')).queryByText(/refund/i)).not.toBeInTheDocument();
  });

  it('keeps the refund promise on the order after it is cancelled', async () => {
    renderAt('/orders/order-1', {
      routes: {
        '/orders/order-1': ok({
          order: orderDetailFixture({
            status: 'cancelled',
            statusLabel: 'Cancelled',
            isCancellable: false,
            paymentStatus: 'paid',
          }),
        }),
      },
    });

    // Not only in the confirmation they have already dismissed.
    expect(await screen.findByText(/will be refunded to the account you paid from/i)).toBeInTheDocument();
  });

  it('says so plainly once the refund has actually been made', async () => {
    renderAt('/orders/order-1', {
      routes: {
        '/orders/order-1': ok({
          order: orderDetailFixture({
            status: 'cancelled',
            statusLabel: 'Cancelled',
            isCancellable: false,
            paymentStatus: 'refunded',
          }),
        }),
      },
    });

    expect(await screen.findByText(/has been refunded to the account you paid from/i)).toBeInTheDocument();
    expect(screen.queryByText(/working days/i)).not.toBeInTheDocument();
  });

  it('can be called off', async () => {
    const { user, calls } = renderAt('/orders/order-1');

    await user.click(await screen.findByRole('button', { name: /cancel this order/i }));
    await user.click(screen.getByRole('button', { name: /keep the order/i }));

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(calls.some((call) => call.url.includes('/cancel'))).toBe(false);
  });

  it('is not offered once the order is past cancelling', async () => {
    renderAt('/orders/order-1', {
      routes: {
        '/orders/order-1': ok({
          order: orderDetailFixture({ status: 'completed', statusLabel: 'Completed', isCancellable: false }),
        }),
      },
    });

    await screen.findByRole('heading', { level: 1, name: 'CPSE-260920-ABC123' });
    // The server decides; the screen only reflects isCancellable.
    expect(screen.queryByRole('button', { name: /cancel this order/i })).not.toBeInTheDocument();
  });

  it('reports a refusal from the server', async () => {
    const { user } = renderAt('/orders/order-1', {
      routes: {
        '/orders/order-1/cancel': fail(409, 'CONFLICT', 'This order is already being prepared.'),
      },
    });

    await user.click(await screen.findByRole('button', { name: /cancel this order/i }));
    await user.click(screen.getByRole('button', { name: /yes, cancel it/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/already being prepared/i);
  });
});

describe('reordering (11.11)', () => {
  it('rebuilds the cart and goes to it', async () => {
    const { user, calls } = renderAt('/orders/order-1', {
      routes: {
        '/orders/order-1/reorder': ok({
          storeId: '11111111-1111-4111-8111-000000000001',
          unavailableItems: [],
          isComplete: true,
          cart: cartFixture(),
        }),
      },
    });

    await user.click(await screen.findByRole('button', { name: /order this again/i }));

    await waitFor(() => expect(calls.some((call) => call.url.includes('/reorder'))).toBe(true));
    // Straight to the cart, which is where the rebuilt basket is.
    expect(await screen.findByRole('heading', { level: 1, name: 'Your cart' })).toBeInTheDocument();
  });

  it('still goes to the cart when some items could not be added', async () => {
    const { user } = renderAt('/orders/order-1', {
      routes: {
        '/orders/order-1/reorder': ok({
          storeId: '11111111-1111-4111-8111-000000000001',
          unavailableItems: [{ name: 'Soan Papdi', reason: 'Out of stock' }],
          isComplete: false,
          cart: cartFixture(),
        }),
      },
    });

    await user.click(await screen.findByRole('button', { name: /order this again/i }));

    // The cart is where the customer deals with what is missing.
    expect(await screen.findByRole('heading', { level: 1, name: 'Your cart' })).toBeInTheDocument();
  });

  it('reports a refusal instead of navigating', async () => {
    const { user } = renderAt('/orders/order-1', {
      routes: {
        '/orders/order-1/reorder': fail(422, 'ITEM_UNAVAILABLE', 'Nothing from this order can be reordered.'),
      },
    });

    await user.click(await screen.findByRole('button', { name: /order this again/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/nothing from this order/i);
    expect(screen.queryByRole('heading', { name: 'Your cart' })).not.toBeInTheDocument();
  });
});

describe('the receipt', () => {
  it('shows the order, the shop and the itemised total', async () => {
    renderAt('/orders/order-1/receipt');

    expect(await screen.findByRole('heading', { level: 1, name: 'Receipt' })).toBeInTheDocument();
    expect(screen.getByText('CPSE-260920-ABC123')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Sharma Kirana Store' })).toBeInTheDocument();

    const table = within(screen.getByRole('table'));
    expect(table.getByText(/basmati rice/i)).toBeInTheDocument();
    expect(table.getByRole('rowheader', { name: 'Total' })).toBeInTheDocument();
  });

  it('lists every item, with its quantity and its line total', async () => {
    renderAt('/orders/order-1/receipt');

    const table = await screen.findByRole('table');
    const row = within(table).getByRole('row', { name: /basmati rice/i });
    expect(within(row).getByText('2 × ₹129.00')).toBeInTheDocument();
    expect(within(row).getByText('₹258.00')).toBeInTheDocument();
  });

  it('reads the items from `lines`, which is the name the API uses', async () => {
    // The screen once read `receipt.items`, a name only the fixture had, so the
    // table rendered empty for every real order while this suite stayed green.
    // Serving a payload with no `lines` must therefore show nothing at all —
    // that is what proves the screen is not reading some other key.
    renderAt('/orders/order-1/receipt', {
      routes: {
        '/orders/order-1/receipt': ok({
          receipt: { ...receiptFixture(), lines: undefined, items: [orderItemFixture()] },
        }),
      },
    });

    const table = await screen.findByRole('table');
    expect(within(table).queryByText(/basmati rice/i)).not.toBeInTheDocument();
  });

  it('shows how the order was paid', async () => {
    renderAt('/orders/order-1/receipt');

    expect(await screen.findByText('Paid online')).toBeInTheDocument();
    expect(screen.getByText('mock_e17644cc95e032c077098f76')).toBeInTheDocument();
  });

  it('is a real table, so it can be read and copied', async () => {
    renderAt('/orders/order-1/receipt');

    const table = await screen.findByRole('table');
    expect(within(table).getByRole('columnheader', { name: 'Item' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'Qty' })).toBeInTheDocument();
  });

  it('links back to the order', async () => {
    renderAt('/orders/order-1/receipt');

    expect(await screen.findByRole('link', { name: /back to the order/i })).toHaveAttribute(
      'href',
      '/orders/order-1',
    );
  });

  it('offers printing, which is how people keep these', async () => {
    renderAt('/orders/order-1/receipt');

    expect(await screen.findByRole('button', { name: /print or save/i })).toBeInTheDocument();
  });

  it('accounts for the money on a cancelled order that was paid online', async () => {
    renderAt('/orders/order-1/receipt', {
      routes: {
        '/orders/order-1/receipt': ok({
          receipt: receiptFixture({
            status: 'cancelled',
            payment: { method: 'online', status: 'paid', reference: 'mock_x', paidAt: '2026-09-21T13:04:48Z' },
          }),
        }),
      },
    });

    expect(await screen.findByText(/will be refunded to the account it was paid from/i)).toBeInTheDocument();
    expect(screen.getByText(/within 7 working days/i)).toBeInTheDocument();
  });

  it('404s politely', async () => {
    renderAt('/orders/order-1/receipt', {
      routes: { '/orders/order-1/receipt': fail(404, 'NOT_FOUND', 'Order was not found.') },
    });

    expect(await screen.findByRole('heading', { name: /that receipt is not here/i })).toBeInTheDocument();
  });
});

describe('orderStatus helpers', () => {
  it('groups statuses into tones', () => {
    expect(toneFor('placed')).toBe('active');
    expect(toneFor('ready_for_pickup')).toBe('ready');
    expect(toneFor('completed')).toBe('done');
    expect(toneFor('cancelled')).toBe('stopped');
    expect(toneFor('pending_payment')).toBe('waiting');
    // An unfamiliar status still renders, rather than breaking the pill.
    expect(toneFor('something_new')).toBe('active');
  });

  it('says what each state means for the customer', () => {
    expect(meaningFor('ready_for_pickup')).toMatch(/collect/i);
    expect(meaningFor('pending_payment')).toMatch(/waiting for your payment/i);
    expect(meaningFor('unknown_state')).toBeNull();
  });

  it('formats a timestamp, and copes with a missing one', () => {
    expect(formatWhen('2026-09-20T16:17:28.490933+00:00')).toMatch(/20 Sep/);
    expect(formatWhen(null)).toBeNull();
    expect(formatWhen('not a date')).toBeNull();
  });
});
