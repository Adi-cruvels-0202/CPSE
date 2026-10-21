/**
 * The platform admin portal (migration 0045) against real Postgres: publishing
 * through verification, admin roles, account suspension, admin management,
 * store moderation, the action log — and the starter categories a new store
 * gets. Every rule that protects the platform from its own admins is tested
 * by trying to break it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../src/lib/supabase.js', async () => {
  const { createPgSupabase } = await import('../helpers/pgSupabase.js');
  return createPgSupabase();
});

const { resetDatabase, sql, createUser, authHeader } = await import('../helpers/pgSupabase.js');
const flow = await import('./flow.js');
const { call, expectStatus } = flow;

beforeEach(async () => {
  await resetDatabase();
});

const storePath = (shop) => `/merchant/stores/${shop.store.id}`;

/** Details, documents and submission — the merchant's half of verification. */
async function submitForReview(shop) {
  expectStatus(await call('put', `${storePath(shop)}/verification`, shop.merchant, {
    legalName: 'Sharma Traders', businessType: 'proprietorship', ownerName: 'Ramesh Sharma', ownerPhone: '+919876500000',
  }), 200);
  const image = await flow.samplePhoto();
  for (const type of ['shop_photo', 'identity_proof', 'address_proof']) expectStatus(await flow.uploadDocument(shop, type, image), 201);
  expectStatus(await call('post', `${storePath(shop)}/verification/submit`, shop.merchant, {}), 200);
}

const notifications = async (shop) =>
  sql('select title, body from merchant_notifications where store_id = $1 order by created_at', [shop.store.id]);
const actions = async () => sql('select action, target_type, admin_email, reason, details from admin_actions order by created_at');

describe('publishing goes through verification without a dead end', () => {
  it('remembers Publish before verification, and approval puts the store live', async () => {
    const shop = await flow.openShop();
    const refused = await call('post', `${storePath(shop)}/publish`, shop.merchant);
    expect(refused.status).toBe(422);
    expect(refused.body.error.details).toMatchObject({ missing: ['verification'], verificationStatus: 'not_submitted', publishWhenVerified: true });
    expect(refused.body.error.message).toMatch(/Send your store for verification/);
    const { store } = expectStatus(await call('get', storePath(shop), shop.merchant), 200);
    expect(store.publishRequestedAt).not.toBeNull();

    await submitForReview(shop);
    const pending = await call('post', `${storePath(shop)}/publish`, shop.merchant);
    expect(pending.body.error.message).toMatch(/CPSE is checking your store/);

    const reviewer = await flow.newAdmin({ role: 'reviewer' });
    const review = expectStatus(await call('get', `/admin/verifications/${shop.store.id}`, reviewer.auth), 200);
    expect(review.store.publishRequestedAt).not.toBeNull();
    const approved = expectStatus(await call('post', `/admin/verifications/${shop.store.id}/approve`, reviewer.auth, {}), 200);
    expect(approved.published).toBe(true);

    const after = expectStatus(await call('get', storePath(shop), shop.merchant), 200).store;
    expect(after).toMatchObject({ isPublished: true, verificationStatus: 'verified', publishRequestedAt: null });
    expect((await call('get', `/stores/${shop.store.slug}`, null)).status).toBe(200);
    expect((await notifications(shop)).at(-1).title).toMatch(/verified and live/);
    expect(await actions()).toEqual([expect.objectContaining({ action: 'store_approved', target_type: 'store', details: { published: true } })]);
  });

  it('approval alone does not publish a store whose owner never asked', async () => {
    const shop = await flow.openShop();
    await submitForReview(shop);
    const admin = await flow.newAdmin();
    expect(expectStatus(await call('post', `/admin/verifications/${shop.store.id}/approve`, admin.auth, {}), 200).published).toBe(false);
    expect(expectStatus(await call('get', storePath(shop), shop.merchant), 200).store.isPublished).toBe(false);
    expect((await notifications(shop)).at(-1).body).toMatch(/You can publish your store now/);
  });

  it('approval does not publish over missing details, and says what is missing', async () => {
    const shop = await flow.openShop();
    await sql('update stores set phone = null where id = $1', [shop.store.id]);
    expect((await call('post', `${storePath(shop)}/publish`, shop.merchant)).body.error.details.missing).toEqual(['phone', 'verification']);
    await submitForReview(shop);
    const admin = await flow.newAdmin();
    expect(expectStatus(await call('post', `/admin/verifications/${shop.store.id}/approve`, admin.auth, {}), 200).published).toBe(false);
    expect((await notifications(shop)).at(-1).body).toMatch(/Add phone and publish/);
  });

  it('revoking a verification takes the store down and is logged as a revocation', async () => {
    const shop = await flow.openShop();
    await flow.publish(shop);
    const admin = await flow.newAdmin();
    expectStatus(await call('post', `/admin/verifications/${shop.store.id}/reject`, admin.auth, { reason: 'Documents were forged.' }), 200);
    expect(expectStatus(await call('get', storePath(shop), shop.merchant), 200).store.isPublished).toBe(false);
    expect((await actions()).at(-1)).toMatchObject({ action: 'store_verification_revoked', reason: 'Documents were forged.' });
  });
});

describe('admin roles', () => {
  it('lets each role do exactly its own work', async () => {
    const shop = await flow.openShop();
    await submitForReview(shop);
    const support = await flow.newAdmin({ role: 'support' });
    const reviewer = await flow.newAdmin({ role: 'reviewer' });
    const customerId = await createUser({ fullName: 'Asha' });

    const me = expectStatus(await call('get', '/admin/me', support.auth), 200).admin;
    expect(me).toMatchObject({ role: 'support' });
    expect(me.permissions).toEqual(expect.arrayContaining(['handleSupport', 'viewStores']));
    expect(me.permissions).not.toContain('reviewStores');

    // Everyone reads.
    for (const who of [support, reviewer]) {
      for (const path of ['/admin/overview', '/admin/stores', `/admin/stores/${shop.store.id}`, '/admin/accounts', `/admin/accounts/${customerId}`, '/admin/log']) {
        expect((await call('get', path, who.auth)).status).toBe(200);
      }
    }
    // Support: no verification decisions, no suspensions, no admin management.
    const supportRefusal = await call('post', `/admin/verifications/${shop.store.id}/approve`, support.auth, {});
    expect(supportRefusal.status).toBe(403);
    expect(supportRefusal.body.error.message).toMatch(/support/);
    expect((await call('get', '/admin/verifications', support.auth)).status).toBe(403);
    expect((await call('post', `/admin/accounts/${customerId}/suspend`, support.auth, { reason: 'Spam orders' })).status).toBe(403);
    expect((await call('get', '/admin/support', support.auth)).status).toBe(200);
    // Reviewer: decisions yes, support / suspensions / admins no.
    expect((await call('get', '/admin/support', reviewer.auth)).status).toBe(403);
    expect((await call('post', `/admin/accounts/${customerId}/suspend`, reviewer.auth, { reason: 'Spam orders' })).status).toBe(403);
    expect((await call('get', '/admin/admins', reviewer.auth)).status).toBe(403);
    expectStatus(await call('post', `/admin/verifications/${shop.store.id}/approve`, reviewer.auth, {}), 200);
  });

  it('refuses shop and customer accounts everywhere in the portal', async () => {
    const shop = await flow.openShop();
    const customer = await flow.newCustomer();
    for (const auth of [shop.merchant, customer.auth]) {
      expect((await call('get', '/admin/overview', auth)).status).toBe(403);
      expect((await call('get', '/admin/accounts', auth)).status).toBe(403);
    }
  });
});

describe('account suspension', () => {
  it('locks a customer out of every signed-in request until reinstated', async () => {
    const admin = await flow.newAdmin();
    const customer = await flow.newCustomer();
    expect((await call('get', '/me', customer.auth)).status).toBe(200);

    expect((await call('post', `/admin/accounts/${customer.id}/suspend`, admin.auth, { reason: 'x' })).status).toBe(422);
    const suspended = expectStatus(await call('post', `/admin/accounts/${customer.id}/suspend`, admin.auth, { reason: 'Repeated fake orders' }), 200);
    expect(suspended.account).toMatchObject({ isSuspended: true, suspendedReason: 'Repeated fake orders' });

    const refused = await call('get', '/me', customer.auth);
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe('ACCOUNT_SUSPENDED');
    expect(refused.body.error.message).toMatch(/Repeated fake orders/);
    expect((await call('post', `/admin/accounts/${customer.id}/suspend`, admin.auth, { reason: 'Again' })).status).toBe(409);

    expectStatus(await call('post', `/admin/accounts/${customer.id}/reinstate`, admin.auth, { reason: 'Appeal accepted' }), 200);
    expect((await call('get', '/me', customer.auth)).status).toBe(200);
    expect((await actions()).map((a) => a.action)).toEqual(['account_suspended', 'account_reinstated']);
  });

  it('locks a shop owner out of the shop app too, and public pages keep working', async () => {
    const shop = await flow.openShop();
    await flow.publish(shop);
    const admin = await flow.newAdmin();
    expectStatus(await call('post', `/admin/accounts/${shop.merchantId}/suspend`, admin.auth, { reason: 'Selling counterfeit goods' }), 200);
    const refused = await call('get', storePath(shop), shop.merchant);
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe('ACCOUNT_SUSPENDED');
    expect((await call('get', `/stores/${shop.store.slug}`, null)).status).toBe(200);
  });

  it('cannot be used on yourself or on another admin', async () => {
    const admin = await flow.newAdmin();
    const other = await flow.newAdmin({ role: 'reviewer' });
    expect((await call('post', `/admin/accounts/${admin.id}/suspend`, admin.auth, { reason: 'Testing myself' })).status).toBe(403);
    const onAdmin = await call('post', `/admin/accounts/${other.id}/suspend`, admin.auth, { reason: 'Testing an admin' });
    expect(onAdmin.status).toBe(403);
    expect(onAdmin.body.error.message).toMatch(/Remove it as an admin/);
  });
});

describe('managing admins', () => {
  it('adds, changes and removes admins; nobody changes or removes themselves', async () => {
    const boss = await flow.newAdmin();
    const helperId = await createUser({ email: 'helper@test.cpse.local', fullName: 'Helper' });
    const shop = await flow.openShop();
    const [{ email: shopEmail }] = await sql('select email from customers where id = $1', [shop.merchantId]);

    const added = expectStatus(await call('post', '/admin/admins', boss.auth, { email: 'helper@test.cpse.local', role: 'reviewer' }), 201).admin;
    expect(added).toMatchObject({ id: helperId, role: 'reviewer' });
    expect((await call('post', '/admin/admins', boss.auth, { email: 'helper@test.cpse.local', role: 'support' })).status).toBe(409);
    const unknown = await call('post', '/admin/admins', boss.auth, { email: 'nobody@test.cpse.local', role: 'support' });
    expect(unknown.body.error.code).toBe('ACCOUNT_NOT_FOUND');
    const shopAccount = await call('post', '/admin/admins', boss.auth, { email: shopEmail, role: 'support' });
    expect(shopAccount.body.error.code).toBe('SHOP_ACCOUNT');

    // The new reviewer can now review, and only that.
    const helper = { auth: authHeader(helperId) };
    expect((await call('get', '/admin/verifications', helper.auth)).status).toBe(200);

    expect((await call('patch', `/admin/admins/${boss.id}`, boss.auth, { role: 'support' })).status).toBe(403);
    expectStatus(await call('patch', `/admin/admins/${helperId}`, boss.auth, { role: 'superadmin' }), 200);
    // Now the helper is a superadmin, the original one can be demoted by them…
    expectStatus(await call('patch', `/admin/admins/${boss.id}`, helper.auth, { role: 'support' }), 200);
    // A removed admin is no longer an admin at all, and nobody removes themselves.
    const second = await flow.newAdmin({ role: 'superadmin' });
    expectStatus(await call('post', `/admin/admins/${second.id}/remove`, helper.auth, { reason: 'Left the team' }), 200);
    const lastOne = await call('patch', `/admin/admins/${helperId}`, second.auth, { role: 'support' });
    expect(lastOne.status).toBe(403);  // the removed admin is no longer an admin at all
    expect((await call('post', `/admin/admins/${helperId}/remove`, helper.auth, { reason: 'Leaving' })).status).toBe(403);  // not yourself

    const log = expectStatus(await call('get', '/admin/log?targetType=admin', helper.auth), 200).actions;
    expect(log.map((a) => a.action)).toEqual(['admin_removed', 'admin_role_changed', 'admin_role_changed', 'admin_added']);
  });

  // Only superadmins manage admins and nobody changes themselves, so through
  // the API a superadmin is always changed by another one; the "last
  // superadmin" guard in the service is a backstop for the command line.
  it('only superadmins manage admins, and never themselves', async () => {
    const a = await flow.newAdmin();
    const b = await flow.newAdmin();
    expectStatus(await call('patch', `/admin/admins/${b.id}`, a.auth, { role: 'reviewer' }), 200);
    const onlyOne = await call('patch', `/admin/admins/${a.id}`, a.auth, { role: 'reviewer' });
    expect(onlyOne.status).toBe(403);  // yourself
    const c = await flow.newAdmin({ role: 'superadmin' });
    expectStatus(await call('patch', `/admin/admins/${c.id}`, a.auth, { role: 'support' }), 200);
    const last = await call('post', `/admin/admins/${a.id}/remove`, c.auth, { reason: 'Trying' });
    expect(last.status).toBe(403);  // c is support now, not allowed to manage admins
  });
});

describe('stores and accounts in the portal', () => {
  it('lists, searches and filters stores, and takes one down with a reason', async () => {
    const live = await flow.openShop({ name: 'Sharma Kirana' });
    await flow.publish(live);
    const waiting = await flow.openShop({ name: 'Gupta Bakery', shopCategory: 'bakery' });
    await submitForReview(waiting);
    const admin = await flow.newAdmin({ role: 'reviewer' });

    const all = expectStatus(await call('get', '/admin/stores', admin.auth), 200).stores;
    expect(all.map((s) => s.name).sort()).toEqual(['Gupta Bakery', 'Sharma Kirana']);
    expect(expectStatus(await call('get', '/admin/stores?verification=pending', admin.auth), 200).stores.map((s) => s.name)).toEqual(['Gupta Bakery']);
    expect(expectStatus(await call('get', '/admin/stores?published=yes', admin.auth), 200).stores.map((s) => s.name)).toEqual(['Sharma Kirana']);
    expect(expectStatus(await call('get', '/admin/stores?search=bake', admin.auth), 200).stores.map((s) => s.name)).toEqual(['Gupta Bakery']);
    expect(all.find((s) => s.name === 'Sharma Kirana').owner.email).toMatch(/@/);

    const detail = expectStatus(await call('get', `/admin/stores/${live.store.id}`, admin.auth), 200);
    expect(detail.store).toMatchObject({ isPublished: true, missingForPublish: [] });
    expect(detail.counts).toMatchObject({ products: 0, orders: 0 });

    expect((await call('post', `/admin/stores/${live.store.id}/unpublish`, admin.auth, {})).status).toBe(422);
    const down = expectStatus(await call('post', `/admin/stores/${live.store.id}/unpublish`, admin.auth, { reason: 'Selling banned items.' }), 200);
    expect(down.store.isPublished).toBe(false);
    expect((await call('get', `/stores/${live.store.slug}`, null)).status).toBe(404);
    expect((await notifications(live)).at(-1).body).toMatch(/Selling banned items/);
    expect(down.actions[0]).toMatchObject({ action: 'store_unpublished', reason: 'Selling banned items.' });
    expect((await call('post', `/admin/stores/${live.store.id}/unpublish`, admin.auth, { reason: 'Again please' })).status).toBe(409);
  });

  it('tells customers, shop owners and admins apart, with search and counts', async () => {
    const shop = await flow.openShop();
    const customer = await flow.newCustomer('Meera Iyer');
    const admin = await flow.newAdmin();
    const kinds = async (q) => Object.fromEntries(expectStatus(await call('get', `/admin/accounts${q}`, admin.auth), 200).accounts.map((a) => [a.id, a.type]));

    const everyone = await kinds('');
    expect(everyone).toMatchObject({ [shop.merchantId]: 'merchant', [customer.id]: 'customer', [admin.id]: 'admin' });
    expect(Object.keys(await kinds('?kind=customer'))).toEqual([customer.id]);
    expect(Object.keys(await kinds('?kind=merchant'))).toEqual([shop.merchantId]);
    expect(Object.keys(await kinds('?search=meera'))).toEqual([customer.id]);

    const owner = expectStatus(await call('get', `/admin/accounts/${shop.merchantId}`, admin.auth), 200);
    expect(owner.account).toMatchObject({ type: 'merchant', storeCount: 1 });
    expect(owner.stores.map((s) => s.id)).toEqual([shop.store.id]);
    expect((await call('get', `/admin/accounts/${'0'.repeat(8)}-0000-4000-8000-${'0'.repeat(12)}`, admin.auth)).status).toBe(404);

    const overview = expectStatus(await call('get', '/admin/overview', admin.auth), 200).overview;
    expect(overview.accounts).toMatchObject({ merchants: 1, customers: 1 });
    expect(overview.you.role).toBe('superadmin');
  });

  it('keeps the action log append-only', async () => {
    const admin = await flow.newAdmin();
    const customer = await flow.newCustomer();
    expectStatus(await call('post', `/admin/accounts/${customer.id}/suspend`, admin.auth, { reason: 'Abuse of staff' }), 200);
    await expect(sql("update admin_actions set reason = 'nothing happened'")).rejects.toThrow(/immutable/);
    await expect(sql('delete from admin_actions')).rejects.toThrow(/immutable/);
  });
});

describe('starter categories for a new store', () => {
  const names = async (shop) => expectStatus(await call('get', `${storePath(shop)}/categories`, shop.merchant), 200).categories.map((c) => c.name);

  it('gives each kind of shop its usual categories, in order', async () => {
    expect(await names(await flow.openShop({ shopCategory: 'grocery' }))).toEqual(
      ['Rice & Grains', 'Atta & Flours', 'Dals & Pulses', 'Fruits & Vegetables', 'Dairy & Eggs', 'Oils & Ghee', 'Spices', 'Tea & Coffee', 'Snacks & Biscuits', 'Household'],
    );
    expect(await names(await flow.openShop({ name: 'Pastry Palace', shopCategory: 'bakery' }))).toEqual(['Cakes', 'Breads', 'Cookies', 'Snacks & Savouries', 'Sweets']);
    expect(await names(await flow.openShop({ name: 'Spice Route', shopCategory: 'restaurant' }))).toContain('Main Course');
    expect(await names(await flow.openShop({ name: 'Odds and Ends', shopCategory: 'other' }))).toEqual([]);
  });

  it('adds no products, and a stationery shop can save its own type', async () => {
    const shop = await flow.openShop({ name: 'Ink Well', shopCategory: 'stationery' });
    expect(expectStatus(await call('get', `${storePath(shop)}/products`, shop.merchant), 200).products).toEqual([]);
    expectStatus(await call('patch', storePath(shop), shop.merchant, { shopCategory: 'stationery' }), 200);
  });

  it('adds the remaining starter categories on request, skipping those already there', async () => {
    const shop = await flow.openShop({ shopCategory: 'other' });
    expectStatus(await call('post', `${storePath(shop)}/categories`, shop.merchant, { name: 'Cakes' }), 201);
    const { report } = expectStatus(await call('post', `${storePath(shop)}/templates/apply`, shop.merchant, {
      industry: 'bakery', applyDefaults: false, categories: ['Cakes', 'Breads'], products: [],
    }), 201);
    expect(report).toMatchObject({ categoriesCreated: ['Breads'], categoriesSkipped: ['Cakes'], productsCreated: [] });
  });
});
