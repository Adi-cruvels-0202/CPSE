import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import axios from 'axios';
import { http } from '../src/api/client';
import { writeSession } from '../src/lib/session';
import {
  refundApi, substitutionApi, inboxApi, verificationApi, khataApi, catalogueOpsApi, purchaseApi,
  crmApi, loyaltyApi, couponApi, offerApi, messagingApi, automationApi,
} from '../src/api/ops';
import { inventoryApi } from '../src/api/endpoints';
import { adminApi, adminHttp, writeAdminSession } from '../src/admin/adminApi';

/**
 * The contract between the merchant screens and the backend: every call in
 * src/api/ops.ts must hit a route that backend docs/API.md documents (and
 * apiDocs.test.js in the backend proves every documented route is mounted).
 * A renamed or mistyped path fails here instead of as a 404 in the shop.
 */

const API_MD = readFileSync(path.resolve(__dirname, '../../../backend/docs/API.md'), 'utf8');
const DOCUMENTED = [...API_MD.matchAll(/`(GET|POST|PATCH|PUT|DELETE)\s+(\/[^`\s?]*)/g)].map(([, method, raw]) => {
  const route = raw.replace(/[.,]$/, '');
  return { method, route, re: new RegExp(`^${route.replace(/:[A-Za-z]+/g, '[^/]+')}$`) };
});
const isDocumented = (method: string, url: string) => DOCUMENTED.some((d) => d.method === method && d.re.test(url));

interface Sent { method: string; url: string; params?: any; data?: any; headers: any }
let sent: Sent[] = [];

beforeEach(() => {
  window.localStorage.clear();
  writeSession({ accessToken: 'token-1', refreshToken: 'refresh-1' });
  sent = [];
  const adapter = vi.fn(async (config: any) => {
    sent.push({ method: config.method.toUpperCase(), url: config.url, params: config.params, data: config.data, headers: config.headers });
    const isText = config.responseType === 'text';
    return { status: 200, headers: {}, config, statusText: 'OK', data: isText ? 'a,b\n1,2\n' : { success: true, data: {}, meta: { page: 1, limit: 20, total: 0, totalPages: 0, hasNextPage: false } } };
  });
  http.defaults.adapter = adapter as any;
  adminHttp.defaults.adapter = adapter as any;
  axios.defaults.adapter = adapter as any;
});

const S = '11111111-1111-4111-8111-111111111111';
const ID = '22222222-2222-4222-8222-222222222222';
const ID2 = '33333333-3333-4333-8333-333333333333';

/** Every client call, with representative arguments. */
const CALLS: [string, () => Promise<unknown>][] = [
  ['refunds.list', () => refundApi.list(S, { status: 'failed' })],
  ['refunds.get', () => refundApi.get(S, ID)],
  ['refunds.retry', () => refundApi.retry(S, ID)],
  ['refunds.confirmCash', () => refundApi.confirmCash(S, ID, 'Paid at counter')],
  ['substitutions.propose', () => substitutionApi.propose(S, ID, { orderItemId: ID2, variantId: ID2, quantity: 1 })],
  ['substitutions.withdraw', () => substitutionApi.withdraw(S, ID)],
  ['inbox.list', () => inboxApi.list(S)],
  ['inbox.read', () => inboxApi.read(S, ID)],
  ['inbox.readAll', () => inboxApi.readAll(S)],
  ['verification.get', () => verificationApi.get(S)],
  ['verification.save', () => verificationApi.save(S, { legalName: 'A' })],
  ['verification.upload', () => verificationApi.upload(S, 'shop_photo', new File(['x'], 'shop.jpg', { type: 'image/jpeg' }))],
  ['verification.remove', () => verificationApi.remove(S, ID)],
  ['verification.link', () => verificationApi.link(S, ID)],
  ['verification.submit', () => verificationApi.submit(S)],
  ['khata.list', () => khataApi.list(S)],
  ['khata.open', () => khataApi.open(S, { phone: '9876543210' })],
  ['khata.get', () => khataApi.get(S, ID)],
  ['khata.update', () => khataApi.update(S, ID, { notes: 'x' })],
  ['khata.entry', () => khataApi.entry(S, ID, { type: 'credit', amountPaise: 100 }, 'key-1')],
  ['khata.reverse', () => khataApi.reverse(S, ID, ID2, 'wrong amount')],
  ['khata.remind', () => khataApi.remind(S, ID)],
  ['khata.settings', () => khataApi.settings(S, { khataEnabled: true })],
  ['khata.autoReminders', () => khataApi.autoReminders(S, true)],
  ['catalogue.templates', () => catalogueOpsApi.templates()],
  ['catalogue.template', () => catalogueOpsApi.template('grocery')],
  ['catalogue.applyTemplate', () => catalogueOpsApi.applyTemplate(S, { industry: 'grocery' })],
  ['catalogue.defaults', () => catalogueOpsApi.defaults(S)],
  ['catalogue.saveDefaults', () => catalogueOpsApi.saveDefaults(S, { taxPercent: 5 })],
  ['catalogue.reorderCategories', () => catalogueOpsApi.reorderCategories(S, [ID, ID2])],
  ['catalogue.deleteCategory', () => catalogueOpsApi.deleteCategory(S, ID, { uncategorise: true })],
  ['catalogue.duplicate', () => catalogueOpsApi.duplicate(S, ID)],
  ['catalogue.lookup', () => catalogueOpsApi.lookup(S, { barcode: '890' })],
  ['catalogue.exportCsv', () => catalogueOpsApi.exportCsv(S)],
  ['catalogue.previewImport', () => catalogueOpsApi.previewImport(S, 'product_name,price\nRice,10\n')],
  ['catalogue.commitImport', () => catalogueOpsApi.commitImport(S, 'product_name,price\nRice,10\n')],
  ['catalogue.bulk', () => catalogueOpsApi.bulk(S, { action: 'deactivate', productIds: [ID], preview: true })],
  ['purchases.suppliers', () => purchaseApi.suppliers(S)],
  ['purchases.createSupplier', () => purchaseApi.createSupplier(S, { name: 'Agro' })],
  ['purchases.updateSupplier', () => purchaseApi.updateSupplier(S, ID, { phone: '1' })],
  ['purchases.list', () => purchaseApi.list(S)],
  ['purchases.get', () => purchaseApi.get(S, ID)],
  ['purchases.create', () => purchaseApi.create(S, { items: [] })],
  ['purchases.update', () => purchaseApi.update(S, ID, { items: [] })],
  ['purchases.confirm', () => purchaseApi.confirm(S, ID)],
  ['purchases.cancel', () => purchaseApi.cancel(S, ID)],
  ['purchases.batches', () => purchaseApi.batches(S, { state: 'expiring' })],
  ['crm.list', () => crmApi.list(S, { segment: 'loyal' })],
  ['crm.get', () => crmApi.get(S, ID)],
  ['crm.saveNotes', () => crmApi.saveNotes(S, ID, { notes: 'x' })],
  ['crm.points', () => crmApi.points(S, ID)],
  ['crm.adjustPoints', () => crmApi.adjustPoints(S, ID, { points: 10, reason: 'goodwill' })],
  ['loyalty.program', () => loyaltyApi.program(S)],
  ['loyalty.saveProgram', () => loyaltyApi.saveProgram(S, { isActive: true })],
  ['loyalty.rewards', () => loyaltyApi.rewards(S)],
  ['loyalty.createReward', () => loyaltyApi.createReward(S, { name: 'x' })],
  ['loyalty.updateReward', () => loyaltyApi.updateReward(S, ID, { isActive: false })],
  ['loyalty.members', () => loyaltyApi.members(S)],
  ['coupons.list', () => couponApi.list(S)],
  ['coupons.create', () => couponApi.create(S, { code: 'X' })],
  ['coupons.update', () => couponApi.update(S, ID, { isActive: false })],
  ['offers.list', () => offerApi.list(S, 'live')],
  ['offers.create', () => offerApi.create(S, { title: 'x' })],
  ['offers.end', () => offerApi.end(S, ID)],
  ['messaging.list', () => messagingApi.list(S, { status: 'escalated' })],
  ['messaging.get', () => messagingApi.get(S, ID)],
  ['messaging.reply', () => messagingApi.reply(S, ID, 'Yes, in stock', true)],
  ['messaging.announcements', () => messagingApi.announcements(S)],
  ['messaging.announce', () => messagingApi.announce(S, { title: 'Mangoes in' })],
  ['automation.analytics', () => automationApi.analytics(S, { from: '2026-10-01', to: '2026-10-10' })],
  ['automation.lowStock', () => automationApi.lowStock(S)],
  ['automation.suggestions', () => automationApi.suggestions(S, { coverDays: 14 })],
  ['automation.draftFromSuggestions', () => automationApi.draftFromSuggestions(S, { items: [] })],
  ['automation.tasks', () => automationApi.tasks(S)],
  ['automation.createTask', () => automationApi.createTask(S, { title: 'x' })],
  ['automation.updateTask', () => automationApi.updateTask(S, ID, { isActive: false })],
  ['automation.deleteTask', () => automationApi.deleteTask(S, ID)],
];

describe('merchant operations client ↔ backend docs/API.md', () => {
  it('found the backend API reference', () => {
    expect(DOCUMENTED.length).toBeGreaterThan(100);
    // And the matcher can say no.
    expect(isDocumented('GET', `/merchant/stores/${S}/no-such-thing`)).toBe(false);
    expect(isDocumented('DELETE', `/merchant/stores/${S}/refunds/${ID}`)).toBe(false);
  });

  it.each(CALLS)('%s calls a documented route', async (_name, call) => {
    await call();
    expect(sent).toHaveLength(1);
    const { method, url } = sent[0];
    expect(isDocumented(method, url), `${method} ${url} is not in backend/docs/API.md`).toBe(true);
    expect(sent[0].headers.Authorization).toBe('Bearer token-1');
  });

  it('covers every function the module exports', () => {
    const modules = { refundApi, substitutionApi, inboxApi, verificationApi, khataApi, catalogueOpsApi, purchaseApi, crmApi, loyaltyApi, couponApi, offerApi, messagingApi, automationApi };
    const total = Object.values(modules).reduce((n, m) => n + Object.keys(m).length, 0);
    expect(CALLS).toHaveLength(total);
  });
});

describe('reviewer console client ↔ backend docs/API.md', () => {
  const ADMIN_CALLS: [string, () => Promise<unknown>][] = [
    ['admin.login', () => adminApi.login('r@cpse.test', 'x')],
    ['admin.me', () => adminApi.me()],
    ['admin.logout', () => adminApi.logout()],
    ['admin.queue', () => adminApi.queue({ status: 'pending' })],
    ['admin.review', () => adminApi.review(S)],
    ['admin.documentUrl', () => adminApi.documentUrl(S, ID)],
    ['admin.approve', () => adminApi.approve(S)],
    ['admin.reject', () => adminApi.reject(S, 'Blurry photo')],
    ['admin.escalated', () => adminApi.escalated()],
    ['admin.conversation', () => adminApi.conversation(ID)],
    ['admin.reply', () => adminApi.reply(ID, 'On it')],
  ];

  it.each(ADMIN_CALLS)('%s calls a documented route with the reviewer token', async (_name, call) => {
    writeAdminSession({ accessToken: 'admin-token', refreshToken: 'admin-refresh' });
    await call();
    const { method, url, headers } = sent[0];
    expect(isDocumented(method, url), `${method} ${url} is not in backend/docs/API.md`).toBe(true);
    expect(headers.Authorization).toBe('Bearer admin-token');
  });

  it('covers every reviewer call', () => {
    expect(ADMIN_CALLS).toHaveLength(Object.keys(adminApi).length);
  });
});

describe('request details the backend relies on', () => {
  it('khata entries carry the idempotency key', async () => {
    await khataApi.entry(S, ID, { type: 'credit', amountPaise: 5000, paymentMethod: 'cash' }, 'key-42');
    expect(sent[0].headers['Idempotency-Key']).toBe('key-42');
    expect(JSON.parse(sent[0].data)).toEqual({ type: 'credit', amountPaise: 5000, paymentMethod: 'cash' });
  });

  it('CSV import sends raw text with the mode as a query parameter', async () => {
    await catalogueOpsApi.previewImport(S, 'product_name,price\nRice,10\n');
    expect(sent[0].headers['Content-Type']).toBe('text/csv');
    expect(sent[0].params).toEqual({ mode: 'preview' });
    expect(sent[0].data).toBe('product_name,price\nRice,10\n');
    await catalogueOpsApi.commitImport(S, 'x');
    expect(sent[1].params).toEqual({ mode: 'commit' });
  });

  it('CSV export returns the file text, not an envelope', async () => {
    await expect(catalogueOpsApi.exportCsv(S)).resolves.toBe('a,b\n1,2\n');
  });

  it('a reply can resolve the conversation in the same call', async () => {
    await messagingApi.reply(S, ID, 'Done', true);
    expect(JSON.parse(sent[0].data)).toEqual({ body: 'Done', resolve: true });
  });

  it('stock-in can record batch details and stock-out can pick a batch', async () => {
    await inventoryApi.stockIn(S, { variantId: ID, quantity: 5, batchNumber: 'B1', expiresOn: '2026-12-31' });
    await inventoryApi.stockOut(S, { variantId: ID, quantity: 1, reason: 'expired', batchId: ID2 });
    for (const request of sent) expect(isDocumented(request.method, request.url)).toBe(true);
    expect(JSON.parse(sent[0].data)).toMatchObject({ quantity: 5, batchNumber: 'B1', expiresOn: '2026-12-31' });
    expect(JSON.parse(sent[1].data)).toMatchObject({ batchId: ID2 });
  });
});
