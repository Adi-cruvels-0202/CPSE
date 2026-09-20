import { describe, it, expect } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../src/context/AuthContext.jsx';
import { AppRoutes } from '../src/router.jsx';
import { writeSession } from '../src/lib/tokens.js';
import {
  cartFixture,
  cartLineFixture,
  categoriesFixture,
  customerFixture,
  emptyCartFixture,
  fail,
  mockRoutes,
  noContent,
  ok,
  productListFixture,
  sessionFixture,
  storeFixture,
} from './helpers/api.js';

/** Checklist 11.7 — the cart, its live totals, and surfacing what the server says. */

const ROUTER_FUTURE = { v7_startTransition: true, v7_relativeSplatPath: true };
const STORE_ID = '11111111-1111-4111-8111-000000000001';

function renderCart({ cart = cartFixture(), routes = {} } = {}) {
  writeSession(sessionFixture());
  const list = productListFixture();

  const mocked = mockRoutes({
    '/me': ok({ customer: customerFixture() }),
    '/categories': ok(categoriesFixture()),
    '/products': ok(list.data, list.meta),
    '/stores/sharma-kirana': ok({ store: storeFixture() }),
    '/cart/validate': ok({ cart }),
    '/cart/items/': ok({ cart }),
    '/cart': ok({ cart }),
    ...routes,
  });

  return {
    user: userEvent.setup(),
    ...mocked,
    ...render(
      <MemoryRouter initialEntries={[`/cart/${STORE_ID}`]} future={ROUTER_FUTURE}>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </MemoryRouter>,
    ),
  };
}

const stepperFor = (name) =>
  within(screen.getByRole('group', { name: new RegExp(`quantity of ${name}`, 'i') }));

/**
 * The summary block, as its own region.
 *
 * With one line in the cart the line total, the subtotal and the grand total are
 * all the same number, so an unscoped getByText finds three matches and throws.
 * Scoping says which one the assertion is actually about.
 */
const summary = () => within(screen.getByRole('region', { name: 'Summary' }));

/**
 * One row of the summary, by its label — because with a single line the subtotal
 * and the total are the same number, so even inside the region a text match is
 * ambiguous.
 */
const summaryRow = (label) => {
  const term = summary().getByText(new RegExp(`^${label}`, 'i'));
  return term.parentElement.querySelector('dd').textContent;
};

/** A line's own total, from the line rather than the summary. */
const lineTotalOf = (name) => {
  const heading = screen.getByText(name);
  const line = heading.closest('li');
  return line.querySelector('.cart-line__total').textContent;
};

describe('it needs a session', () => {
  it('sends a stranger to sign in', async () => {
    mockRoutes({ '/cart': ok({ cart: cartFixture() }) });

    render(
      <MemoryRouter initialEntries={[`/cart/${STORE_ID}`]} future={ROUTER_FUTURE}>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });
});

describe('the lines', () => {
  it('shows each line with its unit price and line total', async () => {
    renderCart();

    expect(await screen.findByRole('heading', { level: 1, name: 'Your cart' })).toBeInTheDocument();
    expect(screen.getByText('Sharma Kirana Store')).toBeInTheDocument();
    expect(screen.getByText(/basmati rice/i)).toBeInTheDocument();
    expect(screen.getByText('₹129')).toBeInTheDocument();
    expect(lineTotalOf('Basmati Rice')).toBe('₹258.00');
    expect(summaryRow('Subtotal')).toBe('₹258.00');
    expect(summaryRow('Total')).toBe('₹258.00');
  });

  it('names the variant on a line that has one', async () => {
    renderCart({
      cart: cartFixture({
        lines: [
          cartLineFixture(),
          cartLineFixture({
            id: 'line-2',
            variantId: 'v2',
            variantName: '5 kg',
            unitPricePaise: 59900,
            quantity: 1,
            lineTotalPaise: 59900,
            mrpPaise: null,
          }),
        ],
      }),
    });

    await screen.findByRole('heading', { level: 1, name: 'Your cart' });
    expect(screen.getByText('5 kg')).toBeInTheDocument();
    expect(screen.getByText('₹599.00')).toBeInTheDocument();
  });

  it('links a line back to its product', async () => {
    renderCart();

    const link = await screen.findByRole('link', { name: 'Basmati Rice' });
    expect(link).toHaveAttribute(
      'href',
      '/store/sharma-kirana/product/31111111-1111-4111-8111-000000000001',
    );
  });

  it('shows the struck-through MRP where there is a saving', async () => {
    renderCart();

    await screen.findByRole('heading', { level: 1, name: 'Your cart' });
    expect(screen.getByText('₹150').tagName).toBe('S');
  });

  it('shows the totals the server sent, and does not add anything up', async () => {
    // Deliberately inconsistent: 2 × ₹129 is not ₹999. The screen must show the
    // server's number, because the server is what the customer will be charged.
    renderCart({
      cart: cartFixture({
        lines: [cartLineFixture()],
        totals: {
          subtotalPaise: 99900,
          discountPaise: 5000,
          deliveryFeePaise: 2900,
          taxPaise: 0,
          totalPaise: 97800,
          itemCount: 1,
          totalQuantity: 2,
        },
      }),
    });

    await screen.findByRole('heading', { name: 'Summary' });
    expect(summaryRow('Subtotal')).toBe('₹999.00');
    expect(summaryRow('Discount')).toBe('−₹50.00');
    expect(summaryRow('Delivery')).toBe('₹29.00');
    expect(summaryRow('Total')).toBe('₹978.00');
    // The line total is still the server's ₹258.00 — the screen adds nothing up.
    expect(lineTotalOf('Basmati Rice')).toBe('₹258.00');
  });

  it('hides the tax row, because catalogue prices are tax-inclusive', async () => {
    renderCart();

    await screen.findByRole('heading', { name: 'Summary' });
    // A meaningless ₹0.00 tax line invites the question "why zero?".
    expect(screen.queryByText(/^tax$/i)).not.toBeInTheDocument();
  });

  it('says delivery is worked out at checkout when there is no fee yet', async () => {
    renderCart();

    expect(await screen.findByText(/delivery is worked out at checkout/i)).toBeInTheDocument();
  });
});

describe('changing quantities', () => {
  it('patches the line and adopts the cart that comes back', async () => {
    const updated = cartFixture({
      lines: [cartLineFixture({ quantity: 3, lineTotalPaise: 38700 })],
    });
    const { user, calls } = renderCart({ routes: { '/cart/items/': ok({ cart: updated }) } });

    await screen.findByRole('heading', { level: 1, name: 'Your cart' });
    await user.click(stepperFor('Basmati Rice').getByRole('button', { name: 'One more' }));

    await waitFor(() => expect(lineTotalOf('Basmati Rice')).toBe('₹387.00'));

    const patch = calls.find((call) => call.method === 'PATCH');
    expect(patch.body).toEqual({ quantity: 3 });
    expect(patch.url).toContain('/cart/items/line-1');
  });

  it('caps the stepper at the stock the shop has', async () => {
    const atCap = cartFixture({
      lines: [cartLineFixture({ quantity: 3, stock: 3, lineTotalPaise: 38700 })],
    });
    const { user } = renderCart({
      cart: cartFixture({ lines: [cartLineFixture({ quantity: 2, stock: 3 })] }),
      routes: { '/cart/items/': ok({ cart: atCap }) },
    });

    await screen.findByRole('heading', { level: 1, name: 'Your cart' });

    // Re-queried after the click: the cart re-renders from the server's response,
    // so a button captured beforehand is a stale node.
    await user.click(stepperFor('Basmati Rice').getByRole('button', { name: 'One more' }));

    await waitFor(() =>
      expect(stepperFor('Basmati Rice').getByRole('button', { name: 'One more' })).toBeDisabled(),
    );
  });

  it('allows up to 999 when the shop does not track stock', async () => {
    renderCart({ cart: cartFixture({ lines: [cartLineFixture({ stock: null })] }) });

    await screen.findByRole('heading', { level: 1, name: 'Your cart' });
    // null is untracked, not zero.
    expect(stepperFor('Basmati Rice').getByRole('button', { name: 'One more' })).toBeEnabled();
  });

  it('cannot be driven below one — removal is its own action', async () => {
    renderCart({ cart: cartFixture({ lines: [cartLineFixture({ quantity: 1 })] }) });

    await screen.findByRole('heading', { level: 1, name: 'Your cart' });
    expect(stepperFor('Basmati Rice').getByRole('button', { name: 'One fewer' })).toBeDisabled();
  });

  it('refetches when a change is refused, so the screen is not left wrong', async () => {
    const { user, calls } = renderCart({
      routes: {
        '/cart/items/': fail(422, 'ITEM_UNAVAILABLE', 'Basmati Rice just sold out.'),
      },
    });

    await screen.findByRole('heading', { level: 1, name: 'Your cart' });
    await user.click(stepperFor('Basmati Rice').getByRole('button', { name: 'One more' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/just sold out/i);
    // The cart may now differ in ways we cannot infer, so ask.
    await waitFor(() => {
      const gets = calls.filter((call) => call.method === 'GET' && call.url.includes('/cart?'));
      expect(gets.length).toBeGreaterThan(1);
    });
  });
});

describe('removing things', () => {
  it('deletes a line', async () => {
    const { user, calls } = renderCart({
      routes: { '/cart/items/': noContent(), '/cart': [ok({ cart: cartFixture() }), ok({ cart: emptyCartFixture() })] },
    });

    await screen.findByRole('heading', { level: 1, name: 'Your cart' });
    await user.click(screen.getByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(calls.some((call) => call.method === 'DELETE')).toBe(true));
    expect(await screen.findByRole('heading', { name: /your cart is empty/i })).toBeInTheDocument();
  });

  it('empties the whole cart', async () => {
    const { user, calls } = renderCart({
      routes: { '/cart': [ok({ cart: cartFixture() }), ok({ cart: emptyCartFixture() })] },
    });

    await screen.findByRole('heading', { level: 1, name: 'Your cart' });
    await user.click(screen.getByRole('button', { name: /empty cart/i }));

    await waitFor(() =>
      expect(calls.some((call) => call.method === 'DELETE' && call.url.includes('/cart?'))).toBe(
        true,
      ),
    );
  });
});

describe('an empty cart', () => {
  it('says so and offers the way back to the shop', async () => {
    renderCart({ cart: emptyCartFixture() });

    expect(await screen.findByRole('heading', { name: /your cart is empty/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /back to sharma kirana store/i })).toHaveAttribute(
      'href',
      '/store/sharma-kirana',
    );
    expect(screen.queryByRole('button', { name: 'Checkout' })).not.toBeInTheDocument();
  });
});

describe('surfacing what the server says is wrong', () => {
  it('shows a per-line price change with both numbers', async () => {
    renderCart({
      cart: cartFixture({
        lines: [
          cartLineFixture({
            issues: [
              {
                code: 'PRICE_CHANGED',
                message: 'The price of Basmati Rice has changed.',
                previousUnitPricePaise: 9900,
                unitPricePaise: 12900,
              },
            ],
          }),
        ],
      }),
    });

    // Which way it moved and by how much matters more than the sentence.
    expect(await screen.findByText(/price changed from ₹99 to ₹129/i)).toBeInTheDocument();
  });

  it('marks an unavailable line and blocks its stepper', async () => {
    renderCart({
      cart: cartFixture({
        lines: [
          cartLineFixture({
            isPurchasable: false,
            issues: [{ code: 'ITEM_UNAVAILABLE', message: 'Basmati Rice is unavailable.' }],
          }),
        ],
        isCheckoutReady: false,
      }),
    });

    expect(await screen.findByText(/basmati rice is unavailable/i)).toBeInTheDocument();
    expect(stepperFor('Basmati Rice').getByRole('button', { name: 'One more' })).toBeDisabled();
  });

  it('shows a cart-level issue, such as the minimum not being met', async () => {
    renderCart({
      cart: cartFixture({
        issues: [
          {
            code: 'MINIMUM_ORDER_NOT_MET',
            message: 'Orders from Sharma Kirana Store start at ₹199.00.',
          },
        ],
        isCheckoutReady: false,
      }),
    });

    expect(await screen.findByText(/start at ₹199\.00/i)).toBeInTheDocument();
  });

  it('disables checkout and says why when the cart is not ready', async () => {
    renderCart({ cart: cartFixture({ isCheckoutReady: false }) });

    await screen.findByRole('heading', { level: 1, name: 'Your cart' });
    expect(screen.getByRole('button', { name: 'Checkout' })).toBeDisabled();
    expect(screen.getByText(/sort the items above out first/i)).toBeInTheDocument();
  });

  it('falls back to the server’s own wording for a code it does not know', async () => {
    renderCart({
      cart: cartFixture({
        issues: [{ code: 'SOME_FUTURE_CODE', message: 'Something new the client has not met.' }],
      }),
    });

    // A new code degrades to generic, never to silence.
    expect(await screen.findByText(/something new the client has not met/i)).toBeInTheDocument();
  });
});

describe('the shop’s minimum order', () => {
  it('says how much more is needed', async () => {
    // The cart's own isCheckoutReady does not cover the minimum — that rule lives
    // in the checkout quote — so without this the button walks into a wall.
    renderCart({
      cart: cartFixture({
        lines: [cartLineFixture({ quantity: 1, lineTotalPaise: 12900 })],
      }),
    });

    // The sentence is split across a <strong>, so the assertion is on the whole
    // notice rather than a text node.
    // Thrown inside waitFor, so it actually retries — a `.find` returning
    // undefined is not an error, and waitFor would resolve on the first attempt.
    const notice = await waitFor(() => {
      const found = screen
        .getAllByRole('status')
        .find((element) => /more to reach/i.test(element.textContent));
      if (!found) throw new Error('no shortfall notice yet');
      return found;
    });

    expect(notice.textContent).toMatch(/Add ₹70\.00 more to reach this shop.s ₹199\.00 minimum/i);
  });

  it('says nothing once the minimum is met', async () => {
    renderCart({
      cart: cartFixture({
        lines: [cartLineFixture({ quantity: 2, lineTotalPaise: 25800 })],
      }),
    });

    await screen.findByRole('heading', { level: 1, name: 'Your cart' });
    expect(
      screen.queryAllByRole('status').some((el) => /more to reach/i.test(el.textContent)),
    ).toBe(false);
  });

  it('says nothing when the shop has no minimum', async () => {
    renderCart({
      cart: cartFixture({ lines: [cartLineFixture({ quantity: 1, lineTotalPaise: 12900 })] }),
      routes: {
        '/stores/sharma-kirana': ok({
          store: storeFixture({
            fulfilment: { ...storeFixture().fulfilment, minOrderPaise: 0 },
          }),
        }),
      },
    });

    await screen.findByRole('heading', { level: 1, name: 'Your cart' });
    expect(
      screen.queryAllByRole('status').some((el) => /more to reach/i.test(el.textContent)),
    ).toBe(false);
  });

  it('still shows the cart if the shop cannot be loaded', async () => {
    renderCart({
      routes: { '/stores/sharma-kirana': fail(500, 'INTERNAL_ERROR') },
    });

    // Losing a hint must not cost the customer their cart.
    expect(await screen.findByRole('heading', { level: 1, name: 'Your cart' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Checkout' })).toBeEnabled();
  });
});

describe('going to checkout', () => {
  it('validates the displayed prices first, then navigates', async () => {
    const { user, calls } = renderCart();

    await screen.findByRole('heading', { level: 1, name: 'Your cart' });
    await user.click(screen.getByRole('button', { name: 'Checkout' }));

    const validate = await waitFor(() => {
      const found = calls.find((call) => call.url.includes('/cart/validate'));
      expect(found).toBeDefined();
      return found;
    });

    // Exactly what the screen was showing, so the server can say whether it holds.
    expect(validate.body).toEqual({
      storeId: STORE_ID,
      items: [{ itemId: 'line-1', unitPricePaise: 12900 }],
    });

    expect(await screen.findByRole('heading', { name: 'Checkout' })).toBeInTheDocument();
  });

  it('stays put and shows the drift when a price moved', async () => {
    const drifted = cartFixture({
      lines: [
        cartLineFixture({
          unitPricePaise: 13900,
          issues: [
            {
              code: 'PRICE_CHANGED',
              message: 'The price of Basmati Rice has changed.',
              previousUnitPricePaise: 12900,
              unitPricePaise: 13900,
            },
          ],
        }),
      ],
    });
    const { user } = renderCart({ routes: { '/cart/validate': ok({ cart: drifted }) } });

    await screen.findByRole('heading', { level: 1, name: 'Your cart' });
    await user.click(screen.getByRole('button', { name: 'Checkout' }));

    // Nobody is carried to checkout on a number they have not seen.
    expect(await screen.findByText(/something changed since you last looked/i)).toBeInTheDocument();
    expect(screen.getByText(/price changed from ₹129 to ₹139/i)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Checkout' })).not.toBeInTheDocument();
  });

  it('lets a second tap through once the customer has seen it', async () => {
    const drifted = cartFixture({
      lines: [
        cartLineFixture({
          unitPricePaise: 13900,
          issues: [{ code: 'PRICE_CHANGED', message: 'Price changed.', previousUnitPricePaise: 12900, unitPricePaise: 13900 }],
        }),
      ],
    });
    const { user } = renderCart({
      routes: { '/cart/validate': [ok({ cart: drifted }), ok({ cart: cartFixture() })] },
    });

    await screen.findByRole('heading', { level: 1, name: 'Your cart' });
    await user.click(screen.getByRole('button', { name: 'Checkout' }));
    await screen.findByText(/something changed since you last looked/i);

    await user.click(screen.getByRole('button', { name: 'Checkout' }));

    expect(await screen.findByRole('heading', { name: 'Checkout' })).toBeInTheDocument();
  });

  it('does not navigate when validate refuses', async () => {
    const { user } = renderCart({
      routes: { '/cart/validate': fail(422, 'CART_EMPTY', 'There is nothing in your cart.') },
    });

    await screen.findByRole('heading', { level: 1, name: 'Your cart' });
    await user.click(screen.getByRole('button', { name: 'Checkout' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/nothing in your cart/i);
    expect(screen.queryByRole('heading', { name: 'Checkout' })).not.toBeInTheDocument();
  });

  it('disables the button while it is checking, so one tap is one check', async () => {
    let release;
    const pending = new Promise((settle) => {
      release = settle;
    });
    const { user } = renderCart({ routes: { '/cart/validate': () => pending } });

    await screen.findByRole('heading', { level: 1, name: 'Your cart' });
    await user.click(screen.getByRole('button', { name: 'Checkout' }));

    await waitFor(() => expect(screen.getByRole('button', { name: /checking/i })).toBeDisabled());
    release(ok({ cart: cartFixture() }));
  });
});

describe('when the cart will not load', () => {
  it('offers a retry', async () => {
    const { user } = renderCart({
      routes: {
        '/cart': [fail(500, 'INTERNAL_ERROR', 'Something went wrong on our end.'), ok({ cart: cartFixture() })],
      },
    });

    expect(await screen.findByRole('heading', { name: /could not load your cart/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /try again/i }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Your cart' })).toBeInTheDocument();
  });

  it('shows a skeleton first', async () => {
    renderCart({ routes: { '/cart': () => new Promise(() => {}) } });

    expect(await screen.findByText(/loading your cart/i)).toBeInTheDocument();
  });
});
