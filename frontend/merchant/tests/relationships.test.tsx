import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, click, byLabel, byText, fakeServer, render, submit, text, type, waitFor } from './helpers/render';
import CustomersPage from '../src/features/tools/CustomersPage';
import AnalyticsPage from '../src/features/tools/AnalyticsPage';
import PromotionsPage, { OfferForm } from '../src/features/tools/PromotionsPage';
import AnnouncementsPage from '../src/features/tools/AnnouncementsPage';
import CatalogueToolsPage from '../src/features/tools/CatalogueToolsPage';
import type { Batch } from '../src/api/ops';

/**
 * Customer relationships, reports and promotions screens (roadmap §4 P3/P4):
 * what they load, what they send, and that refusals reach the shopkeeper.
 */

const S = '11111111-1111-4111-8111-111111111111';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const V = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

vi.mock('../src/hooks/useStore', () => ({ useActiveStore: () => ({ activeStoreId: S, setActiveStoreId: () => undefined }) }));

const base = (path: string) => new RegExp(`^/merchant/stores/${S}${path}$`);
const META = { page: 1, limit: 20, total: 1, totalPages: 1, hasNextPage: false };

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

const crmCustomer = {
  customerId: A, name: 'Asha Rao', phone: '98xxxxxx10', segment: 'loyal', segmentLabel: 'Loyal', orderCount: 6, totalSpendPaise: 450000,
  averageOrderPaise: 75000, firstOrderAt: '2026-05-01T10:00:00Z', lastOrderAt: '2026-10-08T10:00:00Z', medianDaysBetweenOrders: 12, openOrders: 0,
  isFollower: true, consent: { promotions: true, reminders: false, sms: false, whatsapp: false, email: false }, khataBalancePaise: 12000, loyaltyPoints: 40, tags: ['regular'],
};

describe('customers', () => {
  it('filters by group, opens a customer, saves notes and adjusts points', async () => {
    let points = 40;
    const sent = fakeServer([
      ['GET', base('/customers'), () => ({ data: { customers: [crmCustomer], segments: { prospect: 0, new: 1, active: 2, loyal: 1, inactive: 0 }, rules: {} }, meta: META })],
      ['GET', base(`/customers/${A}`), () => ({ data: { customer: { ...crmCustomer, loyaltyPoints: points, notes: null, favouriteProducts: { repeatPurchases: [{ productId: B, name: 'Milk', orderCount: 5, units: 9 }], saved: [] }, khata: { accountId: B, balancePaise: 12000, creditLimitPaise: 50000 }, purchaseHistory: [{ id: B, orderNumber: 'ORD-9', status: 'completed', statusLabel: 'Completed', totalPaise: 75000, placedAt: '2026-10-08T10:00:00Z', completedAt: null }] } } })],
      ['PATCH', base(`/customers/${A}`), (req) => ({ data: { customer: { ...crmCustomer, notes: req.body.notes, tags: req.body.tags, favouriteProducts: { repeatPurchases: [], saved: [] }, khata: null, purchaseHistory: [] } } })],
      ['GET', base(`/customers/${A}/points`), () => ({ data: { history: [{ id: 'l1', kind: 'earn', label: 'Earned on order ORD-9', points: 15, pointsAfter: 40, note: null, at: '2026-10-08T10:00:00Z' }] } })],
      ['POST', base(`/customers/${A}/points`), (req) => {
        if (points + req.body.points < 0) return { status: 422, error: { code: 'POINTS_NEGATIVE', message: 'That would take the balance below zero.' } };
        points += req.body.points;
        return { data: { balance: points, history: [] } };
      }],
    ]);
    await render(<CustomersPage />);
    await waitFor(() => text().includes('Asha Rao'));
    expect(text()).toContain('₹4,500.00');
    await type(byLabel('Group'), 'loyal');
    await waitFor(() => sent.some((r) => r.params?.segment === 'loyal'));

    await click(await waitFor(() => byText('button', 'Asha Rao')));
    await waitFor(() => text().includes('Buys again and again'));
    expect(text()).toContain('every 12 days');
    expect(text()).toContain('Milk (5×)');
    expect(text()).toContain('₹120.00 owed · limit ₹500.00');
    expect(text()).toContain('Earned on order ORD-9: +15 (now 40)');

    await type(byLabel(/Private notes/), 'Prefers evening delivery');
    await type(byLabel(/Tags/), 'regular, evening');
    await click(byText('button', 'Save notes'));
    expect(sent.find((r) => r.method === 'PATCH')!.body).toEqual({ notes: 'Prefers evening delivery', tags: ['regular', 'evening'] });

    await type(byLabel(/Add \(or remove/), '-100');
    await type(byLabel('Reason'), 'Correction');
    await click(byText('button', 'Apply'));
    await waitFor(() => text().includes('That would take the balance below zero.'));
    await type(byLabel(/Add \(or remove/), '10');
    await click(byText('button', 'Apply'));
    expect(sent.filter((r) => r.method === 'POST').map((r) => r.body)).toEqual([{ points: -100, reason: 'Correction' }, { points: 10, reason: 'Correction' }]);
    await waitFor(() => text().includes('Points updated'));
  });
});

describe('reports', () => {
  it('asks for the chosen period and shows totals with their definitions', async () => {
    const analytics = {
      period: { from: '2026-10-01', to: '2026-10-07', days: 7, timezone: 'Asia/Kolkata' },
      sales: { grossSalesPaise: 1234500, ordersRevenuePaise: 1000000, counterSalesPaise: 234500, completedOrders: 12, counterSales: 4, averageTicketPaise: 77156, refundsPaise: 5000,
        trend: [{ date: '2026-10-01', ordersPaise: 500000, posPaise: 0, orders: 5, sales: 0, refundsPaise: 0 }, { date: '2026-10-02', ordersPaise: 500000, posPaise: 234500, orders: 7, sales: 4, refundsPaise: 5000 }] },
      orders: { placed: 15, byStatus: {}, cancellationRate: 0.2, medianMinutesToAccept: 4, byFulfilment: { pickup: 9, delivery: 3 } },
      products: { bestSellers: [{ productId: A, name: 'Basmati Rice', units: 20, revenuePaise: 240000 }], slowMovers: [], unavailable: [{ productId: B, name: 'Ghee', reason: 'Sold out', unitsSoldInPeriod: 4 }] },
      customers: { segments: { loyal: 3 }, buyersInPeriod: 10, newInPeriod: 4, returningInPeriod: 6 },
      khata: { outstandingPaise: 80000, overduePaise: 20000, collectedPaise: 10000, chargedPaise: 30000, accountsOverdue: 2 },
      definitions: { sales: 'Completed online orders plus counter sales.' },
    };
    const sent = fakeServer([['GET', base('/analytics'), () => ({ data: { analytics } })]]);
    await render(<AnalyticsPage />);
    await waitFor(() => text().includes('₹12,345.00'));
    expect(sent[0].params.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(text()).toContain('20%');
    expect(text()).toContain('4 min');
    expect(text()).toContain('Basmati Rice');
    expect(text()).toContain('Ghee');
    expect(text()).toContain('₹800.00'); // khata outstanding
    expect(text()).toContain('₹200.00 overdue · 2 accounts');
    expect(text()).toContain('Completed online orders plus counter sales.');
    expect(document.querySelectorAll('.bar-chart__bar')).toHaveLength(2);
    await click(byText('button', 'Last 7 days'));
    await waitFor(() => sent.length === 2);
    const days = (Date.parse(sent[1].params.to) - Date.parse(sent[1].params.from)) / 86_400_000;
    expect(days).toBe(6);
  });

  it('shows an error with a retry when the report fails', async () => {
    fakeServer([['GET', base('/analytics'), () => ({ status: 422, error: { code: 'VALIDATION_ERROR', message: 'The period can be at most 366 days.' } })]]);
    await render(<AnalyticsPage />);
    await waitFor(() => text().includes('The period can be at most 366 days.'));
  });
});

describe('loyalty', () => {
  it('starts a programme from sensible defaults and saves it', async () => {
    const sent = fakeServer([
      ['GET', base('/loyalty'), () => ({ data: { program: null } })],
      ['PUT', base('/loyalty'), (req) => ({ data: { program: { ...req.body, summary: '1 point per ₹100.' } } })],
      ['GET', base('/loyalty/rewards'), () => ({ data: { rewards: [] } })],
      ['GET', base('/loyalty/members'), () => ({ data: { members: [] }, meta: META })],
    ]);
    await render(<PromotionsPage />);
    await waitFor(() => text().includes('Loyalty programme is running'));
    await click(byLabel(/Loyalty programme is running/));
    await type(byLabel('Points per ₹100 spent'), '2');
    await click(byText('button', 'Save programme'));
    expect(sent.find((r) => r.method === 'PUT')!.body).toEqual({
      isActive: true, earnPointsPer100: 2, pointValuePaise: 100, minRedeemPoints: 0, maxRedeemPercent: 50, welcomeBonusPoints: 0, minOrderPaiseToEarn: 0, pointsExpireDays: null,
    });
    await waitFor(() => text().includes('Loyalty programme saved'));
  });
});

describe('rewards and offers', () => {
  it('creates a reward that is redeemed as a coupon', async () => {
    const rewards: any[] = [];
    const sent = fakeServer([
      ['GET', base('/loyalty'), () => ({ data: { program: { isActive: true, earnPointsPer100: 1, pointValuePaise: 100, minOrderPaiseToEarn: 0, minRedeemPoints: 0, maxRedeemPercent: 50, welcomeBonusPoints: 0, pointsExpireDays: null, summary: '1 point per ₹100.' } } })],
      ['GET', base('/loyalty/rewards'), () => ({ data: { rewards } })],
      ['POST', base('/loyalty/rewards'), (req) => { rewards.push({ id: A, description: null, isActive: true, percentOff: null, ...req.body }); return { status: 201, data: { reward: rewards[0] } }; }],
      ['GET', base('/loyalty/members'), () => ({ data: { members: [{ customerId: B, name: 'Asha', points: 120, lifetimeEarned: 150, lifetimeRedeemed: 30 }] }, meta: META })],
    ]);
    await render(<PromotionsPage />);
    await waitFor(() => text().includes('Asha'));
    await click(byText('button', 'Add reward'));
    await type(byLabel('Name'), '₹50 off');
    await type(byLabel('Points needed'), '50');
    await type(byLabel('Amount (₹)'), '50');
    await submit(document.getElementById('reward-form') as HTMLFormElement);
    expect(sent.find((r) => r.method === 'POST')!.body).toEqual({ name: '₹50 off', pointsCost: 50, discountType: 'flat', amountOffPaise: 5000 });
    await waitFor(() => text().includes('₹50 off — 50 points'));
  });

  it('lists live offers with why they end, and ends one early', async () => {
    const offer = { id: A, kind: 'promotion', title: 'Mango week', description: null, productId: B, productName: 'Alphonso', variantId: V, variantName: '1 dozen', listPricePaise: 60000, offerPricePaise: 50000, savingPaise: 10000, startsAt: '2026-10-10T00:00:00Z', endsAt: '2026-10-17T18:29:59Z', quantityLimit: 20, quantitySold: 5, unitsLeft: 15, batchExpiresOn: null, expiryCutoffDays: 0, radiusKm: 3, isLive: true, status: 'live', endReason: null, endReasonLabel: null };
    let ended = false;
    const sent = fakeServer([
      ['GET', base('/loyalty'), () => ({ data: { program: null } })],
      ['GET', base('/loyalty/rewards'), () => ({ data: { rewards: [] } })],
      ['GET', base('/loyalty/members'), () => ({ data: { members: [] }, meta: META })],
      ['GET', base('/offers'), () => ({ data: { offers: ended ? [] : [offer] } })],
      ['POST', base(`/offers/${A}/end`), () => { ended = true; return { data: { offer: { ...offer, status: 'ended', endReason: 'merchant', endReasonLabel: 'Ended by you' } } }; }],
    ]);
    await render(<PromotionsPage />);
    await click(byText('button', 'Local offers'));
    await waitFor(() => text().includes('Mango week'));
    expect(sent.find((r) => r.url.endsWith('/offers'))!.params).toEqual({ status: 'live' });
    expect(text()).toContain('Alphonso (1 dozen) · 3 km');
    expect(text()).toContain('5 / 20');
    await click(byText('button', 'End now'));
    expect(sent.some((r) => r.url.endsWith('/end'))).toBe(true);
    await waitFor(() => text().includes('Offer ended'));
  });
});

describe('clearance offer from a batch', () => {
  const batch: Batch = {
    id: B, productId: A, productName: 'Bread', variantId: V, variantName: null, sku: 'BREAD', batchNumber: 'B-7', manufacturedOn: null,
    expiresOn: '2026-10-14', daysToExpiry: 3, expiryState: 'expiring', quantityReceived: 20, quantityRemaining: 8, unitCostPaise: 2500, receivedAt: '2026-10-10T08:00:00Z',
  };

  it('ties the offer to the batch, its stock and a safety cut-off', async () => {
    const sent = fakeServer([['POST', base('/offers'), () => ({ status: 201, data: { offer: { id: A } } })]]);
    const close = vi.fn();
    await render(<OfferForm storeId={S} batch={batch} onClose={close} />);
    expect(text()).toContain('Bread · batch B-7 · 8 left');
    await type(byLabel('Offer price ₹'), '25');
    await submit(document.getElementById('offer-form') as HTMLFormElement);
    const body = sent[0].body;
    expect(body).toMatchObject({ kind: 'expiry', variantId: V, batchId: B, expiryCutoffDays: 1, offerPricePaise: 2500, radiusKm: 5, quantityLimit: 8, title: 'Clearance: Bread' });
    expect(body.endsAt.slice(0, 10) <= '2026-10-15').toBe(true);
    await waitFor(() => close.mock.calls.length === 1);
  });

  it('keeps the form open and shows why when the server refuses', async () => {
    fakeServer([['POST', base('/offers'), () => ({ status: 422, error: { code: 'OFFER_PAST_CUTOFF', message: 'This batch is inside its safety cut-off.' } })]]);
    const close = vi.fn();
    await render(<OfferForm storeId={S} batch={batch} onClose={close} />);
    await type(byLabel('Offer price ₹'), '25');
    await submit(document.getElementById('offer-form') as HTMLFormElement);
    await waitFor(() => text().includes('inside its safety cut-off'));
    expect(close).not.toHaveBeenCalled();
  });
});

describe('announcements', () => {
  it('says who will receive it and sends only after confirmation', async () => {
    const sent = fakeServer([
      ['GET', base('/announcements'), () => ({ data: { announcements: [], audience: { followers: 12, optedIn: 7 } } })],
      ['POST', base('/announcements'), () => ({ status: 201, data: { announcement: { id: A } } })],
    ]);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    await render(<AnnouncementsPage />);
    await waitFor(() => text().includes('7 agreed to hear about offers'));
    await type(byLabel('Headline'), 'Fresh mangoes are in');
    await submit(document.querySelector('form')!);
    expect(sent.filter((r) => r.method === 'POST')).toHaveLength(0);
    await submit(document.querySelector('form')!);
    expect(confirm).toHaveBeenLastCalledWith('Send to 7 customers?');
    expect(sent.find((r) => r.method === 'POST')!.body).toEqual({ title: 'Fresh mangoes are in' });
  });
});

describe('bulk change refusals', () => {
  it('lists products that cannot change and blocks Apply when none can', async () => {
    const product = { id: A, name: 'Ghee', isActive: true, variants: [{ id: V, name: 'Default', pricePaise: 50000, isActive: true }] };
    fakeServer([
      ['GET', /^\/merchant\/templates$/, () => ({ data: { templates: [] } })],
      ['GET', base('/products'), () => ({ data: { products: [product] }, meta: { ...META, limit: 100 } })],
      ['GET', base('/categories'), () => ({ data: { categories: [] } })],
      ['POST', base('/products/bulk'), () => ({ data: { bulk: { action: 'adjust_price_percent', preview: true, results: [{ productId: A, name: 'Ghee', status: 'failed', errors: [{ code: 'PRICE_ABOVE_MRP', message: 'The new price would be above the MRP.' }] }], summary: { total: 1, ok: 0, failed: 1 } } } })],
    ]);
    await render(<CatalogueToolsPage />);
    await click(byText('button', 'Bulk changes'));
    await waitFor(() => text().includes('Ghee'));
    await type(byLabel('Change'), 'adjust_price_percent');
    await type(byLabel(/^%/), '50');
    await click(document.querySelector('input[aria-label="Select Ghee"]')!);
    await click(byText('button', 'Preview (1)'));
    await waitFor(() => text().includes('The new price would be above the MRP.'));
    expect(text()).toContain('0 will change, 1 cannot');
    expect(byText('button', 'Apply').hasAttribute('disabled')).toBe(true);
  });
});
