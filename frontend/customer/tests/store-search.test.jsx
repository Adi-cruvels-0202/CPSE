import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../src/context/AuthContext.jsx';
import { AppRoutes } from '../src/router.jsx';
import {
  categoriesFixture,
  customerFixture,
  fail,
  mockRoutes,
  ok,
  productFixture,
  productListFixture,
  storeFixture,
} from './helpers/api.js';

/** Checklist 11.6 — store-scoped search. */

const ROUTER_FUTURE = { v7_startTransition: true, v7_relativeSplatPath: true };

function renderSearch({ path = '/store/sharma-kirana/search', results, meta, routes = {} } = {}) {
  const list = productListFixture(results, meta);

  const mocked = mockRoutes({
    '/me': ok({ customer: customerFixture() }),
    '/categories': ok(categoriesFixture()),
    '/search': ok({ ...list.data, query: 'ri' }, list.meta),
    '/products': ok(list.data, list.meta),
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

const input = () => screen.getByLabelText(/search this shop/i);

/**
 * Waits past the 300ms debounce in real time.
 *
 * Fake timers deadlock userEvent — it waits on its own timers to type — and a
 * test that fails before restoring them leaves every later test hanging. A real
 * wait of 400ms per search test is a few seconds across the file, which is worth
 * paying for tests that cannot cascade.
 */
const settle = () => new Promise((resolve) => setTimeout(resolve, 400));
const searchCalls = (calls) => calls.filter((call) => call.url.includes('/search'));

describe('before there is a query', () => {
  it('invites the customer to type, and asks the server nothing', async () => {
    const { calls } = renderSearch();

    expect(await screen.findByText(/type to search/i)).toBeInTheDocument();
    expect(searchCalls(calls)).toHaveLength(0);
  });

  it('opens with no session', async () => {
    renderSearch();

    expect(await screen.findByLabelText(/search this shop/i)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Sign in' })).not.toBeInTheDocument();
  });

  it('links back to the shop', async () => {
    renderSearch();

    expect(await screen.findByRole('link', { name: /back to the shop/i })).toHaveAttribute(
      'href',
      '/store/sharma-kirana',
    );
  });
});

describe('the two-character floor', () => {
  it('does not search on one character, and says why', async () => {
    const { user, calls } = renderSearch();

    await user.type(input(), 'r');
    await settle();

    // The server answers 422 below two characters; the screen simply does not ask.
    expect(searchCalls(calls)).toHaveLength(0);
    expect(screen.getByText(/2 characters minimum/i)).toBeInTheDocument();
  });

  it('searches once it has two', async () => {
    const { user, calls } = renderSearch({ results: [productFixture()] });

    await user.type(input(), 'ri');
    await settle();

    await waitFor(() => expect(searchCalls(calls)).toHaveLength(1));
    expect(new URL(searchCalls(calls)[0].url).searchParams.get('q')).toBe('ri');
  });
});

describe('debouncing', () => {
  it('sends one request for a word, not one per keystroke', async () => {
    const { user, calls } = renderSearch({ results: [productFixture()] });

    await user.type(input(), 'basmati');
    await settle();

    // Seven keystrokes; six of those requests would already be stale on arrival.
    await waitFor(() => expect(searchCalls(calls)).toHaveLength(1));
    expect(new URL(searchCalls(calls)[0].url).searchParams.get('q')).toBe('basmati');
  });

  it('sends nothing while the customer is still typing', async () => {
    const { user, calls } = renderSearch({ results: [productFixture()] });

    await user.type(input(), 'bas');
    // Asserted immediately: the debounce has not fired yet.

    expect(searchCalls(calls)).toHaveLength(0);
  });
});

describe('results', () => {
  it('shows the matches as product cards', async () => {
    const { user } = renderSearch({
      results: [productFixture({ name: 'Basmati Rice' })],
      meta: { page: 1, limit: 20, total: 1, totalPages: 1, hasNextPage: false },
    });

    await user.type(input(), 'rice');
    await settle();

    expect(await screen.findByRole('heading', { name: 'Basmati Rice' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /basmati rice/i })).toHaveAttribute(
      'href',
      '/store/sharma-kirana/product/31111111-1111-4111-8111-000000000001',
    );
  });

  it('counts the matches, and says it out loud', async () => {
    const { user } = renderSearch({
      results: [productFixture(), productFixture({ id: 'p2', name: 'Toor Dal' })],
      meta: { page: 1, limit: 20, total: 2, totalPages: 1, hasNextPage: false },
    });

    await user.type(input(), 'da');
    await settle();

    const count = await screen.findByRole('status');
    expect(count).toHaveTextContent('2 matches for “da”');
  });

  it('uses the singular for one match', async () => {
    const { user } = renderSearch({
      results: [productFixture()],
      meta: { page: 1, limit: 20, total: 1, totalPages: 1, hasNextPage: false },
    });

    await user.type(input(), 'dal');
    await settle();

    expect(await screen.findByText(/^1 match for/)).toBeInTheDocument();
  });

  it('shows a skeleton while searching', async () => {
    const { user } = renderSearch({ routes: { '/search': () => new Promise(() => {}) } });

    await user.type(input(), 'rice');
    await settle();

    expect(await screen.findByText(/searching for rice/i)).toBeInTheDocument();
  });

  it('shows a sold-out match, like the grid does', async () => {
    const { user } = renderSearch({
      results: [productFixture({ name: 'Soan Papdi', isPurchasable: false, stock: 0 })],
      meta: { page: 1, limit: 20, total: 1, totalPages: 1, hasNextPage: false },
    });

    await user.type(input(), 'soan');
    await settle();

    expect(await screen.findByRole('heading', { name: 'Soan Papdi' })).toBeInTheDocument();
    expect(screen.getByText('Sold out')).toBeInTheDocument();
  });
});

describe('nothing found', () => {
  it('says so, quotes the query, and offers the way out', async () => {
    const { user } = renderSearch({
      results: [],
      meta: { page: 1, limit: 20, total: 0, totalPages: 0, hasNextPage: false },
    });

    await user.type(input(), 'zzzz');
    await settle();

    expect(await screen.findByRole('heading', { name: /nothing here matches/i })).toBeInTheDocument();
    expect(screen.getByText(/“zzzz”/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /browse the whole shop/i })).toHaveAttribute(
      'href',
      '/store/sharma-kirana',
    );
  });
});

describe('the query in the URL', () => {
  it('searches immediately for a shared link', async () => {
    const { calls } = renderSearch({
      path: '/store/sharma-kirana/search?q=rice',
      results: [productFixture()],
    });

    await waitFor(() => expect(searchCalls(calls)).toHaveLength(1));
    expect(new URL(searchCalls(calls)[0].url).searchParams.get('q')).toBe('rice');
    // And the box shows what is being searched for.
    expect(input()).toHaveValue('rice');
  });

  it('clears the box and the results', async () => {
    const { user } = renderSearch({
      path: '/store/sharma-kirana/search?q=rice',
      results: [productFixture()],
    });

    await settle();
    await screen.findByRole('heading', { name: 'Basmati Rice' });

    await user.click(screen.getByRole('button', { name: /clear the search/i }));

    expect(input()).toHaveValue('');
    expect(await screen.findByText(/type to search/i)).toBeInTheDocument();
  });

  it('offers no clear button when the box is empty', async () => {
    renderSearch();

    await screen.findByLabelText(/search this shop/i);
    expect(screen.queryByRole('button', { name: /clear the search/i })).not.toBeInTheDocument();
  });
});

describe('when the search fails', () => {
  it('offers a retry', async () => {
    const { user } = renderSearch({
      routes: {
        '/search': [
          fail(500, 'INTERNAL_ERROR', 'Something went wrong on our end.'),
          ok({ ...productListFixture().data, query: 'rice' }, productListFixture().meta),
        ],
      },
    });

    await user.type(input(), 'rice');
    await settle();

    expect(await screen.findByRole('heading', { name: /could not search/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /try again/i }));

    expect(await screen.findByRole('heading', { name: 'Basmati Rice' })).toBeInTheDocument();
  });

  it('calls a lost connection what it is', async () => {
    const { user } = renderSearch({
      routes: {
        '/search': () => {
          throw new TypeError('Failed to fetch');
        },
      },
    });

    await user.type(input(), 'rice');
    await settle();

    expect(await screen.findByRole('heading', { name: 'No connection' })).toBeInTheDocument();
  });
});
