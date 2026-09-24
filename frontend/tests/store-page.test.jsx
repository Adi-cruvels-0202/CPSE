import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../src/context/AuthContext.jsx';
import { AppRoutes } from '../src/router.jsx';
import { writeSession } from '../src/lib/tokens.js';
import { initialsOf } from '../src/components/RemoteImage.jsx';
import { describeStatus, formatTime, weekSchedule } from '../src/lib/storeHours.js';
import {
  closedStoreFixture,
  customerFixture,
  fail,
  mockRoutes,
  noContent,
  ok,
  sessionFixture,
  storeFixture,
} from './helpers/api.js';

/**
 * Checklist 11.4 — the public storefront.
 *
 * The claim that matters: this page opens for someone with no account, because
 * that is how a shared link and a QR code are used. Everything here is driven
 * from a genuinely empty session unless a test says otherwise.
 */

const ROUTER_FUTURE = { v7_startTransition: true, v7_relativeSplatPath: true };

function renderStore({ store = storeFixture(), signedIn = false, routes = {} } = {}) {
  if (signedIn) writeSession(sessionFixture());

  // Spelled out rather than '/stores/', which — being the longer pattern —
  // would also match '/stores/<id>/save' and answer the save with a store.
  const mocked = mockRoutes({
    '/me': ok({ customer: customerFixture() }),
    '/stores/sharma-kirana': ok({ store }),
    ...routes,
  });

  return {
    user: userEvent.setup(),
    ...mocked,
    ...render(
      <MemoryRouter initialEntries={['/store/sharma-kirana']} future={ROUTER_FUTURE}>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </MemoryRouter>,
    ),
  };
}

describe('it opens with no account at all', () => {
  it('shows the shop without asking anyone to sign in', async () => {
    renderStore();

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Sharma Kirana Store' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Sign in' })).not.toBeInTheDocument();
    expect(
      screen.getByText(/neighbourhood grocery/i),
    ).toBeInTheDocument();
  });

  it('sends no Authorization header when there is no session', async () => {
    const { calls } = renderStore();

    await screen.findByRole('heading', { level: 1, name: 'Sharma Kirana Store' });
    const storeCall = calls.find((call) => call.url.includes('/stores/'));
    expect(storeCall.headers.authorization).toBeUndefined();
  });

  it('shows a skeleton first, not an empty page', async () => {
    renderStore({ routes: { '/stores/sharma-kirana': () => new Promise(() => {}) } });

    expect(await screen.findByRole('status')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText(/loading the shop/i)).toBeInTheDocument();
  });
});

describe('open and closed', () => {
  it('says it is open, and when it shuts', async () => {
    renderStore();

    expect(await screen.findByText('Open now')).toBeInTheDocument();
    expect(screen.getByText(/closes at 9:00 pm/i)).toBeInTheDocument();
  });

  it('says it is closed, and when it opens again', async () => {
    renderStore({ store: closedStoreFixture() });

    expect(await screen.findByText('Closed')).toBeInTheDocument();
    // "Closed" alone is a dead end; the next question is always when.
    expect(screen.getAllByText(/opens monday at 8:00 am/i).length).toBeGreaterThan(0);
  });

  it('tells a customer an order will still be seen when the shop is shut', async () => {
    renderStore({ store: closedStoreFixture() });

    // The backend places an order against a closed store deliberately (D29), so
    // the page must not imply ordering is impossible.
    const notice = await screen.findByText(/closed right now/i);
    expect(notice).toHaveTextContent(/still order/i);
  });

  it('shows no closed notice when the shop is open', async () => {
    renderStore();

    await screen.findByText('Open now');
    expect(screen.queryByText(/closed right now/i)).not.toBeInTheDocument();
  });

  it('shows today’s hours on a chip, and the week when it is tapped', async () => {
    const { user } = renderStore();

    // In the header, above the catalogue — not a card at the foot of the page.
    const chip = await screen.findByRole('button', { name: /opening hours\. today/i });
    expect(chip.closest('header')).not.toBeNull();
    expect(chip).toHaveTextContent('8:00 am – 9:00 pm');

    // The rest of the week is not in the header until it is asked for.
    expect(screen.queryByText('Saturday')).not.toBeInTheDocument();

    await user.click(chip);

    const sheet = within(await screen.findByRole('dialog', { name: 'Opening hours' }));
    expect(sheet.getByText('Saturday')).toBeInTheDocument();
    expect(sheet.getByText(/8:00 am – 10:00 pm/)).toBeInTheDocument();
    // The whole week at once: no second toggle inside a sheet the customer
    // already chose to open.
    expect(sheet.getAllByRole('definition')).toHaveLength(7);
  });

  it('names the timezone, because the times are the shop’s not the visitor’s', async () => {
    const { user } = renderStore();

    await user.click(await screen.findByRole('button', { name: /opening hours\. today/i }));

    expect(await screen.findByText(/Asia\/Kolkata/)).toBeInTheDocument();
  });

  it('closes the hours sheet on Escape and restores focus to the chip', async () => {
    const { user } = renderStore();

    const chip = await screen.findByRole('button', { name: /opening hours\. today/i });
    await user.click(chip);
    await screen.findByRole('dialog', { name: 'Opening hours' });

    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(chip).toHaveFocus();
  });
});

describe('what the shop will do', () => {
  // Every ordering chip opens the same sheet — that is deliberate, the way an
  // info chip row works — so any of them will do.
  const openOrdering = async (user) => {
    const chips = await screen.findAllByRole('button', { name: /^ordering\./i });
    await user.click(chips[0]);
    return within(await screen.findByRole('dialog', { name: 'Ordering' }));
  };

  it('puts the facts that change a decision on the chips themselves', async () => {
    renderStore();

    // Without tapping anything: what they do, the floor, and the fee. These
    // used to be a card below the entire catalogue.
    const strip = within(await screen.findByRole('group', { name: 'About this shop' }));
    expect(strip.getByText('Pickup or Delivery')).toBeInTheDocument();
    expect(strip.getByText('₹199 minimum')).toBeInTheDocument();
    expect(strip.getByText('₹29 delivery')).toBeInTheDocument();
  });

  it('opens the detail in a sheet', async () => {
    const { user } = renderStore();
    const sheet = await openOrdering(user);

    expect(sheet.getByText('Pickup or Delivery')).toBeInTheDocument();
    expect(sheet.getByText('₹199')).toBeInTheDocument();
    expect(sheet.getByText('₹29')).toBeInTheDocument();
  });

  it('says Free rather than ₹0 when delivery costs nothing', async () => {
    const { user } = renderStore({
      store: storeFixture({
        fulfilment: { ...storeFixture().fulfilment, deliveryFeePaise: 0 },
      }),
    });

    expect(await screen.findByText('Free delivery')).toBeInTheDocument();

    const sheet = await openOrdering(user);
    expect(sheet.getByText('Free')).toBeInTheDocument();
  });

  it('hides the minimum when there is not one', async () => {
    const { user } = renderStore({
      store: storeFixture({ fulfilment: { ...storeFixture().fulfilment, minOrderPaise: 0 } }),
    });

    const sheet = await openOrdering(user);
    expect(sheet.queryByText(/minimum order/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/minimum/i)).not.toBeInTheDocument();
  });

  it('shows only pickup when delivery is off, and drops the fee row', async () => {
    const { user } = renderStore({
      store: storeFixture({
        fulfilment: { ...storeFixture().fulfilment, deliveryEnabled: false },
      }),
    });

    // No delivery fee chip either — the strip is not a place for facts that
    // do not apply.
    expect(await screen.findByText('Pickup')).toBeInTheDocument();
    expect(screen.queryByText(/delivery/i)).not.toBeInTheDocument();

    const sheet = await openOrdering(user);
    expect(sheet.getByText('Pickup')).toBeInTheDocument();
    expect(sheet.queryByText(/delivery fee/i)).not.toBeInTheDocument();
  });

  it('says so plainly when the shop takes no orders at all', async () => {
    renderStore({
      store: storeFixture({
        fulfilment: {
          pickupEnabled: false,
          deliveryEnabled: false,
          minOrderPaise: 0,
          deliveryFeePaise: 0,
        },
      }),
    });

    expect(await screen.findByText('Not taking orders')).toBeInTheDocument();
  });
});

describe('finding the shop', () => {
  /** The address row lives in the header now; the detail is behind it. */
  async function openLocationSheet(user) {
    await user.click(await screen.findByRole('button', { name: /14 Model Town Road/ }));
    return within(await screen.findByRole('dialog', { name: 'Where to find them' }));
  }

  it('puts the address in the header, above the catalogue', async () => {
    renderStore();

    const row = await screen.findByRole('button', { name: /14 Model Town Road/ });
    // Inside the store's own header — not a card at the foot of the page, which
    // is where it used to be.
    expect(row.closest('header')).not.toBeNull();
    // Street and locality are enough to answer "is this near me"; the rest is
    // one tap away rather than a paragraph in the header.
    expect(row).toHaveTextContent('Ludhiana');
    expect(row).toHaveAttribute('aria-haspopup', 'dialog');
  });

  it('opens a sheet with the full address, a map and a phone call', async () => {
    const { user } = renderStore();
    const sheet = await openLocationSheet(user);

    expect(sheet.getByText(/14 Model Town Road.*141002/)).toBeInTheDocument();

    const map = sheet.getByRole('link', { name: /open in maps/i });
    expect(map).toHaveAttribute('href', expect.stringContaining('30.900965,75.857276'));
    // A new tab, and not one that can reach back into this page.
    expect(map).toHaveAttribute('rel', expect.stringContaining('noopener'));

    expect(sheet.getByRole('link', { name: /call the shop/i })).toHaveAttribute(
      'href',
      'tel:+919812345601',
    );
  });

  it('closes on Escape and gives focus back to the row', async () => {
    const { user } = renderStore();
    await openLocationSheet(user);

    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    // Not the top of the document: back where the finger — or the caret — was.
    expect(screen.getByRole('button', { name: /14 Model Town Road/ })).toHaveFocus();
  });

  it('copies the address for pasting into a message', async () => {
    const { user } = renderStore();
    const sheet = await openLocationSheet(user);

    await user.click(sheet.getByRole('button', { name: /copy address/i }));

    expect(await navigator.clipboard.readText()).toMatch(/14 Model Town Road/);
    expect(await sheet.findByRole('button', { name: /copied/i })).toBeInTheDocument();
  });

  it('falls back to searching the address when there are no coordinates', async () => {
    const { user } = renderStore({
      store: storeFixture({
        location: { ...storeFixture().location, latitude: null, longitude: null },
      }),
    });

    const sheet = await openLocationSheet(user);
    expect(sheet.getByRole('link', { name: /open in maps/i })).toHaveAttribute(
      'href',
      expect.stringContaining('Model%20Town'),
    );
  });

  it('offers no phone link when the shop has no number', async () => {
    const { user } = renderStore({ store: storeFixture({ contact: { phone: null, email: null } }) });

    const sheet = await openLocationSheet(user);
    expect(sheet.queryByRole('link', { name: /call the shop/i })).not.toBeInTheDocument();
  });

  it('links into search for this store', async () => {
    renderStore();

    expect(await screen.findByRole('link', { name: /search this store/i })).toHaveAttribute(
      'href',
      '/store/sharma-kirana/search',
    );
  });
});

describe('saving the store', () => {
  it('sends an anonymous visitor to sign in, remembering the shop', async () => {
    const { user } = renderStore();

    await screen.findByRole('heading', { level: 1, name: 'Sharma Kirana Store' });
    await user.click(screen.getByRole('button', { name: /sign in first/i }));

    // Not a 401 they did not ask for: the login screen, with the way back.
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('does not claim a state it cannot know when nobody is signed in', async () => {
    renderStore();

    const button = await screen.findByRole('button', { name: /sign in first/i });
    // isSaved is null for an anonymous visitor, so aria-pressed must be absent
    // rather than "false", which would assert "not saved".
    expect(button).not.toHaveAttribute('aria-pressed');
  });

  it('saves for a signed-in customer, and fills the heart immediately', async () => {
    const { user, calls } = renderStore({
      signedIn: true,
      store: storeFixture({ isSaved: false }),
      routes: { '/save': ok({ store: storeFixture({ isSaved: true }) }) },
    });

    const button = await screen.findByRole('button', { name: /^save this store$/i });
    expect(button).toHaveAttribute('aria-pressed', 'false');

    await user.click(button);

    // Optimistic: the heart fills before the round trip finishes.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /tap to remove/i })).toHaveAttribute(
        'aria-pressed',
        'true',
      ),
    );
    await waitFor(() => expect(calls.some((call) => call.url.includes('/save'))).toBe(true));
    expect(calls.find((call) => call.url.includes('/save')).method).toBe('POST');
  });

  it('unsaves an already-saved store', async () => {
    const { user, calls } = renderStore({
      signedIn: true,
      store: storeFixture({ isSaved: true }),
      routes: { '/save': noContent() },
    });

    await user.click(await screen.findByRole('button', { name: /tap to remove/i }));

    await waitFor(() => expect(calls.some((call) => call.method === 'DELETE')).toBe(true));
  });

  it('puts the heart back when the save fails', async () => {
    const { user } = renderStore({
      signedIn: true,
      store: storeFixture({ isSaved: false }),
      routes: { '/save': fail(500, 'INTERNAL_ERROR') },
    });

    await user.click(await screen.findByRole('button', { name: /^save this store$/i }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^save this store$/i })).toHaveAttribute(
        'aria-pressed',
        'false',
      ),
    );
  });

  it('personalises when signed in, sending the token', async () => {
    const { calls } = renderStore({ signedIn: true, store: storeFixture({ isSaved: true }) });

    await screen.findByRole('button', { name: /tap to remove/i });
    const storeCall = calls.find((call) => call.url.includes('/stores/sharma-kirana'));
    expect(storeCall.headers.authorization).toBe('Bearer access-1');
  });
});

describe('when it cannot be loaded', () => {
  it('says the shop is not here for a 404, with no retry', async () => {
    renderStore({
      routes: { '/stores/sharma-kirana': fail(404, 'NOT_FOUND', 'Store was not found.') },
    });

    expect(await screen.findByRole('heading', { name: 'That shop is not here' })).toBeInTheDocument();
    // Retrying a 404 will not help.
    expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument();
  });

  it('offers a retry for a server error, and retries on demand', async () => {
    const { user } = renderStore({
      routes: {
        '/stores/sharma-kirana': [
          fail(500, 'INTERNAL_ERROR', 'Something went wrong on our end.'),
          ok({ store: storeFixture() }),
        ],
      },
    });

    await user.click(await screen.findByRole('button', { name: /try again/i }));

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Sharma Kirana Store' }),
    ).toBeInTheDocument();
  });

  it('calls a lost connection what it is', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }));

    render(
      <MemoryRouter initialEntries={['/store/sharma-kirana']} future={ROUTER_FUTURE}>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'No connection' })).toBeInTheDocument();
    expect(screen.getByText(/check your internet connection/i)).toBeInTheDocument();
  });

  it('shows a failure rather than crashing when the payload has no store', async () => {
    renderStore({ routes: { '/stores/sharma-kirana': ok({ notAStore: true }) } });

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be loaded/i);
  });
});

describe('images that do not load', () => {
  it('never requests a .local image, because that host cannot resolve', async () => {
    renderStore();

    await screen.findByRole('heading', { level: 1, name: 'Sharma Kirana Store' });

    // The seeded catalogue points at images.cpse.local. No <img> is rendered at
    // all, so the browser never fires a request that can only fail.
    expect(screen.queryByAltText('Sharma Kirana Store logo')).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Sharma Kirana Store logo' })).toHaveTextContent('SK');
  });

  it('still falls back when a reachable image fails to load', async () => {
    renderStore({
      store: storeFixture({ logoUrl: 'https://cdn.example.com/logo.png' }),
    });

    const logo = await screen.findByAltText('Sharma Kirana Store logo');
    expect(logo.tagName).toBe('IMG');

    const { fireEvent } = await import('@testing-library/react');
    fireEvent.error(logo);

    expect(await screen.findByRole('img', { name: 'Sharma Kirana Store logo' })).toHaveTextContent(
      'SK',
    );
  });

  it('shows initials immediately when there is no image at all', async () => {
    renderStore({ store: storeFixture({ logoUrl: null, coverImageUrl: null }) });

    await screen.findByRole('heading', { level: 1, name: 'Sharma Kirana Store' });
    expect(screen.getByRole('img', { name: 'Sharma Kirana Store logo' })).toHaveTextContent('SK');
  });
});

describe('initialsOf', () => {
  it('takes the first letter of the first two words', () => {
    expect(initialsOf('Sharma Kirana Store')).toBe('SK');
    expect(initialsOf('Green Leaf Bakery')).toBe('GL');
  });

  it('takes two letters from a single word', () => {
    expect(initialsOf('Pharmacy')).toBe('PH');
  });

  it('copes with nothing usable', () => {
    expect(initialsOf('')).toBe('?');
    expect(initialsOf(null)).toBe('?');
    expect(initialsOf('   ')).toBe('?');
    expect(initialsOf('— —')).toBe('?');
  });
});

describe('formatTime', () => {
  it('turns 24-hour wall clock into something readable', () => {
    expect(formatTime('08:00')).toBe('8:00 am');
    expect(formatTime('13:30')).toBe('1:30 pm');
    expect(formatTime('00:00')).toBe('12:00 am');
    expect(formatTime('12:00')).toBe('12:00 pm');
    expect(formatTime('23:59')).toBe('11:59 pm');
  });

  it('returns nothing for nothing', () => {
    expect(formatTime(null)).toBeNull();
    expect(formatTime(undefined)).toBeNull();
  });
});

describe('describeStatus', () => {
  it('reads an open store', () => {
    expect(describeStatus({ isOpen: true, closesAt: '21:00' })).toEqual({
      label: 'Open now',
      detail: 'Closes at 9:00 pm',
      isOpen: true,
    });
  });

  it('says when a closed store opens later today', () => {
    expect(describeStatus({ isOpen: false, opensAt: '17:00', opensOn: 'mon', localDay: 'mon' })).toEqual(
      { label: 'Closed', detail: 'Opens 5:00 pm', isOpen: false },
    );
  });

  it('names the day when it is not today', () => {
    expect(describeStatus({ isOpen: false, opensAt: '08:00', opensOn: 'mon', localDay: 'sun' })).toEqual(
      { label: 'Closed', detail: 'Opens Monday at 8:00 am', isOpen: false },
    );
  });

  it('copes with a store that has no hours recorded', () => {
    expect(describeStatus(null).label).toBe('Hours unknown');
    expect(describeStatus({ isOpen: false }).detail).toBeNull();
  });
});

describe('weekSchedule', () => {
  it('returns all seven days in order, starting Monday', () => {
    const week = weekSchedule(storeFixture().hours);

    expect(week.map((day) => day.key)).toEqual(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
  });

  it('marks today', () => {
    const week = weekSchedule(storeFixture().hours);

    expect(week.filter((day) => day.isToday).map((day) => day.key)).toEqual(['mon']);
  });

  it('says Closed for a day with no windows, rather than leaving a gap', () => {
    const week = weekSchedule({
      localDay: 'mon',
      openingHours: { mon: [{ open: '08:00', close: '21:00' }] },
    });

    expect(week.find((day) => day.key === 'sun').text).toBe('Closed');
  });

  it('joins a split day', () => {
    const week = weekSchedule({
      localDay: 'mon',
      openingHours: {
        mon: [
          { open: '08:00', close: '13:00' },
          { open: '17:00', close: '21:00' },
        ],
      },
    });

    expect(week.find((day) => day.key === 'mon').text).toBe(
      '8:00 am – 1:00 pm, 5:00 pm – 9:00 pm',
    );
  });
});
