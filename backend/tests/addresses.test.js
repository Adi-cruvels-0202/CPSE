import { describe, it, expect, beforeEach, vi } from 'vitest';
import { api, url } from './helpers/app.js';

vi.mock('../src/lib/supabase.js', async () => {
  const { createSupabaseMock } = await import('./helpers/supabaseMock.js');
  return createSupabaseMock();
});

const { supabaseAdmin } = await import('../src/lib/supabase.js');
const { db, CUSTOMER_ID, resetDb, seedCustomer } = await import('./helpers/supabaseMock.js');

const OTHER_CUSTOMER_ID = '9f8a1c2e-5b3d-4a7f-9c1e-2d4b6a8c0e99';

beforeEach(() => {
  resetDb();
  vi.clearAllMocks();
  seedCustomer();
  // The other customer exists too, so a cross-owner test is blocked by the
  // ownership rule rather than by a missing profile.
  seedCustomer({ id: OTHER_CUSTOMER_ID, email: 'other@cpse.local' });
});

function signIn(id = CUSTOMER_ID) {
  supabaseAdmin.auth.getUser.mockResolvedValue({ data: { user: { id } }, error: null });
  return { Authorization: 'Bearer token-abc' };
}

const validAddress = (overrides = {}) => ({
  label: 'Home',
  recipientName: 'Aditya Suresh',
  phone: '+919876543210',
  line1: '221B Model Town',
  city: 'Ludhiana',
  state: 'Punjab',
  postalCode: '141002',
  ...overrides,
});

const create = (auth, body = validAddress()) =>
  api().post(url('/addresses')).set(auth).send(body);

describe('POST /api/v1/addresses (6.2)', () => {
  it('requires a signed-in customer', async () => {
    const res = await api().post(url('/addresses')).send(validAddress());

    expect(res.status).toBe(401);
  });

  it('creates an address and returns it in public shape', async () => {
    const auth = signIn();

    const res = await create(auth);

    expect(res.status).toBe(201);
    expect(res.body.data.address).toMatchObject({
      label: 'Home',
      recipientName: 'Aditya Suresh',
      line1: '221B Model Town',
      city: 'Ludhiana',
      postalCode: '141002',
      country: 'IN',
    });
    // Snake-case columns never leak to the wire.
    expect(res.body.data.address).not.toHaveProperty('recipient_name');
    expect(res.body.data.address).not.toHaveProperty('customer_id');
  });

  it('makes the first address the default automatically', async () => {
    const auth = signIn();

    const { body } = await create(auth);

    expect(body.data.address.isDefault).toBe(true);
  });

  it('does not make a second address default unless asked', async () => {
    const auth = signIn();
    await create(auth);

    const { body } = await create(auth, validAddress({ label: 'Office' }));

    expect(body.data.address.isDefault).toBe(false);
  });

  it('moves the default when a new address asks for it (6.5)', async () => {
    const auth = signIn();
    const { body: first } = await create(auth);

    const { body: second } = await create(auth, validAddress({ label: 'Office', isDefault: true }));

    expect(second.data.address.isDefault).toBe(true);
    const { body: list } = await api().get(url('/addresses')).set(auth);
    const previous = list.data.addresses.find((address) => address.id === first.data.address.id);
    // The partial unique index forbids two defaults, so the old one must clear.
    expect(previous.isDefault).toBe(false);
  });

  it('rejects a missing required field', async () => {
    const auth = signIn();
    const { recipientName, ...withoutName } = validAddress();

    const res = await create(auth, withoutName);

    expect(res.status).toBe(422);
    expect(res.body.error.details.issues[0].field).toBe('recipientName');
  });

  it('rejects a phone the database CHECK would reject anyway', async () => {
    const auth = signIn();

    const res = await create(auth, validAddress({ phone: 'call-me' }));

    expect(res.status).toBe(422);
  });

  it('rejects an out-of-range latitude', async () => {
    const auth = signIn();

    const res = await create(auth, validAddress({ latitude: 120 }));

    expect(res.status).toBe(422);
  });

  it('rejects unknown fields instead of dropping them (D20)', async () => {
    const auth = signIn();

    const res = await create(auth, validAddress({ customerId: OTHER_CUSTOMER_ID }));

    expect(res.status).toBe(422);
  });

  it('trims and normalises what it stores', async () => {
    const auth = signIn();

    const { body } = await create(auth, validAddress({ city: '  Ludhiana  ', country: 'in' }));

    expect(body.data.address.city).toBe('Ludhiana');
    expect(body.data.address.country).toBe('IN');
  });
});

describe('GET /api/v1/addresses (6.1, 6.6)', () => {
  it('lists only the caller’s own addresses', async () => {
    const auth = signIn();
    await create(auth, validAddress({ label: 'Mine' }));

    signIn(OTHER_CUSTOMER_ID);
    await create({ Authorization: 'Bearer token-other' }, validAddress({ label: 'Theirs' }));

    signIn();
    const { body } = await api().get(url('/addresses')).set(auth);

    expect(body.data.addresses.map((address) => address.label)).toEqual(['Mine']);
  });

  it('returns the default first', async () => {
    const auth = signIn();
    await create(auth, validAddress({ label: 'Home' }));
    await create(auth, validAddress({ label: 'Office', isDefault: true }));

    const { body } = await api().get(url('/addresses')).set(auth);

    expect(body.data.addresses[0].label).toBe('Office');
  });

  it('returns an empty list, not a 404, for a customer with no addresses', async () => {
    const auth = signIn();

    const res = await api().get(url('/addresses')).set(auth);

    expect(res.status).toBe(200);
    expect(res.body.data.addresses).toEqual([]);
  });
});

describe('PATCH /api/v1/addresses/:id (6.3, 6.6)', () => {
  it('edits the fields it is given and leaves the rest alone', async () => {
    const auth = signIn();
    const { body: created } = await create(auth);

    const res = await api()
      .patch(url(`/addresses/${created.data.address.id}`))
      .set(auth)
      .send({ landmark: 'Opposite the post office' });

    expect(res.status).toBe(200);
    expect(res.body.data.address.landmark).toBe('Opposite the post office');
    expect(res.body.data.address.line1).toBe('221B Model Town');
  });

  it('rejects an empty patch rather than answering 200 to a no-op', async () => {
    const auth = signIn();
    const { body: created } = await create(auth);

    const res = await api()
      .patch(url(`/addresses/${created.data.address.id}`))
      .set(auth)
      .send({});

    expect(res.status).toBe(422);
  });

  it("404s for another customer's address, never 403 (6.6)", async () => {
    signIn(OTHER_CUSTOMER_ID);
    const foreignAuth = { Authorization: 'Bearer token-other' };
    const { body: foreign } = await create(foreignAuth);

    const auth = signIn();
    const res = await api()
      .patch(url(`/addresses/${foreign.data.address.id}`))
      .set(auth)
      .send({ label: 'Hijacked' });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    // And it is untouched.
    expect(db.tables.get('addresses')[0].label).toBe('Home');
  });

  it('422s for an id that is not a uuid', async () => {
    const auth = signIn();

    const res = await api().patch(url('/addresses/nope')).set(auth).send({ label: 'x' });

    expect(res.status).toBe(422);
  });
});

describe('POST /api/v1/addresses/:id/default (6.5)', () => {
  it('moves the default and clears the previous one', async () => {
    const auth = signIn();
    const { body: home } = await create(auth, validAddress({ label: 'Home' }));
    const { body: office } = await create(auth, validAddress({ label: 'Office' }));

    const res = await api().post(url(`/addresses/${office.data.address.id}/default`)).set(auth);

    expect(res.status).toBe(200);
    expect(res.body.data.address.isDefault).toBe(true);

    const { body: list } = await api().get(url('/addresses')).set(auth);
    const defaults = list.data.addresses.filter((address) => address.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0].id).toBe(office.data.address.id);
    expect(home.data.address.id).not.toBe(defaults[0].id);
  });

  it('is idempotent on an address that is already default', async () => {
    const auth = signIn();
    const { body: created } = await create(auth);

    const res = await api().post(url(`/addresses/${created.data.address.id}/default`)).set(auth);

    expect(res.status).toBe(200);
    expect(res.body.data.address.isDefault).toBe(true);
  });

  it("404s for another customer's address (6.6)", async () => {
    signIn(OTHER_CUSTOMER_ID);
    const { body: foreign } = await create({ Authorization: 'Bearer other' });

    const auth = signIn();
    const res = await api().post(url(`/addresses/${foreign.data.address.id}/default`)).set(auth);

    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/v1/addresses/:id (6.4, 6.6)', () => {
  it('deletes the address and answers 204', async () => {
    const auth = signIn();
    const { body: created } = await create(auth);

    const res = await api().delete(url(`/addresses/${created.data.address.id}`)).set(auth);

    expect(res.status).toBe(204);
    expect(db.tables.get('addresses')).toEqual([]);
  });

  it('promotes another address when the default is deleted', async () => {
    const auth = signIn();
    const { body: home } = await create(auth, validAddress({ label: 'Home' }));
    await create(auth, validAddress({ label: 'Office' }));

    await api().delete(url(`/addresses/${home.data.address.id}`)).set(auth);

    const { body: list } = await api().get(url('/addresses')).set(auth);
    expect(list.data.addresses.filter((address) => address.isDefault)).toHaveLength(1);
  });

  it("404s for another customer's address and leaves it in place (6.6)", async () => {
    signIn(OTHER_CUSTOMER_ID);
    const { body: foreign } = await create({ Authorization: 'Bearer other' });

    const auth = signIn();
    const res = await api().delete(url(`/addresses/${foreign.data.address.id}`)).set(auth);

    expect(res.status).toBe(404);
    expect(db.tables.get('addresses')).toHaveLength(1);
  });

  it('404s for an address that never existed', async () => {
    const auth = signIn();

    const res = await api()
      .delete(url('/addresses/a1111111-1111-4111-8111-000000009999'))
      .set(auth);

    expect(res.status).toBe(404);
  });
});
