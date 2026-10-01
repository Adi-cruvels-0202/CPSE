import { describe, it, expect } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../src/context/AuthContext.jsx';
import { AppRoutes } from '../src/router.jsx';
import { writeSession } from '../src/lib/tokens.js';
import { payloadFrom } from '../src/routes/addresses/AddressForm.jsx';
import {
  addressFixture,
  created,
  customerFixture,
  fail,
  mockRoutes,
  noContent,
  ok,
  sessionFixture,
  validationFail,
} from './helpers/api.js';

/** Checklist 11.12 — the address book. */

const ROUTER_FUTURE = { v7_startTransition: true, v7_relativeSplatPath: true };

function renderAddresses({ addresses = [addressFixture()], routes = {} } = {}) {
  writeSession(sessionFixture());

  const mocked = mockRoutes({
    '/me': ok({ customer: customerFixture() }),
    '/addresses': ok({ addresses }),
    ...routes,
  });

  return {
    user: userEvent.setup(),
    ...mocked,
    ...render(
      <MemoryRouter initialEntries={['/account/addresses']} future={ROUTER_FUTURE}>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </MemoryRouter>,
    ),
  };
}

const fill = async (user, label, value) => {
  const input = screen.getByLabelText(new RegExp(label, 'i'));
  await user.clear(input);
  await user.type(input, value);
};

const VALID = [
  ['who is it for', 'Aditya Suresh'],
  ['phone', '+919876543210'],
  ['flat, house or building', '221B Model Town'],
  ['city', 'Ludhiana'],
  ['state', 'Punjab'],
  ['PIN code', '141002'],
];

describe('it needs a session', () => {
  it('sends a stranger to sign in', async () => {
    mockRoutes({ '/addresses': ok({ addresses: [] }) });

    render(
      <MemoryRouter initialEntries={['/account/addresses']} future={ROUTER_FUTURE}>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });
});

describe('the list', () => {
  it('shows each address with its lines and phone', async () => {
    renderAddresses();

    expect(await screen.findByRole('heading', { level: 1, name: 'Addresses' })).toBeInTheDocument();
    expect(screen.getByText('Test Customer')).toBeInTheDocument();
    expect(screen.getByText('221B Model Town')).toBeInTheDocument();
    expect(screen.getByText('Ludhiana, Punjab, 141002')).toBeInTheDocument();
    expect(screen.getByText('+919876543210')).toBeInTheDocument();
  });

  it('marks the default one, and its nickname', async () => {
    renderAddresses();

    await screen.findByRole('heading', { level: 1, name: 'Addresses' });
    expect(screen.getByText('Default')).toBeInTheDocument();
    expect(screen.getByText('Home')).toBeInTheDocument();
  });

  it('omits empty lines rather than leaving gaps', async () => {
    renderAddresses({
      addresses: [addressFixture({ line2: null, landmark: null, label: null })],
    });

    await screen.findByRole('heading', { level: 1, name: 'Addresses' });
    const card = screen.getByText('221B Model Town').closest('address');
    expect(card.textContent).not.toMatch(/null|undefined/);
  });

  it('says so when there are none, and offers the first one', async () => {
    renderAddresses({ addresses: [] });

    expect(await screen.findByRole('heading', { name: /no addresses yet/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add an address/i })).toBeInTheDocument();
  });

  it('offers a retry when the list will not load', async () => {
    const { user } = renderAddresses({
      routes: {
        '/addresses': [
          fail(500, 'INTERNAL_ERROR', 'Something went wrong on our end.'),
          ok({ addresses: [addressFixture()] }),
        ],
      },
    });

    expect(
      await screen.findByRole('heading', { name: /could not load your addresses/i }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /try again/i }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Addresses' })).toBeInTheDocument();
  });
});

describe('adding one', () => {
  it('sends what was typed, and returns to the list', async () => {
    const { user, calls } = renderAddresses({
      addresses: [],
      routes: { '/addresses': [ok({ addresses: [] }), created({ address: addressFixture() }), ok({ addresses: [addressFixture()] })] },
    });

    await user.click(await screen.findByRole('button', { name: /add an address/i }));
    for (const [label, value] of VALID) await fill(user, label, value);
    await user.click(screen.getByRole('button', { name: /^add address$/i }));

    const post = await waitFor(() => {
      const found = calls.find((call) => call.method === 'POST');
      if (!found) throw new Error('no POST yet');
      return found;
    });

    expect(post.body).toEqual({
      recipientName: 'Aditya Suresh',
      phone: '+919876543210',
      line1: '221B Model Town',
      city: 'Ludhiana',
      state: 'Punjab',
      postalCode: '141002',
    });
    expect(await screen.findByRole('heading', { level: 1, name: 'Addresses' })).toBeInTheDocument();
  });

  it('omits the optional fields rather than sending empty strings', async () => {
    const { user, calls } = renderAddresses({
      addresses: [],
      routes: { '/addresses': [ok({ addresses: [] }), created({ address: addressFixture() }), ok({ addresses: [] })] },
    });

    await user.click(await screen.findByRole('button', { name: /add an address/i }));
    for (const [label, value] of VALID) await fill(user, label, value);
    await user.click(screen.getByRole('button', { name: /^add address$/i }));

    const post = await waitFor(() => {
      const found = calls.find((call) => call.method === 'POST');
      if (!found) throw new Error('no POST yet');
      return found;
    });

    // '' fails the backend's min(1); absent is simply not set.
    for (const key of ['label', 'line2', 'landmark']) {
      expect(key in post.body, key).toBe(false);
    }
  });

  it('sends isDefault only when it was ticked', async () => {
    const { user, calls } = renderAddresses({
      addresses: [],
      routes: { '/addresses': [ok({ addresses: [] }), created({ address: addressFixture() }), ok({ addresses: [] })] },
    });

    await user.click(await screen.findByRole('button', { name: /add an address/i }));
    for (const [label, value] of VALID) await fill(user, label, value);
    await user.click(screen.getByLabelText(/use this as my default/i));
    await user.click(screen.getByRole('button', { name: /^add address$/i }));

    const post = await waitFor(() => {
      const found = calls.find((call) => call.method === 'POST');
      if (!found) throw new Error('no POST yet');
      return found;
    });
    expect(post.body.isDefault).toBe(true);
  });

  it('puts a rejected field under that field', async () => {
    const { user } = renderAddresses({
      addresses: [],
      routes: {
        '/addresses': [
          ok({ addresses: [] }),
          validationFail([
            { source: 'body', field: 'phone', message: 'Enter a valid phone number.' },
            { source: 'body', field: 'postalCode', message: 'Enter a valid postal code.' },
          ]),
        ],
      },
    });

    await user.click(await screen.findByRole('button', { name: /add an address/i }));
    for (const [label, value] of VALID) await fill(user, label, value);
    await user.click(screen.getByRole('button', { name: /^add address$/i }));

    expect(await screen.findByText('Enter a valid phone number.')).toBeInTheDocument();
    expect(screen.getByText('Enter a valid postal code.')).toBeInTheDocument();
    // Still on the form, with what was typed intact.
    expect(screen.getByLabelText(/city/i)).toHaveValue('Ludhiana');
  });

  it('can be abandoned', async () => {
    const { user } = renderAddresses();

    await user.click(await screen.findByRole('button', { name: /add another address/i }));
    expect(screen.getByRole('heading', { name: /add an address/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Addresses' })).toBeInTheDocument();
  });

  it('asks for the fields in the order an address is written', async () => {
    const { user } = renderAddresses();

    await user.click(await screen.findByRole('button', { name: /add another address/i }));

    const labels = screen
      .getAllByText(/who is it for|^phone|flat, house|street or area|landmark|^city|^state|PIN code/i)
      .map((element) => element.textContent.replace(/\s*\(optional\)\s*/, ''));

    // Who, how to reach them, then most specific to least. A form that opens with
    // the postcode makes people stop and think.
    expect(labels.slice(0, 4)).toEqual([
      'Who is it for?',
      'Phone',
      'Flat, house or building',
      'Street or area',
    ]);
    expect(labels.at(-1)).toBe('PIN code');
  });
});

describe('editing one', () => {
  it('opens pre-filled', async () => {
    const { user } = renderAddresses();

    await user.click(await screen.findByRole('button', { name: 'Edit' }));

    expect(screen.getByRole('heading', { name: /edit address/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/who is it for/i)).toHaveValue('Test Customer');
    expect(screen.getByLabelText(/PIN code/i)).toHaveValue('141002');
  });

  it('sends only what changed', async () => {
    const { user, calls } = renderAddresses({
      routes: {
        '/addresses/addr-1': ok({ address: addressFixture({ city: 'Amritsar' }) }),
      },
    });

    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    await fill(user, '^city', 'Amritsar');
    await user.click(screen.getByRole('button', { name: /save address/i }));

    const patch = await waitFor(() => {
      const found = calls.find((call) => call.method === 'PATCH');
      if (!found) throw new Error('no PATCH yet');
      return found;
    });

    // The server rejects an empty patch, and an unchanged field is not news.
    expect(patch.body).toEqual({ city: 'Amritsar' });
  });

  it('clears an optional field with null rather than an empty string', async () => {
    const { user, calls } = renderAddresses({
      addresses: [addressFixture({ landmark: 'Near the Gurudwara' })],
      routes: { '/addresses/addr-1': ok({ address: addressFixture({ landmark: null }) }) },
    });

    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    await user.clear(screen.getByLabelText(/landmark/i));
    await user.click(screen.getByRole('button', { name: /save address/i }));

    const patch = await waitFor(() => {
      const found = calls.find((call) => call.method === 'PATCH');
      if (!found) throw new Error('no PATCH yet');
      return found;
    });
    expect(patch.body).toEqual({ landmark: null });
  });

  it('makes no request when nothing changed', async () => {
    const { user, calls } = renderAddresses();

    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    await user.click(screen.getByRole('button', { name: /save address/i }));

    await screen.findByRole('heading', { level: 1, name: 'Addresses' });
    expect(calls.some((call) => call.method === 'PATCH')).toBe(false);
  });
});

describe('the default address', () => {
  it('moves it, and offers the action only on the others', async () => {
    const other = addressFixture({ id: 'addr-2', recipientName: 'Someone Else', isDefault: false, label: 'Office' });
    const { user, calls } = renderAddresses({
      addresses: [addressFixture(), other],
      routes: { '/addresses/addr-2/default': ok({ address: { ...other, isDefault: true } }) },
    });

    await screen.findByRole('heading', { level: 1, name: 'Addresses' });
    // Only one card offers it: the one that is not already the default.
    const buttons = screen.getAllByRole('button', { name: /make default/i });
    expect(buttons).toHaveLength(1);

    await user.click(buttons[0]);

    await waitFor(() =>
      expect(calls.some((call) => call.url.includes('/addresses/addr-2/default'))).toBe(true),
    );
  });

  it('refetches, because making one default un-defaults another', async () => {
    const other = addressFixture({ id: 'addr-2', isDefault: false });
    const { user, calls } = renderAddresses({
      addresses: [addressFixture(), other],
      routes: { '/addresses/addr-2/default': ok({ address: other }) },
    });

    await screen.findByRole('heading', { level: 1, name: 'Addresses' });
    await user.click(screen.getByRole('button', { name: /make default/i }));

    await waitFor(() => {
      const gets = calls.filter((call) => call.method === 'GET' && call.url.endsWith('/addresses'));
      expect(gets.length).toBeGreaterThan(1);
    });
  });
});

describe('deleting one', () => {
  it('asks first, and names who it is for', async () => {
    const { user, calls } = renderAddresses();

    await user.click(await screen.findByRole('button', { name: 'Delete' }));

    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByText('Test Customer')).toBeInTheDocument();
    // Nothing has happened yet.
    expect(calls.some((call) => call.method === 'DELETE')).toBe(false);
  });

  it('reassures the customer that order history is unaffected', async () => {
    const { user } = renderAddresses();

    await user.click(await screen.findByRole('button', { name: 'Delete' }));

    // Orders snapshot the address, so this is true — and it is the thing someone
    // hesitates over.
    expect(screen.getByRole('alertdialog')).toHaveTextContent(/history will not change/i);
  });

  it('can be called off', async () => {
    const { user, calls } = renderAddresses();

    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    await user.click(screen.getByRole('button', { name: /keep it/i }));

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(calls.some((call) => call.method === 'DELETE')).toBe(false);
  });

  it('deletes on confirmation', async () => {
    const { user, calls } = renderAddresses({
      routes: {
        '/addresses/addr-1': noContent(),
        '/addresses': [ok({ addresses: [addressFixture()] }), ok({ addresses: [] })],
      },
    });

    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    await user.click(screen.getByRole('button', { name: /delete it/i }));

    await waitFor(() => expect(calls.some((call) => call.method === 'DELETE')).toBe(true));
    expect(await screen.findByRole('heading', { name: /no addresses yet/i })).toBeInTheDocument();
  });

  it('reports a refusal and keeps the address', async () => {
    const { user } = renderAddresses({
      routes: { '/addresses/addr-1': fail(409, 'CONFLICT', 'That address is on an open order.') },
    });

    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    await user.click(screen.getByRole('button', { name: /delete it/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/on an open order/i);
    expect(screen.getByText('221B Model Town')).toBeInTheDocument();
  });
});

describe('payloadFrom', () => {
  const form = {
    label: 'Home',
    recipientName: 'Aditya Suresh',
    phone: '+919876543210',
    line1: '221B Model Town',
    line2: '',
    landmark: '',
    city: 'Ludhiana',
    state: 'Punjab',
    postalCode: '141002',
    isDefault: false,
  };

  it('omits blank optional fields on a create', () => {
    const payload = payloadFrom(form, undefined);

    expect(payload).toEqual({
      label: 'Home',
      recipientName: 'Aditya Suresh',
      phone: '+919876543210',
      line1: '221B Model Town',
      city: 'Ludhiana',
      state: 'Punjab',
      postalCode: '141002',
    });
  });

  it('trims what it sends', () => {
    const payload = payloadFrom({ ...form, recipientName: '  Aditya Suresh  ' }, undefined);

    expect(payload.recipientName).toBe('Aditya Suresh');
  });

  it('sends nothing at all when an edit changed nothing', () => {
    const existing = addressFixture({
      label: 'Home',
      recipientName: 'Aditya Suresh',
      phone: '+919876543210',
      line1: '221B Model Town',
      line2: null,
      landmark: null,
      city: 'Ludhiana',
      state: 'Punjab',
      postalCode: '141002',
    });

    expect(payloadFrom(form, existing)).toEqual({});
  });

  it('clears a previously-set optional field with null', () => {
    const existing = addressFixture({ landmark: 'Near the Gurudwara' });

    expect(payloadFrom(form, existing).landmark).toBeNull();
  });

  it('does not send isDefault when it is already the default', () => {
    const existing = addressFixture({ isDefault: true });

    expect('isDefault' in payloadFrom({ ...form, isDefault: true }, existing)).toBe(false);
  });

  it('sends isDefault when turning it on', () => {
    const existing = addressFixture({ isDefault: false });

    expect(payloadFrom({ ...form, isDefault: true }, existing).isDefault).toBe(true);
  });
});
