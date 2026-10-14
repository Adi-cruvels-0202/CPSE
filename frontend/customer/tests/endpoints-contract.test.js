import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { endpoints } from '../src/lib/endpoints.js';
import { writeSession } from '../src/lib/tokens.js';
import { mockFetch, ok, sessionFixture } from './helpers/api.js';

/**
 * Every call in src/lib/endpoints.js against backend/docs/API.md, which the
 * backend's own apiDocs test keeps in step with the mounted routes. A renamed
 * or mistyped path fails here instead of as a 404 in someone's hand.
 */
const API_MD = readFileSync(path.resolve(__dirname, '../../../backend/docs/API.md'), 'utf8');
const DOCUMENTED = [...API_MD.matchAll(/`(GET|POST|PATCH|PUT|DELETE)\s+(\/[^`\s?]*)/g)].map(([, method, raw]) => ({
  method,
  re: new RegExp(`^${raw.replace(/[.,]$/, '').replace(/:[A-Za-z]+/g, '[^/]+')}$`),
}));
const isDocumented = (method, pathname) => DOCUMENTED.some((d) => d.method === method && d.re.test(pathname));
const pathOf = (url) => new URL(url).pathname.replace('/api/v1', '');

const S = '11111111-1111-4111-8111-000000000001';
const X = '22222222-2222-4222-8222-222222222222';

const CALLS = {
  health: [() => endpoints.health()],
  auth: [
    () => endpoints.auth.register({}), () => endpoints.auth.login({}), () => endpoints.auth.logout(),
    () => endpoints.auth.forgotPassword({}), () => endpoints.auth.resetPassword({}),
  ],
  profile: [() => endpoints.profile.get(), () => endpoints.profile.update({})],
  stores: [
    () => endpoints.stores.list(), () => endpoints.stores.get('s'), () => endpoints.stores.categories('s'), () => endpoints.stores.products('s'),
    () => endpoints.stores.product('s', X), () => endpoints.stores.offers('s'), () => endpoints.stores.search('s', { q: 'ri' }),
    () => endpoints.stores.save(S), () => endpoints.stores.unsave(S),
  ],
  savedStores: [() => endpoints.savedStores.list()],
  cart: [
    () => endpoints.cart.get(S), () => endpoints.cart.addItem({}), () => endpoints.cart.updateItem(X, {}), () => endpoints.cart.removeItem(X),
    () => endpoints.cart.clear(S), () => endpoints.cart.validate({}),
  ],
  addresses: [
    () => endpoints.addresses.list(), () => endpoints.addresses.create({}), () => endpoints.addresses.get(X), () => endpoints.addresses.update(X, {}),
    () => endpoints.addresses.remove(X), () => endpoints.addresses.setDefault(X),
  ],
  checkout: [() => endpoints.checkout.quote({}), () => endpoints.checkout.quick(S)],
  orders: [
    () => endpoints.orders.create({}, 'k'), () => endpoints.orders.list(), () => endpoints.orders.get(X), () => endpoints.orders.cancel(X),
    () => endpoints.orders.receipt(X), () => endpoints.orders.reorder(X),
  ],
  payments: [() => endpoints.payments.methods(), () => endpoints.payments.initiate(X), () => endpoints.payments.verify(X)],
  notifications: [
    () => endpoints.notifications.list(), () => endpoints.notifications.unreadCount(), () => endpoints.notifications.markRead(X),
    () => endpoints.notifications.markAllRead(), () => endpoints.notifications.deliveries(X),
  ],
  substitutions: [() => endpoints.substitutions.respond(X, { approve: true })],
  preferences: [
    () => endpoints.preferences.get(), () => endpoints.preferences.update({}), () => endpoints.preferences.stores(),
    () => endpoints.preferences.store(S), () => endpoints.preferences.setStore(S, {}),
  ],
  shopping: [
    () => endpoints.shopping.recordEvent({}), () => endpoints.shopping.recentlyViewed(), () => endpoints.shopping.recentlyPurchased(),
    () => endpoints.shopping.buyAgain(), () => endpoints.shopping.smartCart(S), () => endpoints.shopping.addUsual(S), () => endpoints.shopping.insights(),
    () => endpoints.shopping.favourites(), () => endpoints.shopping.favourite(X), () => endpoints.shopping.unfavourite(X),
  ],
  lists: [
    () => endpoints.lists.list(), () => endpoints.lists.get(X), () => endpoints.lists.create({}), () => endpoints.lists.update(X, {}),
    () => endpoints.lists.remove(X), () => endpoints.lists.addItem(X, {}), () => endpoints.lists.updateItem(X, X, {}),
    () => endpoints.lists.removeItem(X, X), () => endpoints.lists.addToCart(X),
  ],
  loyalty: [() => endpoints.loyalty.mine(), () => endpoints.loyalty.store(S), () => endpoints.loyalty.redeem(S, X)],
  offers: [() => endpoints.offers.nearby(30.9, 75.85)],
  intelligence: [
    () => endpoints.intelligence.smartSearch('s', '2 kg rice'), () => endpoints.intelligence.assistant('s', 'open?'),
    () => endpoints.intelligence.recommendations('s', X), () => endpoints.intelligence.alternatives('s', X),
    () => endpoints.intelligence.proposeBasket(S, 'rice'), () => endpoints.intelligence.replenishment(), () => endpoints.intelligence.discover(S),
  ],
  conversations: [
    () => endpoints.conversations.list(), () => endpoints.conversations.get(X), () => endpoints.conversations.start({}),
    () => endpoints.conversations.reply(X, 'hi'), () => endpoints.conversations.escalate(X, 'late'), () => endpoints.conversations.resolve(X),
  ],
  khata: [() => endpoints.khata.list(), () => endpoints.khata.get(X), () => endpoints.khata.statement(X)],
};

describe('the endpoint map against backend/docs/API.md', () => {
  it('read the reference, and the matcher can say no', () => {
    expect(DOCUMENTED.length).toBeGreaterThan(100);
    expect(isDocumented('GET', '/me/nothing-here')).toBe(false);
  });

  it('lists every call the app has', () => {
    for (const [group, calls] of Object.entries(CALLS)) {
      const target = group === 'health' ? 1 : Object.keys(endpoints[group]).length;
      expect(calls.length, group).toBe(target);
    }
    expect(Object.keys(CALLS).sort()).toEqual(Object.keys(endpoints).sort());
  });

  it.each(Object.entries(CALLS).flatMap(([group, calls]) => calls.map((call, index) => [`${group} #${index + 1}`, call])))('%s is documented', async (_name, call) => {
    writeSession(sessionFixture());
    const { calls } = mockFetch([ok({})]);
    await call();
    const { method, url } = calls[0];
    expect(isDocumented(method, pathOf(url)), `${method} ${pathOf(url)}`).toBe(true);
  });
});
