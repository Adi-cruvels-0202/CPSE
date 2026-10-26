import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { Route, Routes } from 'react-router-dom';
import { cleanup, click, byLabel, byText, fakeServer, render, text, type, waitFor } from './helpers/render';
import AdminApp from '../src/admin/AdminApp';
import { writeAdminSession } from '../src/admin/adminApi';
import CategoriesPage from '../src/features/categories/CategoriesPage';
import KhataPage from '../src/features/tools/KhataPage';
import StoreSetupPage from '../src/features/store/StoreSetupPage';

/**
 * Getting a new shop live and running the platform: publishing through
 * verification, starter categories, the khata guide, and the admin portal's
 * roles, stores, accounts and admins.
 */

const S = '11111111-1111-4111-8111-111111111111';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

vi.mock('../src/hooks/useStore', () => ({ useActiveStore: () => ({ activeStoreId: S, setActiveStoreId: () => undefined }) }));
vi.mock('../src/hooks/useAuth', () => ({ useAuth: () => ({ refresh: async () => undefined, stores: [], status: 'merchant' }) }));

const base = (path: string) => new RegExp(`^/merchant/stores/${S}${path}$`);
const META = (total: number) => ({ page: 1, limit: 20, total, totalPages: 1, hasNextPage: false });

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

// ── Publishing ──────────────────────────────────────────────────────────────

const store = (over: Record<string, unknown> = {}) => ({
  id: S, slug: 'kirana', name: 'Kirana', description: null, shopCategory: 'grocery', phone: '+919876500000', email: null,
  address: { line1: '12 Mall Road', line2: null, city: 'Ludhiana', state: 'Punjab', postalCode: '141001', country: 'IN' },
  latitude: null, longitude: null, logoUrl: null, coverImageUrl: null, timezone: 'Asia/Kolkata',
  openingHours: { mon: [{ open: '09:00', close: '21:00' }] }, hours: { isOpen: true, opensAt: null },
  fulfilment: { pickupEnabled: true, deliveryEnabled: false, deliveryFeePaise: 0, minOrderPaise: 0, freeDeliveryThresholdPaise: null, deliveryRadiusKm: null },
  paymentMethods: { cash: true, online: false }, isPublished: false, verificationStatus: 'not_submitted', publishRequestedAt: null,
  khata: { enabled: false, dueDays: 30, autoReminders: false }, publicPath: '/store/kirana', createdAt: '2026-10-20T00:00:00Z', updatedAt: '2026-10-20T00:00:00Z',
  ...over,
});
const setupPage = () => <Routes><Route path="/store/:tab" element={<StoreSetupPage />} /></Routes>;

describe('publishing a store that is not verified yet', () => {
  it('explains the next step and links to verification instead of a dead end', async () => {
    let current = store();
    fakeServer([
      ['GET', base(''), () => ({ data: { store: current } })],
      ['GET', base('/holidays'), () => ({ data: { holidays: [] } })],
      ['POST', base('/publish'), () => {
        current = store({ publishRequestedAt: '2026-10-21T10:00:00Z' });
        return { status: 422, error: { code: 'STORE_INCOMPLETE', message: 'Send your store for verification.', details: { missing: ['verification'], verificationStatus: 'not_submitted', publishWhenVerified: true } } };
      }],
    ]);
    await render(setupPage(), { path: '/store/setup' });
    await click(await waitFor(() => byText('button', '● Publish store')));
    await waitFor(() => text().includes('Send your store for verification.'));
    expect(text()).toContain('goes live automatically once approved');
    expect(text()).not.toContain('Before publishing, add verification');
    expect(document.querySelector('a[href="/verification"]')).not.toBeNull();
  });

  it('says there is nothing more to do while CPSE is checking, and keeps saying it', async () => {
    fakeServer([
      ['GET', base(''), () => ({ data: { store: store({ verificationStatus: 'pending', publishRequestedAt: '2026-10-21T10:00:00Z' }) } })],
      ['GET', base('/holidays'), () => ({ data: { holidays: [] } })],
      ['POST', base('/publish'), () => ({ status: 422, error: { code: 'STORE_INCOMPLETE', message: 'x', details: { missing: ['phone', 'verification'], verificationStatus: 'pending', publishWhenVerified: true } } })],
    ]);
    await render(setupPage(), { path: '/store/setup' });
    await waitFor(() => text().includes('Goes live automatically when CPSE approves it.'));
    await click(byText('button', '● Publish store'));
    await waitFor(() => text().includes('CPSE is checking your store.'));
    expect(text()).toContain('Add a phone number');
  });
});

// ── Starter categories and reordering ───────────────────────────────────────

const category = (id: string, name: string) => ({ id, name, description: null, productCount: 0, isActive: true, sortOrder: 0 });

describe('starter categories', () => {
  it('offers the usual categories for the kind of shop, and adds only the ticked ones', async () => {
    const sent = fakeServer([
      ['GET', base(''), () => ({ data: { store: store({ shopCategory: 'bakery' }) } })],
      ['GET', base('/categories'), () => ({ data: { categories: [] } })],
      ['GET', /^\/merchant\/templates$/, () => ({ data: { templates: [{ industry: 'bakery', label: 'Bakery & Sweets', categoryCount: 5, productCount: 7, defaults: {} }, { industry: 'grocery', label: 'Grocery / Kirana', categoryCount: 10, productCount: 12, defaults: {} }] } })],
      ['GET', /^\/merchant\/templates\/bakery$/, () => ({ data: { template: { industry: 'bakery', label: 'Bakery & Sweets', defaults: {}, categories: ['Cakes', 'Breads', 'Cookies', 'Snacks & Savouries', 'Sweets'], products: [] } } })],
      ['POST', base('/templates/apply'), (req) => ({ status: 201, data: { report: { categoriesCreated: req.body.categories, categoriesSkipped: [], productsCreated: [], productsSkipped: [], failed: [] } } })],
    ]);
    await render(<CategoriesPage />);
    await waitFor(() => text().includes('Start with the usual categories for a bakery shop'));
    expect(text()).toContain('Snacks & Savouries');
    await click(byLabel('Cookies'));
    await click(byText('button', 'Add 4 categories'));
    await waitFor(() => text().includes('4 categories added.'));
    expect(sent.find((r) => r.method === 'POST')!.body).toEqual({ industry: 'bakery', applyDefaults: false, categories: ['Cakes', 'Breads', 'Snacks & Savouries', 'Sweets'], products: [] });
  });

  it('lets an "other" shop pick which kind of shop to start from', async () => {
    fakeServer([
      ['GET', base(''), () => ({ data: { store: store({ shopCategory: 'other' }) } })],
      ['GET', base('/categories'), () => ({ data: { categories: [] } })],
      ['GET', /^\/merchant\/templates$/, () => ({ data: { templates: [{ industry: 'grocery', label: 'Grocery / Kirana', categoryCount: 2, productCount: 0, defaults: {} }] } })],
      ['GET', /^\/merchant\/templates\/grocery$/, () => ({ data: { template: { industry: 'grocery', label: 'Grocery / Kirana', defaults: {}, categories: ['Rice & Grains', 'Fruits & Vegetables'], products: [] } } })],
    ]);
    await render(<CategoriesPage />);
    await waitFor(() => text().includes('Start with the usual categories for your kind of shop'));
    expect((byText('button', /Add 0 categories/) as HTMLButtonElement).disabled).toBe(true);
    await type(byLabel('Kind of shop') as HTMLSelectElement, 'grocery');
    await waitFor(() => text().includes('Fruits & Vegetables'));
  });

  it('reorders categories by dragging a row onto another', async () => {
    const order = [category(A, 'Cakes'), category(B, 'Breads'), category(C, 'Sweets')];
    const sent = fakeServer([
      ['GET', base(''), () => ({ data: { store: store({ shopCategory: 'other' }) } })],
      ['GET', base('/categories'), () => ({ data: { categories: order } })],
      ['GET', /^\/merchant\/templates$/, () => ({ data: { templates: [] } })],
      ['PUT', base('/categories/order'), () => ({ data: { ok: true } })],
    ]);
    await render(<CategoriesPage />);
    await waitFor(() => text().includes('Sweets'));
    const rows = () => [...document.querySelectorAll('tbody tr')] as HTMLElement[];
    const drag = async (el: HTMLElement, name: string) => {
      const event = new Event(name, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'dataTransfer', { value: { setData: () => undefined, effectAllowed: '' } });
      await act(async () => { el.dispatchEvent(event); });
    };
    await drag(rows()[2], 'dragstart');
    await drag(rows()[0], 'dragover');
    await drag(rows()[0], 'drop');
    expect(sent.find((r) => r.method === 'PUT')!.body).toEqual({ categoryIds: [C, A, B] });
  });
});

// ── Khata ───────────────────────────────────────────────────────────────────

const account = { id: A, balancePaise: 45000, creditLimitPaise: null, availableCreditPaise: null, isActive: true, customer: { id: B, name: 'Ravi', phone: '98xxxxxx01', email: null }, notes: null, remindersEnabled: true, ageing: { outstandingPaise: 45000, overduePaise: 0, advancePaise: 0, earliestDueDate: null } };

describe('khata', () => {
  it('explains how the khata works before the first account', async () => {
    fakeServer([['GET', base('/khata'), () => ({ data: { accounts: [], summary: { accountCount: 0, outstandingPaise: 0, overduePaise: 0 } } })]]);
    await render(<KhataPage />);
    await waitFor(() => text().includes('How the khata works'));
    expect(text()).toContain('Record credit given');
    expect(text()).toContain('Clear balance');
  });

  it('says nobody owes money, and shows every account on request', async () => {
    fakeServer([['GET', base('/khata'), (req) => ({ data: {
      accounts: req.params?.status === 'all' ? [{ ...account, balancePaise: 0, ageing: { ...account.ageing, outstandingPaise: 0 } }] : [],
      summary: { accountCount: 1, outstandingPaise: 0, overduePaise: 0 },
    } })]]);
    await render(<KhataPage />);
    await waitFor(() => text().includes('Nobody owes you money right now'));
    await click(byText('button', 'Show all accounts'));
    await waitFor(() => text().includes('Ravi'));
  });

  it('clears a balance in one step by filling in the full payment', async () => {
    const sent = fakeServer([
      ['GET', base('/khata'), () => ({ data: { accounts: [account], summary: { accountCount: 1, outstandingPaise: 45000, overduePaise: 0 } } })],
      ['GET', base(`/khata/${A}`), () => ({ data: { account, totals: { debitPaise: 45000, creditPaise: 0, balancePaise: 45000 }, transactions: [], reminders: [] } })],
      ['POST', base(`/khata/${A}/entries`), () => ({ status: 201, data: { transaction: { id: C } } })],
    ]);
    await render(<KhataPage />);
    await waitFor(() => text().includes('Ravi'));
    await click(byText('button', 'Open'));
    await waitFor(() => text().includes('They owe you'));
    await click(await waitFor(() => byText('button', 'Clear balance (₹450.00)')));
    expect((byLabel('Amount (₹)') as HTMLInputElement).value).toBe('450.00');
    await click(byText('button', 'Record'));
    expect(sent.find((r) => r.method === 'POST')!.body).toEqual({ kind: 'payment', amountPaise: 45000, description: 'Balance cleared', paymentMethod: 'cash' });
  });
});

// ── Admin portal ────────────────────────────────────────────────────────────

const me = () => ({ id: 'me', email: 'admin@cpse.test', fullName: null });
const overview = () => ({
  you: { id: 'me', email: 'admin@cpse.test' }, stores: { total: 2, published: 1, waitingForReview: 1, sentBack: 0, waitingToPublish: 1 },
  accounts: { total: 5, merchants: 2, customers: 3, suspended: 0 }, support: { escalated: 0 },
  recentActions: [{ id: 'x1', at: '2026-10-21T09:00:00Z', admin: { id: 'me', email: 'admin@cpse.test' }, action: 'store_approved', target: { type: 'store', id: S, label: 'Kirana' }, reason: null, details: { published: true } }],
});
const adminApp = () => <Routes><Route path="/admin/*" element={<AdminApp />} /></Routes>;
const portal = (extra: any[] = []) => fakeServer([
  ['GET', /^\/admin\/me$/, () => ({ data: { admin: me() } })],
  ['GET', /^\/admin\/overview$/, () => ({ data: { overview: overview() } })],
  ...extra,
]);

describe('admin portal', () => {
  beforeEach(() => writeAdminSession({ accessToken: 'admin-token', refreshToken: 'admin-refresh' }));

  it('shows every section in one sidebar, with no roles', async () => {
    portal();
    await render(adminApp(), { path: '/admin' });
    await waitFor(() => text().includes('Needs attention'));
    const nav = document.querySelector('nav[aria-label="Admin"]')!.textContent!;
    for (const page of ['Overview', 'Store verification', 'Stores', 'Accounts', 'Escalated support', 'Activity log']) expect(nav).toContain(page);
    expect(nav).not.toContain('Admins');
    expect(text()).not.toMatch(/superadmin|reviewer/i);
    expect(text()).toContain('Approved store · Kirana');
  });

  it('asks for a reason before suspending, and cannot suspend an admin', async () => {
    const detail = (over: Record<string, unknown> = {}) => ({
      account: { id: A, email: 'asha@test', name: 'Asha', phone: null, createdAt: '2026-10-01T00:00:00Z', type: 'customer', isSuspended: false, suspendedAt: null, suspendedReason: null, storeCount: 0, orderCount: 4, ...over },
      adminRole: null, stores: [], actions: [],
    });
    const sent = portal([
      ['GET', /^\/admin\/accounts$/, () => ({ data: { accounts: [detail().account, { ...detail().account, id: B, email: 'rev@cpse.test', name: 'Rev', type: 'admin' }] }, meta: META(2) })],
      ['GET', new RegExp(`^/admin/accounts/${A}$`), () => ({ data: detail() })],
      ['GET', new RegExp(`^/admin/accounts/${B}$`), () => ({ data: { ...detail({ id: B, type: 'admin', email: 'rev@cpse.test' }), adminRole: 'reviewer' } })],
      ['POST', new RegExp(`^/admin/accounts/${A}/suspend$`), (req) => ({ data: detail({ isSuspended: true, suspendedReason: req.body.reason, suspendedAt: '2026-10-21T10:00:00Z' }) })],
    ]);
    await render(adminApp(), { path: '/admin/accounts' });
    await waitFor(() => text().includes('asha@test'));
    await click(document.querySelectorAll('tbody button')[0]);
    const suspend = await waitFor(() => byText('button', 'Suspend account') as HTMLButtonElement);
    expect(suspend.disabled).toBe(true);
    await type(byLabel(/^Suspend/), 'Repeated fake orders');
    await click(suspend);
    await waitFor(() => text().includes('is suspended and signed out everywhere'));
    expect(sent.find((r) => r.url.endsWith('/suspend'))!.body).toEqual({ reason: 'Repeated fake orders' });
    expect(text()).toContain('Suspended');
    await click(byText('button', 'Close'));

    await click(document.querySelectorAll('tbody button')[1]);
    await waitFor(() => text().includes('Admin accounts cannot be suspended'));
    expect(() => byText('button', 'Suspend account')).toThrow();
  });

  it('takes a store off CPSE with a reason', async () => {
    const storeRow = { id: S, name: 'Kirana', slug: 'kirana', city: 'Ludhiana', shopCategory: 'grocery', isPublished: true, verificationStatus: 'verified', verificationLabel: 'Verified', publishRequestedAt: null, createdAt: '2026-10-01T00:00:00Z', owner: { id: A, email: 'owner@shop.test', name: 'R', phone: null, isSuspended: false } };
    const detail = (isPublished: boolean) => ({ store: { ...storeRow, isPublished, phone: null, email: null, address: '12 Mall Road', missingForPublish: [] }, counts: { products: 4, orders: 9, ordersLast30Days: 2 }, actions: [] });
    const sent = portal([
      ['GET', /^\/admin\/stores$/, () => ({ data: { stores: [storeRow] }, meta: META(1) })],
      ['GET', new RegExp(`^/admin/stores/${S}$`), () => ({ data: detail(true) })],
      ['POST', new RegExp(`^/admin/stores/${S}/unpublish$`), () => ({ data: detail(false) })],
    ]);
    await render(adminApp(), { path: '/admin/stores' });
    await click(await waitFor(() => byText('button', 'Open')));
    await waitFor(() => text().includes('9 (2 in the last 30 days)'));
    await type(byLabel(/^Take this store off CPSE/), 'Selling banned items.');
    await click(byText('button', 'Take off CPSE'));
    await waitFor(() => text().includes('was taken off CPSE'));
    expect(sent.find((r) => r.url.endsWith('/unpublish'))!.body).toEqual({ reason: 'Selling banned items.' });
  });

  it('approving says it will also publish when the owner already asked to', async () => {
    const review = {
      store: { id: S, name: 'Kirana', slug: 'kirana', phone: null, email: null, address: '', isPublished: false, publishRequestedAt: '2026-10-21T08:00:00Z' },
      verification: { status: 'pending', statusLabel: 'Waiting for review', isEditable: false, details: { legalName: 'K', businessType: 'proprietorship', gstApplicable: false, gstin: null, ownerName: 'R', ownerPhone: null, ownerEmail: null, businessAddress: null }, documents: [], requiredDocuments: [], missing: [], rejectionReason: null, reviewNote: null, events: [] },
    };
    const sent = portal([
      ['GET', /^\/admin\/verifications$/, () => ({ data: { stores: [{ storeId: S, name: 'Kirana', slug: 'kirana', city: null, legalName: 'K', status: 'pending', statusLabel: 'Waiting for review', isPublished: false, submittedAt: null }] }, meta: META(1) })],
      ['GET', new RegExp(`^/admin/verifications/${S}$`), () => ({ data: review })],
      ['POST', new RegExp(`^/admin/verifications/${S}/approve$`), () => ({ data: { ...review, verification: { ...review.verification, status: 'verified' }, published: true } })],
    ]);
    await render(adminApp(), { path: '/admin/verifications' });
    await click(await waitFor(() => byText('button', 'Review')));
    await waitFor(() => text().includes('Approving puts the store live straight away.'));
    await click(byText('button', 'Approve and publish'));
    await waitFor(() => text().includes('is verified and now live'));
    expect(sent.some((r) => r.url.endsWith('/approve'))).toBe(true);
  });
});
