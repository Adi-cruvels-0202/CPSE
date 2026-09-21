import { describe, it, expect } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../src/context/AuthContext.jsx';
import { AppRoutes } from '../src/router.jsx';
import { writeSession } from '../src/lib/tokens.js';
import {
  customerFixture,
  fail,
  khataAccountFixture,
  khataStatementFixture,
  khataTxnFixture,
  mockRoutes,
  notificationFixture,
  ok,
  orderDetailFixture,
  savedStoreFixture,
  sessionFixture,
  storeFixture,
} from './helpers/api.js';

/** Checklist 11.13, 11.14 and 11.15. */

const ROUTER_FUTURE = { v7_startTransition: true, v7_relativeSplatPath: true };
const LIST_META = (total = 1) => ({ page: 1, limit: 20, total, totalPages: 1, hasNextPage: false });

function renderAt(path, routes = {}) {
  writeSession(sessionFixture());

  const mocked = mockRoutes({
    '/me': ok({ customer: customerFixture() }),
    '/notifications/unread-count': ok({ unreadCount: 0 }),
    '/saved-stores': ok({ savedStores: [savedStoreFixture()] }, LIST_META()),
    '/notifications': ok({ notifications: [notificationFixture()], unreadCount: 1 }, LIST_META()),
    '/khata': ok({ accounts: [khataAccountFixture()], totalOutstandingPaise: 2940 }),
    '/khata/khata-1/statement': ok(khataStatementFixture(), LIST_META(2)),
    '/orders/order-1': ok({ order: orderDetailFixture() }),
    // The badge tests render /orders, which fetches its own list.
    '/orders': ok({ orders: [] }, { page: 1, limit: 10, total: 0, totalPages: 0, hasNextPage: false }),
    '/stores/sharma-kirana': ok({ store: storeFixture() }),
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

describe('saved stores (11.13)', () => {
  it('needs a session', async () => {
    mockRoutes({ '/saved-stores': ok({ savedStores: [] }, LIST_META(0)) });

    render(
      <MemoryRouter initialEntries={['/saved']} future={ROUTER_FUTURE}>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('shows each shop with what decides the tap', async () => {
    renderAt('/saved');

    await screen.findByRole('heading', { level: 1, name: 'Saved stores' });
    expect(screen.getByText('Sharma Kirana Store')).toBeInTheDocument();
    // Open/closed, how it reaches you, and the minimum.
    expect(screen.getByText(/open now/i)).toBeInTheDocument();
    expect(screen.getByText(/pickup or delivery · ₹199 minimum/i)).toBeInTheDocument();
  });

  it('is one tap to the shop', async () => {
    renderAt('/saved');

    const link = await screen.findByRole('link', { name: /sharma kirana store/i });
    expect(link).toHaveAttribute('href', '/store/sharma-kirana');
  });

  it('says a closed shop is closed, and when it opens', async () => {
    renderAt('/saved', {
      '/saved-stores': ok(
        {
          savedStores: [
            savedStoreFixture({
              store: storeFixture({
                hours: { ...storeFixture().hours, isOpen: false, closesAt: null, opensAt: '08:00', opensOn: 'mon', localDay: 'sun' },
              }),
            }),
          ],
        },
        LIST_META(),
      ),
    });

    await screen.findByRole('heading', { level: 1, name: 'Saved stores' });
    expect(screen.getByText('Closed')).toBeInTheDocument();
    expect(screen.getByText(/opens monday at 8:00 am/i)).toBeInTheDocument();
  });

  it('points at the heart when there is nothing saved', async () => {
    renderAt('/saved', { '/saved-stores': ok({ savedStores: [] }, LIST_META(0)) });

    expect(await screen.findByRole('heading', { name: /no saved stores yet/i })).toBeInTheDocument();
    expect(screen.getByText(/tap the heart/i)).toBeInTheDocument();
  });

  it('offers a retry when the list will not load', async () => {
    const { user } = renderAt('/saved', {
      '/saved-stores': [
        fail(500, 'INTERNAL_ERROR', 'Something went wrong on our end.'),
        ok({ savedStores: [savedStoreFixture()] }, LIST_META()),
      ],
    });

    expect(
      await screen.findByRole('heading', { name: /could not load your saved stores/i }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /try again/i }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Saved stores' })).toBeInTheDocument();
  });
});

describe('notifications (11.14)', () => {
  it('lists them with their time, newest first as the server sends them', async () => {
    renderAt('/notifications');

    await screen.findByRole('heading', { level: 1, name: 'Notifications' });
    expect(screen.getByText(/accepted by the store/i)).toBeInTheDocument();
    expect(screen.getByText('The store has accepted your order.')).toBeInTheDocument();
    expect(screen.getByText(/20 Sep/)).toBeInTheDocument();
  });

  it('deep-links a row to its order through the payload id', async () => {
    renderAt('/notifications');

    const link = await screen.findByRole('link', { name: /accepted by the store/i });
    // The payload carries ids and nothing else, so this is the only routing there is.
    expect(link).toHaveAttribute('href', '/orders/order-1');
  });

  it('marks one read when it is opened', async () => {
    const { user, calls } = renderAt('/notifications', {
      '/notifications/notif-1/read': ok({ notification: notificationFixture({ isRead: true }) }),
    });

    await user.click(await screen.findByRole('link', { name: /accepted by the store/i }));

    await waitFor(() =>
      expect(calls.some((call) => call.url.includes('/notifications/notif-1/read'))).toBe(true),
    );
  });

  it('does not re-mark one that is already read', async () => {
    const { user, calls } = renderAt('/notifications', {
      '/notifications': ok({ notifications: [notificationFixture({ isRead: true, readAt: '2026-09-20T17:00:00Z' })], unreadCount: 0 }, LIST_META()),
    });

    await user.click(await screen.findByRole('link', { name: /accepted by the store/i }));

    expect(calls.some((call) => call.url.includes('/read'))).toBe(false);
  });

  it('marks unread visibly and for a screen reader, not by colour alone', async () => {
    renderAt('/notifications');

    const row = (await screen.findByRole('link', { name: /accepted by the store/i }));
    expect(row.className).toMatch(/notification--unread/);
    expect(within(row).getByText('(unread)')).toBeInTheDocument();
  });

  it('marks everything read', async () => {
    const { user, calls } = renderAt('/notifications', {
      '/notifications/read-all': ok({ updated: 1, unreadCount: 0 }),
    });

    await user.click(await screen.findByRole('button', { name: /mark all read/i }));

    await waitFor(() => expect(calls.some((call) => call.url.includes('/read-all'))).toBe(true));
  });

  it('offers no mark-all when there is nothing unread', async () => {
    renderAt('/notifications', {
      '/notifications': ok({ notifications: [notificationFixture({ isRead: true })], unreadCount: 0 }, LIST_META()),
    });

    await screen.findByRole('heading', { level: 1, name: 'Notifications' });
    expect(screen.queryByRole('button', { name: /mark all read/i })).not.toBeInTheDocument();
  });

  it('filters to unread, through the URL', async () => {
    const { user, calls } = renderAt('/notifications');

    await screen.findByRole('heading', { level: 1, name: 'Notifications' });
    await user.click(screen.getByRole('button', { name: /^unread/i }));

    await waitFor(() => {
      const last = calls.filter((call) => call.url.includes('/notifications?')).at(-1);
      expect(new URL(last.url).searchParams.get('unreadOnly')).toBe('true');
    });
  });

  it('shows the unread count on the filter', async () => {
    renderAt('/notifications');

    expect(await screen.findByRole('button', { name: 'Unread (1)' })).toBeInTheDocument();
  });

  it('says you are caught up when nothing is unread', async () => {
    renderAt('/notifications?unreadOnly=true', {
      '/notifications': ok({ notifications: [], unreadCount: 0 }, LIST_META(0)),
    });

    expect(await screen.findByRole('heading', { name: /nothing unread/i })).toBeInTheDocument();
  });

  it('explains itself when there are none at all', async () => {
    renderAt('/notifications', {
      '/notifications': ok({ notifications: [], unreadCount: 0 }, LIST_META(0)),
    });

    expect(await screen.findByRole('heading', { name: /no notifications yet/i })).toBeInTheDocument();
  });

  it('renders a khata notification as a link to that khata', async () => {
    renderAt('/notifications', {
      '/notifications': ok(
        {
          notifications: [
            notificationFixture({
              type: 'khata_updated',
              title: 'Your khata at Sharma Kirana Store was updated',
              body: null,
              payload: { khata_account_id: 'khata-1', store_id: 'store-1' },
            }),
          ],
          unreadCount: 1,
        },
        LIST_META(),
      ),
    });

    const link = await screen.findByRole('link', { name: /khata at sharma kirana/i });
    expect(link).toHaveAttribute('href', '/khata/khata-1');
  });
});

describe('the unread badge on the tab bar (11.14)', () => {
  it('shows the count the server reports', async () => {
    renderAt('/orders', { '/notifications/unread-count': ok({ unreadCount: 3 }) });

    const tab = await screen.findByRole('link', { name: /alerts/i });
    expect(tab).toHaveTextContent('3');
    // Announced as words, not as a bare digit.
    expect(tab).toHaveAccessibleName(/3 unread/i);
  });

  it('caps the badge so a big number cannot break the tab', async () => {
    renderAt('/orders', { '/notifications/unread-count': ok({ unreadCount: 47 }) });

    const tab = await screen.findByRole('link', { name: /alerts/i });
    expect(tab).toHaveTextContent('9+');
    // The real number is still available to a screen reader.
    expect(tab).toHaveAccessibleName(/47 unread/i);
  });

  it('shows nothing when there is nothing unread', async () => {
    renderAt('/orders', { '/notifications/unread-count': ok({ unreadCount: 0 }) });

    const tab = await screen.findByRole('link', { name: 'Alerts' });
    expect(tab).not.toHaveTextContent(/\d/);
  });

  it('does not let a failed count break the shell', async () => {
    renderAt('/orders', { '/notifications/unread-count': fail(500, 'INTERNAL_ERROR') });

    // A badge is not worth an error message.
    const tab = await screen.findByRole('link', { name: 'Alerts' });
    expect(tab).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('khata (11.15)', () => {
  it('leads with what is owed across all shops', async () => {
    renderAt('/khata');

    await screen.findByRole('heading', { level: 1, name: 'Khata' });
    // The headline and the shop's row show the same figure, so the assertion says
    // which one it means.
    const headline = within(screen.getByRole('region', { name: /total outstanding/i }));
    expect(headline.getByText('₹29.40')).toBeInTheDocument();
    expect(headline.getByText(/across 1 shop/i)).toBeInTheDocument();
  });

  it('lists each shop and links to its ledger', async () => {
    renderAt('/khata');

    const link = await screen.findByRole('link', { name: /sharma kirana store/i });
    expect(link).toHaveAttribute('href', '/khata/khata-1');
    expect(screen.getByText('You owe')).toBeInTheDocument();
  });

  it('says settled when nothing is owed', async () => {
    renderAt('/khata', {
      '/khata': ok({
        accounts: [khataAccountFixture({ balancePaise: 0, outstandingPaise: 0, isSettled: true })],
        totalOutstandingPaise: 0,
      }),
    });

    await screen.findByRole('heading', { level: 1, name: 'Khata' });
    expect(screen.getByText('Settled up')).toBeInTheDocument();
  });

  it('never shows a credit as something owed', async () => {
    renderAt('/khata', {
      '/khata': ok({
        accounts: [khataAccountFixture({ balancePaise: -5000, outstandingPaise: 0, creditPaise: 5000, isSettled: false })],
        totalOutstandingPaise: 0,
      }),
    });

    await screen.findByRole('heading', { level: 1, name: 'Khata' });
    expect(screen.getByText(/in your credit/i)).toBeInTheDocument();
  });

  it('explains that the shop keeps the book', async () => {
    renderAt('/khata');

    expect(await screen.findByText(/pay them directly/i)).toBeInTheDocument();
  });

  it('says so when there is no khata', async () => {
    renderAt('/khata', { '/khata': ok({ accounts: [], totalOutstandingPaise: 0 }) });

    expect(await screen.findByRole('heading', { name: /no khata yet/i })).toBeInTheDocument();
  });
});

describe('a khata account (11.15)', () => {
  it('shows the balance, the statement totals and the entries', async () => {
    renderAt('/khata/khata-1');

    await screen.findByRole('heading', { level: 1, name: 'Sharma Kirana Store' });
    const headline = within(screen.getByRole('region', { name: /what you owe now/i }));
    expect(headline.getByText('₹29.40')).toBeInTheDocument();
    expect(screen.getByText('Groceries on credit')).toBeInTheDocument();
    expect(screen.getByText('Part payment (UPI)')).toBeInTheDocument();
  });

  it('shows the opening and closing balances the server computed', async () => {
    renderAt('/khata/khata-1');

    await screen.findByRole('heading', { name: /whole history/i });
    const summary = within(screen.getByRole('region', { name: /whole history/i }));
    expect(summary.getByText('Opening balance')).toBeInTheDocument();
    expect(summary.getByText('Closing balance')).toBeInTheDocument();
  });

  it('signs each entry the way the server signed it', async () => {
    renderAt('/khata/khata-1');

    await screen.findByRole('heading', { level: 1, name: 'Sharma Kirana Store' });
    // Scoped to the ledger: "Paid back" in the totals shows −₹20.00 as well.
    const entries = within(screen.getByRole('region', { name: /2 entries/i }));
    expect(entries.getByText('+₹25.00')).toBeInTheDocument();
    expect(entries.getByText('−₹20.00')).toBeInTheDocument();
  });

  it('asks for a period when one is chosen', async () => {
    const { user, calls } = renderAt('/khata/khata-1');

    await screen.findByRole('heading', { level: 1, name: 'Sharma Kirana Store' });
    await user.click(screen.getByRole('button', { name: /last month/i }));

    await waitFor(() => {
      const last = calls.filter((call) => call.url.includes('/statement')).at(-1);
      expect(new URL(last.url).searchParams.get('from')).toBeTruthy();
    });
  });

  it('links an entry that came from an order', async () => {
    renderAt('/khata/khata-1', {
      '/khata/khata-1/statement': ok(
        khataStatementFixture({ transactions: [khataTxnFixture({ orderId: 'order-1' })] }),
        LIST_META(),
      ),
    });

    const link = await screen.findByRole('link', { name: 'Order' });
    expect(link).toHaveAttribute('href', '/orders/order-1');
  });

  it('says nothing is in an empty period', async () => {
    renderAt('/khata/khata-1', {
      '/khata/khata-1/statement': ok(
        khataStatementFixture({
          transactions: [],
          totals: { openingPaise: 2940, debitPaise: 0, creditPaise: 0, closingPaise: 2940, transactionCount: 0 },
        }),
        LIST_META(0),
      ),
    });

    expect(await screen.findByRole('heading', { name: /nothing in this period/i })).toBeInTheDocument();
  });

  it('404s politely for a khata that is not theirs', async () => {
    renderAt('/khata/khata-1', {
      '/khata/khata-1/statement': fail(404, 'NOT_FOUND', 'Khata account was not found.'),
    });

    expect(await screen.findByRole('heading', { name: /that khata is not here/i })).toBeInTheDocument();
  });

  it('offers no way to pay it off here', async () => {
    renderAt('/khata/khata-1');

    await screen.findByRole('heading', { level: 1, name: 'Sharma Kirana Store' });
    // Read-only by construction: the backend mounts GET verbs only.
    for (const label of [/pay/i, /settle/i, /add entry/i]) {
      expect(screen.queryByRole('button', { name: label })).not.toBeInTheDocument();
    }
  });
});
