import { describe, it, expect } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../src/context/AuthContext.jsx';
import { AppRoutes } from '../src/router.jsx';
import { writeSession } from '../src/lib/tokens.js';
import {
  categoriesFixture,
  customerFixture,
  fail,
  mockRoutes,
  ok,
  productFixture,
  productListFixture,
  sessionFixture,
  soldOutProductFixture,
  storeFixture,
} from './helpers/api.js';

/** Checklist 11.5 — category browsing and the product grid, on the store page. */

const ROUTER_FUTURE = { v7_startTransition: true, v7_relativeSplatPath: true };

function renderStore({
  path = '/store/sharma-kirana',
  products,
  meta,
  categories = categoriesFixture(),
  signedIn = false,
  routes = {},
} = {}) {
  if (signedIn) writeSession(sessionFixture());
  const list = productListFixture(products, meta);

  const mocked = mockRoutes({
    '/me': ok({ customer: customerFixture() }),
    '/categories': ok(categories),
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

const grid = () => screen.getByRole('list', { name: '' }) ?? null;

describe('the product grid', () => {
  it('lists the products with their prices', async () => {
    renderStore({
      products: [
        productFixture(),
        productFixture({ id: 'p2', name: 'Toor Dal', pricePaise: 18500, mrpPaise: 18500 }),
      ],
    });

    expect(await screen.findByRole('heading', { name: 'Basmati Rice' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Toor Dal' })).toBeInTheDocument();
    expect(screen.getByText('₹129')).toBeInTheDocument();
    expect(screen.getByText('₹185')).toBeInTheDocument();
  });

  it('shows the struck-through MRP and the saving', async () => {
    renderStore({ products: [productFixture({ pricePaise: 12900, mrpPaise: 15000 })] });

    await screen.findByRole('heading', { name: 'Basmati Rice' });
    expect(screen.getByText('₹150').tagName).toBe('S');
    expect(screen.getByText('14% off')).toBeInTheDocument();
    // The two numbers would otherwise be read as one run of digits.
    expect(screen.getByText(/reduced from/i)).toBeInTheDocument();
  });

  it('shows no saving badge when the price equals the MRP', async () => {
    renderStore({ products: [productFixture({ pricePaise: 12900, mrpPaise: 12900 })] });

    await screen.findByRole('heading', { name: 'Basmati Rice' });
    expect(screen.queryByText(/% off/)).not.toBeInTheDocument();
  });

  it('shows a sold-out product rather than hiding it', async () => {
    renderStore({ products: [productFixture(), soldOutProductFixture()] });

    // The spec wants them visible: a shopper who cannot see the item assumes the
    // shop does not sell it.
    expect(await screen.findByRole('heading', { name: 'Soan Papdi' })).toBeInTheDocument();
    expect(screen.getByText('Sold out')).toBeInTheDocument();
  });

  it('warns when stock is nearly gone, and says nothing when it is plentiful', async () => {
    renderStore({
      products: [
        productFixture({ id: 'low', name: 'Almost Gone', stock: 2 }),
        productFixture({ id: 'last', name: 'Final One', stock: 1 }),
        productFixture({ id: 'plenty', name: 'Plenty Left', stock: 40 }),
      ],
    });

    await screen.findByRole('heading', { name: 'Almost Gone' });
    expect(screen.getByText('Only 2 left')).toBeInTheDocument();
    expect(screen.getByText('Last one')).toBeInTheDocument();
    // "40 left" is noise; only a number worth acting on is shown.
    expect(screen.queryByText(/40 left/)).not.toBeInTheDocument();
  });

  it('says nothing about stock the shop does not track', async () => {
    renderStore({ products: [productFixture({ stock: null })] });

    await screen.findByRole('heading', { name: 'Basmati Rice' });
    // null means untracked, which must never read as "none left".
    expect(screen.queryByText(/left|sold out/i)).not.toBeInTheDocument();
  });

  it('links each product to its own page', async () => {
    renderStore({ products: [productFixture({ id: 'abc123' })] });

    const link = await screen.findByRole('link', { name: /basmati rice/i });
    expect(link).toHaveAttribute('href', '/store/sharma-kirana/product/abc123');
  });

  it('shows a skeleton while the products load', async () => {
    renderStore({ routes: { '/products': () => new Promise(() => {}) } });

    expect(await screen.findByText(/loading the products/i)).toBeInTheDocument();
  });

  it('says so when the shop has listed nothing', async () => {
    renderStore({ products: [], meta: { page: 1, limit: 12, total: 0, totalPages: 0, hasNextPage: false } });

    expect(
      await screen.findByRole('heading', { name: /has not listed anything yet/i }),
    ).toBeInTheDocument();
  });

  it('offers a retry when the products fail to load, and keeps the store page', async () => {
    const { user } = renderStore({
      routes: {
        '/products': [fail(500, 'INTERNAL_ERROR', 'Something went wrong on our end.'), ok(productListFixture().data, productListFixture().meta)],
      },
    });

    expect(await screen.findByRole('heading', { name: /could not load the products/i })).toBeInTheDocument();
    // The shop itself is still there — one failed section does not take the page.
    expect(screen.getByRole('heading', { level: 1, name: 'Sharma Kirana Store' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /try again/i }));

    expect(await screen.findByRole('heading', { name: 'Basmati Rice' })).toBeInTheDocument();
  });
});

describe('the category filter', () => {
  it('offers All plus every category', async () => {
    renderStore();

    const filter = await screen.findByRole('group', { name: /filter by category/i });
    const chips = within(filter).getAllByRole('button');
    expect(chips.map((chip) => chip.textContent)).toEqual(['All', 'Staples', 'Snacks & Namkeen']);
    // All is the starting state.
    expect(chips[0]).toHaveAttribute('aria-pressed', 'true');
  });

  it('filters the grid and puts the category in the URL', async () => {
    const { user, calls } = renderStore();

    const filter = await screen.findByRole('group', { name: /filter by category/i });
    await user.click(within(filter).getByRole('button', { name: 'Staples' }));

    await waitFor(() => {
      const productCalls = calls.filter((call) => call.url.includes('/products?'));
      const last = productCalls.at(-1);
      expect(new URL(last.url).searchParams.get('categoryId')).toBe(
        '21111111-1111-4111-8111-000000000001',
      );
    });

    // Named in the heading, so it is obvious the grid is filtered.
    expect(await screen.findByRole('heading', { name: 'Staples' })).toBeInTheDocument();
  });

  it('returns to everything when All is tapped', async () => {
    const { user, calls } = renderStore();

    const filter = await screen.findByRole('group', { name: /filter by category/i });
    await user.click(within(filter).getByRole('button', { name: 'Staples' }));
    await screen.findByRole('heading', { name: 'Staples' });

    await user.click(within(filter).getByRole('button', { name: 'All' }));

    await waitFor(() => {
      const last = calls.filter((call) => call.url.includes('/products?')).at(-1);
      expect(new URL(last.url).searchParams.has('categoryId')).toBe(false);
    });
    expect(await screen.findByRole('heading', { name: /everything in the shop/i })).toBeInTheDocument();
  });

  it('reads the category from the URL on arrival, so a filtered link can be shared', async () => {
    const { calls } = renderStore({
      path: '/store/sharma-kirana?category=21111111-1111-4111-8111-000000000002',
    });

    await waitFor(() => {
      const call = calls.find((entry) => entry.url.includes('/products?'));
      expect(new URL(call.url).searchParams.get('categoryId')).toBe(
        '21111111-1111-4111-8111-000000000002',
      );
    });
    expect(await screen.findByRole('heading', { name: 'Snacks & Namkeen' })).toBeInTheDocument();
  });

  it('offers a way out of an empty category', async () => {
    const { user, calls } = renderStore({
      path: '/store/sharma-kirana?category=21111111-1111-4111-8111-000000000001',
      products: [],
      meta: { page: 1, limit: 12, total: 0, totalPages: 0, hasNextPage: false },
    });

    expect(await screen.findByRole('heading', { name: /nothing in this category yet/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /show everything/i }));

    await waitFor(() => {
      const last = calls.filter((entry) => entry.url.includes('/products?')).at(-1);
      expect(new URL(last.url).searchParams.has('categoryId')).toBe(false);
    });
  });

  it('hides the filter when there is only one category to choose', async () => {
    renderStore({
      categories: categoriesFixture([
        { id: 'only', storeId: 's', name: 'Everything', slug: 'all', sortOrder: 1 },
      ]),
    });

    await screen.findByRole('heading', { name: 'Basmati Rice' });
    // A single chip is not a choice; it just takes a row.
    expect(screen.queryByRole('group', { name: /filter by category/i })).not.toBeInTheDocument();
  });

  it('still shows the grid when the categories fail to load', async () => {
    renderStore({ routes: { '/categories': fail(500, 'INTERNAL_ERROR') } });

    // Losing the filter must not cost the customer the products.
    expect(await screen.findByRole('heading', { name: 'Basmati Rice' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: /filter by category/i })).not.toBeInTheDocument();
  });
});

describe('paging through a long catalogue', () => {
  const manyMeta = { page: 1, limit: 12, total: 30, totalPages: 3, hasNextPage: true };

  it('offers Show more when there is more, and says how far along we are', async () => {
    renderStore({ products: [productFixture()], meta: manyMeta });

    expect(await screen.findByRole('button', { name: /show more/i })).toBeInTheDocument();
    expect(screen.getByText('Showing 1 of 30')).toBeInTheDocument();
  });

  it('asks for the next page and puts it in the URL', async () => {
    const { user, calls } = renderStore({ products: [productFixture()], meta: manyMeta });

    await user.click(await screen.findByRole('button', { name: /show more/i }));

    await waitFor(() => {
      const last = calls.filter((entry) => entry.url.includes('/products?')).at(-1);
      expect(new URL(last.url).searchParams.get('page')).toBe('2');
    });
  });

  it('offers nothing more on the last page', async () => {
    renderStore({
      products: [productFixture()],
      meta: { page: 3, limit: 12, total: 30, totalPages: 3, hasNextPage: false },
    });

    await screen.findByRole('heading', { name: 'Basmati Rice' });
    expect(screen.queryByRole('button', { name: /show more/i })).not.toBeInTheDocument();
  });

  it('keeps the products on screen if the next page fails', async () => {
    const list = productListFixture([productFixture()], manyMeta);
    const { user } = renderStore({
      routes: {
        '/products': [
          ok(list.data, list.meta),
          fail(500, 'INTERNAL_ERROR', 'Something went wrong on our end.'),
        ],
      },
    });

    await user.click(await screen.findByRole('button', { name: /show more/i }));

    // The error is reported without throwing the grid away.
    expect(await screen.findByRole('alert')).toHaveTextContent(/went wrong/i);
    expect(screen.getByRole('heading', { name: 'Basmati Rice' })).toBeInTheDocument();
  });
});
