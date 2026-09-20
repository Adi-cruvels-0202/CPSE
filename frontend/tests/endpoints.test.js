import { describe, it, expect } from 'vitest';
import { endpoints } from '../src/lib/endpoints.js';
import { writeSession } from '../src/lib/tokens.js';
import { mockFetch, ok, sessionFixture } from './helpers/api.js';

/**
 * The endpoint map against backend/docs/API.md.
 *
 * What is worth testing here is not that a URL string is right — a typo shows up
 * the first time a screen runs — but the `auth` mode on each call, because
 * getting that wrong fails in a way nobody notices while developing signed in:
 * a public store page that demands a token works perfectly on your machine and
 * is broken for every shared link.
 */

const pathOf = (url) => new URL(url).pathname.replace('/api/v1', '');

describe('public store pages carry a token only when there is one', () => {
  it.each([
    ['get', () => endpoints.stores.get('sharma-kirana'), '/stores/sharma-kirana'],
    ['categories', () => endpoints.stores.categories('sharma-kirana'), '/stores/sharma-kirana/categories'],
    ['products', () => endpoints.stores.products('sharma-kirana'), '/stores/sharma-kirana/products'],
    ['product', () => endpoints.stores.product('sharma-kirana', 'p1'), '/stores/sharma-kirana/products/p1'],
    ['search', () => endpoints.stores.search('sharma-kirana', { q: 'ri' }), '/stores/sharma-kirana/search'],
    ['payment methods', () => endpoints.payments.methods(), '/payments/methods'],
  ])('%s works signed out', async (_label, call, expectedPath) => {
    const { calls } = mockFetch([ok({})]);

    await call();

    expect(pathOf(calls[0].url)).toBe(expectedPath);
    expect(calls[0].headers.authorization).toBeUndefined();
  });

  it('personalises when there is a session', async () => {
    writeSession(sessionFixture());
    const { calls } = mockFetch([ok({})]);

    await endpoints.stores.get('sharma-kirana');

    expect(calls[0].headers.authorization).toBe('Bearer access-1');
  });
});

describe('credential calls never carry a token', () => {
  it.each([
    ['login', () => endpoints.auth.login({ email: 'a@b.c', password: 'x' })],
    ['register', () => endpoints.auth.register({ email: 'a@b.c', password: 'x' })],
    ['forgot password', () => endpoints.auth.forgotPassword({ email: 'a@b.c' })],
    ['reset password', () => endpoints.auth.resetPassword({ accessToken: 't', password: 'x' })],
  ])('%s', async (_label, call) => {
    // Signed in as someone else — switching accounts must not send the old token.
    writeSession(sessionFixture());
    const { calls } = mockFetch([ok({})]);

    await call();

    expect(calls[0].headers.authorization).toBeUndefined();
  });

  it('logout DOES carry the token, because the server revokes it', async () => {
    writeSession(sessionFixture());
    const { calls } = mockFetch([ok({})]);

    await endpoints.auth.logout();

    expect(calls[0].headers.authorization).toBe('Bearer access-1');
  });
});

describe('owned resources require a token', () => {
  it.each([
    ['profile', () => endpoints.profile.get(), 'GET', '/me'],
    ['cart', () => endpoints.cart.get('store-1'), 'GET', '/cart'],
    ['add to cart', () => endpoints.cart.addItem({ storeId: 's' }), 'POST', '/cart/items'],
    ['addresses', () => endpoints.addresses.list(), 'GET', '/addresses'],
    ['quote', () => endpoints.checkout.quote({ storeId: 's' }), 'POST', '/checkout/quote'],
    ['orders', () => endpoints.orders.list(), 'GET', '/orders'],
    ['order', () => endpoints.orders.get('o1'), 'GET', '/orders/o1'],
    ['receipt', () => endpoints.orders.receipt('o1'), 'GET', '/orders/o1/receipt'],
    ['reorder', () => endpoints.orders.reorder('o1'), 'POST', '/orders/o1/reorder'],
    ['saved stores', () => endpoints.savedStores.list(), 'GET', '/saved-stores'],
    ['save a store', () => endpoints.stores.save('s1'), 'POST', '/stores/s1/save'],
    ['unsave a store', () => endpoints.stores.unsave('s1'), 'DELETE', '/stores/s1/save'],
    ['notifications', () => endpoints.notifications.list(), 'GET', '/notifications'],
    ['unread count', () => endpoints.notifications.unreadCount(), 'GET', '/notifications/unread-count'],
    ['mark all read', () => endpoints.notifications.markAllRead(), 'POST', '/notifications/read-all'],
    ['khata', () => endpoints.khata.list(), 'GET', '/khata'],
    ['khata account', () => endpoints.khata.get('a1'), 'GET', '/khata/a1'],
    ['khata statement', () => endpoints.khata.statement('a1'), 'GET', '/khata/a1/statement'],
    ['initiate payment', () => endpoints.payments.initiate('o1'), 'POST', '/payments/o1/initiate'],
  ])('%s sends the token to %s %s', async (_label, call, method, path) => {
    writeSession(sessionFixture());
    const { calls } = mockFetch([ok({})]);

    await call();

    expect(calls[0].method).toBe(method);
    expect(pathOf(calls[0].url)).toBe(path);
    expect(calls[0].headers.authorization).toBe('Bearer access-1');
  });
});

describe('the shapes the backend is fussy about', () => {
  it('passes storeId as a query parameter on the cart, not a path segment', async () => {
    writeSession(sessionFixture());
    const { calls } = mockFetch([ok({})]);

    await endpoints.cart.get('store-1');

    expect(new URL(calls[0].url).searchParams.get('storeId')).toBe('store-1');
  });

  it('sends an Idempotency-Key on order creation', async () => {
    writeSession(sessionFixture());
    const { calls } = mockFetch([ok({})]);

    await endpoints.orders.create({ storeId: 's1' }, 'key-xyz');

    expect(calls[0].headers['idempotency-key']).toBe('key-xyz');
  });

  it('sends an empty object, not nothing, where the backend expects a body', async () => {
    writeSession(sessionFixture());
    const { calls } = mockFetch([ok({}), ok({})]);

    await endpoints.orders.cancel('o1');
    await endpoints.payments.verify('o1');

    // These routes validate a body; the backend rejects an unknown field but
    // accepts an empty object.
    expect(calls[0].body).toEqual({});
    expect(calls[1].body).toEqual({});
  });

  it('sends no body at all where the backend expects none', async () => {
    writeSession(sessionFixture());
    const { calls } = mockFetch([ok({}), ok({}), ok({})]);

    await endpoints.stores.save('s1');
    await endpoints.notifications.markAllRead();
    await endpoints.orders.reorder('o1');

    for (const call of calls) expect(call.body).toBeUndefined();
  });
});
