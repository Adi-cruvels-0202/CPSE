import { describe, it, expect } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../src/context/AuthContext.jsx';
import { AppRoutes } from '../src/router.jsx';
import { writeSession } from '../src/lib/tokens.js';
import {
  categoriesFixture,
  created,
  customerFixture,
  fail,
  mockRoutes,
  ok,
  productDetailFixture,
  productFixture,
  sessionFixture,
  storeFixture,
  variantFixture,
} from './helpers/api.js';

/** Checklist 11.5 — the product page. */

const ROUTER_FUTURE = { v7_startTransition: true, v7_relativeSplatPath: true };
const PRODUCT_ID = '31111111-1111-4111-8111-000000000001';

function renderProduct({ product, signedIn = false, routes = {} } = {}) {
  if (signedIn) writeSession(sessionFixture());

  const detail = product
    ? { storeId: storeFixture().id, product }
    : productDetailFixture();

  const mocked = mockRoutes({
    '/me': ok({ customer: customerFixture() }),
    '/categories': ok(categoriesFixture()),
    [`/products/${PRODUCT_ID}`]: ok(detail),
    '/stores/sharma-kirana': ok({ store: storeFixture() }),
    ...routes,
  });

  return {
    user: userEvent.setup(),
    ...mocked,
    ...render(
      <MemoryRouter
        initialEntries={[`/store/sharma-kirana/product/${PRODUCT_ID}`]}
        future={ROUTER_FUTURE}
      >
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </MemoryRouter>,
    ),
  };
}

const base = () => productDetailFixture().product;

describe('it opens with no account', () => {
  it('shows the product to a visitor with no session', async () => {
    renderProduct();

    expect(await screen.findByRole('heading', { level: 1, name: 'Basmati Rice' })).toBeInTheDocument();
    expect(screen.getByText('₹129.00')).toBeInTheDocument();
    expect(screen.getByText(/aged long-grain basmati/i)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Sign in' })).not.toBeInTheDocument();
  });

  it('links back to the shop', async () => {
    renderProduct();

    expect(await screen.findByRole('link', { name: /back to the shop/i })).toHaveAttribute(
      'href',
      '/store/sharma-kirana',
    );
  });

  it('shows the saving against the MRP', async () => {
    renderProduct();

    await screen.findByRole('heading', { level: 1, name: 'Basmati Rice' });
    expect(screen.getByText('₹150.00').tagName).toBe('S');
    expect(screen.getByText('14% off')).toBeInTheDocument();
  });

  it('shows a skeleton first', async () => {
    renderProduct({ routes: { [`/products/${PRODUCT_ID}`]: () => new Promise(() => {}) } });

    expect(await screen.findByText(/loading the product/i)).toBeInTheDocument();
  });

  it('says the product is not here for a 404, with no retry', async () => {
    renderProduct({
      routes: { [`/products/${PRODUCT_ID}`]: fail(404, 'NOT_FOUND', 'Product was not found.') },
    });

    expect(await screen.findByRole('heading', { name: /that product is not here/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument();
  });
});

describe('the gallery', () => {
  it('offers a thumbnail per picture and swaps the main image', async () => {
    const { user } = renderProduct({
      product: {
        ...base(),
        imageUrl: 'https://cdn.example.com/one.jpg',
        images: [
          { id: 'i1', url: 'https://cdn.example.com/one.jpg', altText: 'Front', sortOrder: 1 },
          { id: 'i2', url: 'https://cdn.example.com/two.jpg', altText: 'Grains', sortOrder: 2 },
        ],
      },
    });

    await screen.findByRole('heading', { level: 1, name: 'Basmati Rice' });
    expect(screen.getByAltText('Front')).toBeInTheDocument();

    const thumbs = within(screen.getByRole('group', { name: /more pictures/i }));
    await user.click(thumbs.getByRole('button', { name: 'Grains' }));

    expect(screen.getByAltText('Grains')).toBeInTheDocument();
  });

  it('shows no thumbnail row for a single picture', async () => {
    renderProduct({
      product: {
        ...base(),
        imageUrl: 'https://cdn.example.com/one.jpg',
        images: [{ id: 'i1', url: 'https://cdn.example.com/one.jpg', altText: 'Front', sortOrder: 1 }],
      },
    });

    await screen.findByRole('heading', { level: 1, name: 'Basmati Rice' });
    expect(screen.queryByRole('group', { name: /more pictures/i })).not.toBeInTheDocument();
  });

  it('falls back to initials when there are no pictures at all', async () => {
    renderProduct({ product: { ...base(), imageUrl: null, images: [] } });

    await screen.findByRole('heading', { level: 1, name: 'Basmati Rice' });
    expect(screen.getByRole('img', { name: 'Basmati Rice' })).toHaveTextContent('BR');
  });
});

describe('variants', () => {
  const withVariants = (variants) => ({ ...base(), variants });

  it('lists each option with its own absolute price', async () => {
    renderProduct({
      product: withVariants([
        variantFixture({ name: '1 kg', pricePaise: 12900 }),
        variantFixture({ id: 'v2', name: '5 kg', pricePaise: 59900 }),
      ]),
    });

    await screen.findByRole('heading', { level: 1, name: 'Basmati Rice' });
    // Absolute, not a delta off the parent price (backend D15).
    expect(screen.getByRole('radio', { name: /1 kg/ })).toBeInTheDocument();
    expect(screen.getByText('₹599')).toBeInTheDocument();
  });

  it('will not add to cart until an option is chosen', async () => {
    renderProduct({
      signedIn: true,
      product: withVariants([variantFixture(), variantFixture({ id: 'v2', name: '5 kg' })]),
    });

    expect(await screen.findByText(/choose an option to continue/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add to cart/i })).toBeDisabled();
  });

  it('replaces the price with the chosen variant’s', async () => {
    const { user } = renderProduct({
      product: withVariants([
        variantFixture({ name: '1 kg', pricePaise: 12900 }),
        variantFixture({ id: 'v2', name: '5 kg', pricePaise: 59900 }),
      ]),
    });

    await screen.findByRole('heading', { level: 1, name: 'Basmati Rice' });
    await user.click(screen.getByRole('radio', { name: /5 kg/ }));

    expect(screen.getByText('₹599.00')).toBeInTheDocument();
  });

  it('bounds the quantity by the variant’s own stock, not the product’s', async () => {
    const { user } = renderProduct({
      signedIn: true,
      product: {
        ...base(),
        stock: 40,
        variants: [variantFixture({ id: 'v2', name: '5 kg', stock: 2 })],
      },
    });

    await screen.findByRole('heading', { level: 1, name: 'Basmati Rice' });
    await user.click(screen.getByRole('radio', { name: /5 kg/ }));

    // A product can have 40 in total and 2 of the big bag.
    expect(screen.getByText('Only 2 left')).toBeInTheDocument();

    const stepper = within(screen.getByRole('group', { name: 'Quantity' }));
    await user.click(stepper.getByRole('button', { name: 'One more' }));
    expect(stepper.getByRole('button', { name: 'One more' })).toBeDisabled();
  });

  it('disables a sold-out option', async () => {
    renderProduct({
      product: withVariants([
        variantFixture(),
        variantFixture({ id: 'v2', name: '5 kg', isPurchasable: false, stock: 0 }),
      ]),
    });

    await screen.findByRole('heading', { level: 1, name: 'Basmati Rice' });
    expect(screen.getByRole('radio', { name: /5 kg/ })).toBeDisabled();
    expect(screen.getByText('Sold out')).toBeInTheDocument();
  });

  it('resets the quantity when the option changes', async () => {
    const { user } = renderProduct({
      signedIn: true,
      product: withVariants([
        variantFixture({ name: '1 kg' }),
        variantFixture({ id: 'v2', name: '5 kg' }),
      ]),
    });

    await screen.findByRole('heading', { level: 1, name: 'Basmati Rice' });
    await user.click(screen.getByRole('radio', { name: /1 kg/ }));

    const stepper = () => within(screen.getByRole('group', { name: 'Quantity' }));
    await user.click(stepper().getByRole('button', { name: 'One more' }));
    expect(screen.getByText('2')).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: /5 kg/ }));

    // 3 of a 1 kg bag does not mean 3 of the 5 kg one.
    expect(stepper().getByText('1')).toBeInTheDocument();
  });
});

describe('availability', () => {
  it('says sold out and refuses to add', async () => {
    renderProduct({
      signedIn: true,
      product: { ...base(), isAvailable: false, stock: 0, outOfStock: true, isPurchasable: false },
    });

    expect(await screen.findByText(/sold out/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add to cart/i })).toBeDisabled();
    // No point offering a quantity for something that cannot be bought.
    expect(screen.queryByRole('group', { name: 'Quantity' })).not.toBeInTheDocument();
  });

  it('warns on low stock', async () => {
    renderProduct({ product: { ...base(), stock: 3 } });

    expect(await screen.findByText('Only 3 left')).toBeInTheDocument();
  });

  it('says nothing about untracked stock', async () => {
    renderProduct({ signedIn: true, product: { ...base(), stock: null } });

    await screen.findByRole('heading', { level: 1, name: 'Basmati Rice' });
    expect(screen.queryByText(/left|sold out/i)).not.toBeInTheDocument();
    // Still buyable — null is untracked, not zero.
    expect(screen.getByRole('button', { name: /add to cart/i })).toBeEnabled();
  });
});

describe('the quantity stepper', () => {
  it('starts at one and will not go below it', async () => {
    const { user } = renderProduct({ signedIn: true });

    await screen.findByRole('heading', { level: 1, name: 'Basmati Rice' });
    const stepper = within(screen.getByRole('group', { name: 'Quantity' }));

    expect(stepper.getByText('1')).toBeInTheDocument();
    expect(stepper.getByRole('button', { name: 'One fewer' })).toBeDisabled();

    await user.click(stepper.getByRole('button', { name: 'One more' }));
    expect(stepper.getByText('2')).toBeInTheDocument();
    expect(stepper.getByRole('button', { name: 'One fewer' })).toBeEnabled();
  });

  it('shows the running total once more than one is chosen', async () => {
    const { user } = renderProduct({ signedIn: true });

    await screen.findByRole('heading', { level: 1, name: 'Basmati Rice' });
    const stepper = within(screen.getByRole('group', { name: 'Quantity' }));
    await user.click(stepper.getByRole('button', { name: 'One more' }));

    expect(screen.getByText(/2 × ₹129/)).toBeInTheDocument();
    expect(screen.getByText('₹258.00')).toBeInTheDocument();
  });

  it('stops at the stock the shop has', async () => {
    const { user } = renderProduct({ signedIn: true, product: { ...base(), stock: 2 } });

    await screen.findByRole('heading', { level: 1, name: 'Basmati Rice' });
    const stepper = within(screen.getByRole('group', { name: 'Quantity' }));

    await user.click(stepper.getByRole('button', { name: 'One more' }));
    // Disabled rather than letting the order fail at checkout.
    expect(stepper.getByRole('button', { name: 'One more' })).toBeDisabled();
  });
});

describe('adding to the cart', () => {
  it('sends an anonymous visitor to sign in, remembering the product', async () => {
    const { user } = renderProduct();

    await user.click(await screen.findByRole('button', { name: /sign in to add to cart/i }));

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('adds the line and offers the way to the cart', async () => {
    const { user, calls } = renderProduct({
      signedIn: true,
      routes: { '/cart/items': created({ cart: { lines: [], totals: {} } }) },
    });

    await user.click(await screen.findByRole('button', { name: /^add to cart$/i }));

    expect(await screen.findByText(/added to your cart/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /go to cart/i })).toBeInTheDocument();

    const call = calls.find((entry) => entry.url.includes('/cart/items'));
    expect(call.method).toBe('POST');
    expect(call.body).toEqual({
      storeId: storeFixture().id,
      productId: PRODUCT_ID,
      quantity: 1,
    });
  });

  it('sends the variant when one is chosen, and the quantity', async () => {
    const { user, calls } = renderProduct({
      signedIn: true,
      product: { ...base(), variants: [variantFixture({ id: 'v-5kg', name: '5 kg' })] },
      routes: { '/cart/items': created({ cart: {} }) },
    });

    await screen.findByRole('heading', { level: 1, name: 'Basmati Rice' });
    await user.click(screen.getByRole('radio', { name: /5 kg/ }));

    const stepper = within(screen.getByRole('group', { name: 'Quantity' }));
    await user.click(stepper.getByRole('button', { name: 'One more' }));
    await user.click(screen.getByRole('button', { name: /^add to cart$/i }));

    await waitFor(() => expect(screen.getByText(/added to your cart/i)).toBeInTheDocument());
    const call = calls.find((entry) => entry.url.includes('/cart/items'));
    expect(call.body).toEqual({
      storeId: storeFixture().id,
      productId: PRODUCT_ID,
      variantId: 'v-5kg',
      quantity: 2,
    });
  });

  it('omits variantId rather than sending null', async () => {
    const { user, calls } = renderProduct({
      signedIn: true,
      routes: { '/cart/items': created({ cart: {} }) },
    });

    await user.click(await screen.findByRole('button', { name: /^add to cart$/i }));
    await waitFor(() => expect(screen.getByText(/added to your cart/i)).toBeInTheDocument());

    // The backend treats null as equivalent to omitting it, so this is tidiness
    // rather than a requirement — but a payload that carries only what it means
    // is the one worth sending.
    const call = calls.find((entry) => entry.url.includes('/cart/items'));
    expect('variantId' in call.body).toBe(false);
  });

  it('reports a refusal from the server, and does not claim success', async () => {
    const { user } = renderProduct({
      signedIn: true,
      routes: {
        '/cart/items': fail(422, 'ITEM_UNAVAILABLE', 'Basmati Rice just sold out.'),
      },
    });

    await user.click(await screen.findByRole('button', { name: /^add to cart$/i }));

    // Not optimistic: a cart is money, so the customer hears about it now.
    expect(await screen.findByRole('alert')).toHaveTextContent(/just sold out/i);
    expect(screen.queryByText(/added to your cart/i)).not.toBeInTheDocument();
  });

  it('disables the button while the request is in flight', async () => {
    let release;
    const pending = new Promise((settle) => {
      release = settle;
    });
    const { user } = renderProduct({ signedIn: true, routes: { '/cart/items': () => pending } });

    await user.click(await screen.findByRole('button', { name: /^add to cart$/i }));

    // A double tap must not put the line in twice.
    await waitFor(() => expect(screen.getByRole('button', { name: /adding/i })).toBeDisabled());
    release(created({ cart: {} }));
  });

  it('lets the customer add another after a success', async () => {
    const { user } = renderProduct({
      signedIn: true,
      routes: { '/cart/items': created({ cart: {} }) },
    });

    await user.click(await screen.findByRole('button', { name: /^add to cart$/i }));
    await screen.findByText(/added to your cart/i);

    await user.click(screen.getByRole('button', { name: /add another/i }));

    expect(screen.getByRole('button', { name: /^add to cart$/i })).toBeInTheDocument();
  });
});
