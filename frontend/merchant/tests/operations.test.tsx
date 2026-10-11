import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { cleanup, click, byLabel, byText, fakeServer, render, submit, text, type, waitFor } from './helpers/render';
import KhataPage from '../src/features/tools/KhataPage';
import PurchasesPage from '../src/features/tools/PurchasesPage';
import BatchesPage from '../src/features/tools/BatchesPage';
import InboxPage from '../src/features/tools/InboxPage';
import SuggestionsPage from '../src/features/tools/SuggestionsPage';
import VerificationPage from '../src/features/tools/VerificationPage';
import RefundsPage from '../src/features/tools/RefundsPage';

/**
 * Store operations screens (roadmap §4 P1/P2, Phase C): khata, purchases,
 * batches, inbox, reorder suggestions, verification and refunds — each sends
 * the request the backend documents and shows the backend's refusals.
 */

const S = '11111111-1111-4111-8111-111111111111';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const V = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

vi.mock('../src/hooks/useStore', () => ({ useActiveStore: () => ({ activeStoreId: S, setActiveStoreId: () => undefined }) }));

const base = (path: string) => new RegExp(`^/merchant/stores/${S}${path}$`);
const META = { page: 1, limit: 20, total: 1, totalPages: 1, hasNextPage: false };

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

// ── Khata ───────────────────────────────────────────────────────────────────

const account = { id: A, balancePaise: 30000, creditLimitPaise: 100000, availableCreditPaise: 70000, isActive: true, customer: { id: B, name: 'Ravi', phone: '98xxxxxx01', email: null }, notes: null, remindersEnabled: true, ageing: { outstandingPaise: 30000, overduePaise: 10000, advancePaise: 0, earliestDueDate: '2026-10-01' } };
const charge = { id: C, type: 'debit', entryKind: 'charge', entryLabel: 'Credit given', amountPaise: 30000, signedAmountPaise: 30000, description: 'Groceries', dueDate: '2026-10-01', paymentMethod: null, reversesTransactionId: null, refundId: null, orderId: null, recordedBy: 'merchant', occurredAt: '2026-09-20T10:00:00Z' };

describe('khata', () => {
  const routes = (extra: any[] = []) => fakeServer([
    ['GET', base('/khata'), () => ({ data: { accounts: [account], summary: { accountCount: 1, outstandingPaise: 30000, overduePaise: 10000 } } })],
    ['GET', base(`/khata/${A}`), () => ({ data: { account, totals: { debitPaise: 30000, creditPaise: 0, balancePaise: 30000 }, transactions: [charge], reminders: [] } })],
    ...extra,
  ]);

  it('records a payment once, with an idempotency key that changes after success', async () => {
    const sent = routes([['POST', base(`/khata/${A}/entries`), (req: any) => ({ status: 201, data: { transaction: { ...charge, id: V, ...req.body } } })]]);
    await render(<KhataPage />);
    await waitFor(() => text().includes('Ravi'));
    expect(text()).toContain('₹300.00');
    await click(byText('button', 'Open'));
    await waitFor(() => text().includes('Khata — Ravi'));
    await click(byText('button', 'Payment received'));
    await type(byLabel('Amount (₹)'), '100');
    await type(byLabel('Paid by'), 'upi');
    await click(byText('button', 'Record'));
    await type(byLabel('Amount (₹)'), '50');
    await click(byText('button', 'Record'));
    const posts = sent.filter((r) => r.method === 'POST');
    expect(posts[0].body).toEqual({ kind: 'payment', amountPaise: 10000, paymentMethod: 'upi' });
    expect(posts[0].headers['Idempotency-Key']).toBeTruthy();
    expect(posts[1].headers['Idempotency-Key']).not.toBe(posts[0].headers['Idempotency-Key']);
  });

  it('will not send an adjustment without a reason, and reverses with a reason', async () => {
    const sent = routes([['POST', base(`/khata/${A}/entries/${C}/reverse`), () => ({ status: 201, data: { transaction: { ...charge, id: V, entryKind: 'reversal', reversesTransactionId: C } } })]]);
    vi.spyOn(window, 'prompt').mockReturnValue('Entered twice');
    await render(<KhataPage />);
    await waitFor(() => text().includes('Ravi'));
    await click(byText('button', 'Open'));
    await waitFor(() => text().includes('Groceries'));
    await click(byText('button', 'Adjustment'));
    await type(byLabel('Amount (₹)'), '20');
    await click(byText('button', 'Record'));
    await waitFor(() => text().includes('An adjustment needs a reason.'));
    expect(sent.some((r) => r.url.endsWith('/entries'))).toBe(false);
    await click(byText('button', 'Reverse'));
    expect(sent.find((r) => r.url.endsWith('/reverse'))!.body).toEqual({ reason: 'Entered twice' });
  });
});

describe('khata reminders, due dates and refund credits', () => {
  it('records credit with a due date, sends a reminder, and never offers to reverse a refund credit', async () => {
    const refundCredit = { ...charge, id: V, type: 'credit', entryKind: 'refund_credit', entryLabel: 'Refund credited', amountPaise: 5000, description: 'Order ORD-3 cancelled', dueDate: null, refundId: B };
    const sent = fakeServer([
      ['GET', base('/khata'), () => ({ data: { accounts: [account], summary: { accountCount: 1, outstandingPaise: 30000, overduePaise: 10000 } } })],
      ['GET', base(`/khata/${A}`), () => ({ data: { account, totals: { debitPaise: 30000, creditPaise: 5000, balancePaise: 25000 }, transactions: [refundCredit], reminders: [] } })],
      ['POST', base(`/khata/${A}/entries`), (req) => ({ status: 201, data: { transaction: { ...charge, ...req.body } } })],
      ['POST', base(`/khata/${A}/reminders`), () => ({ status: 409, error: { code: 'REMINDER_TOO_SOON', message: 'A reminder was already sent today.' } })],
    ]);
    await render(<KhataPage />);
    await waitFor(() => text().includes('Ravi'));
    await click(byText('button', 'Open'));
    await waitFor(() => text().includes('Refund credited'));
    expect(document.querySelectorAll('[role=dialog] tbody button').length).toBe(0); // no Reverse on a refund credit
    await type(byLabel('Amount (₹)'), '250');
    await type(byLabel(/Due date/), '2026-11-01');
    await type(byLabel('Note'), 'Monthly ration');
    await click(byText('button', 'Record'));
    expect(sent.find((r) => r.url.endsWith('/entries'))!.body).toEqual({ kind: 'charge', amountPaise: 25000, description: 'Monthly ration', dueDate: '2026-11-01' });
    await click(byText('button', 'Send reminder'));
    expect(sent.some((r) => r.url.endsWith('/reminders'))).toBe(true);
    await waitFor(() => text().includes('A reminder was already sent today.'));
  });
});

// ── Purchases ───────────────────────────────────────────────────────────────

describe('purchases', () => {
  it('receives stock with batch and expiry in one step', async () => {
    const product = { id: A, name: 'Milk', trackInventory: true, isActive: true, variants: [{ id: V, name: '500 ml', costPaise: 2400, pricePaise: 3000, isActive: true }] };
    const sent = fakeServer([
      ['GET', base('/purchases'), () => ({ data: { purchases: [] }, meta: { ...META, total: 0 } })],
      ['GET', base('/products'), () => ({ data: { products: [product] }, meta: { ...META, limit: 100 } })],
      ['GET', base('/suppliers'), () => ({ data: { suppliers: [{ id: B, name: 'Dairy Co', isActive: true }] } })],
      ['POST', base('/purchases'), (req) => ({ status: 201, data: { purchase: { id: C, status: req.body.confirm ? 'confirmed' : 'draft' } } })],
    ]);
    await render(<PurchasesPage />);
    await waitFor(() => text().includes('No purchases yet'));
    await click(byText('button', 'New purchase'));
    await waitFor(() => document.querySelector('select[aria-label="Product"] option[value="' + V + '"]'));
    await type(byLabel('Supplier'), B);
    await type(byLabel('Invoice number'), 'INV-77');
    await type(document.querySelector('select[aria-label="Product"]') as HTMLSelectElement, V);
    await type(document.querySelector('input[aria-label="Quantity"]') as HTMLInputElement, '24');
    await type(document.querySelector('input[aria-label="Cost per unit (₹)"]') as HTMLInputElement, '24');
    await type(document.querySelector('input[aria-label="Batch number"]') as HTMLInputElement, 'MLK-1');
    await type(document.querySelector('input[aria-label="Expiry date"]') as HTMLInputElement, '2026-10-20');
    await click(byText('button', 'Receive stock'));
    expect(sent.find((r) => r.method === 'POST')!.body).toEqual({
      supplierId: B, invoiceNumber: 'INV-77', invoiceDate: null, confirm: true,
      items: [{ variantId: V, quantity: 24, unitCostPaise: 2400, taxPaise: 0, batchNumber: 'MLK-1', expiresOn: '2026-10-20' }],
    });
    await waitFor(() => text().includes('Stock received'));
  });

  it('shows a duplicate-invoice refusal and keeps the form', async () => {
    const product = { id: A, name: 'Milk', trackInventory: true, isActive: true, variants: [{ id: V, name: 'Default', costPaise: null, pricePaise: 3000, isActive: true }] };
    fakeServer([
      ['GET', base('/purchases'), () => ({ data: { purchases: [] }, meta: { ...META, total: 0 } })],
      ['GET', base('/products'), () => ({ data: { products: [product] }, meta: { ...META, limit: 100 } })],
      ['GET', base('/suppliers'), () => ({ data: { suppliers: [] } })],
      ['POST', base('/purchases'), () => ({ status: 409, error: { code: 'DUPLICATE_INVOICE', message: 'You already recorded invoice INV-77 from this supplier.' } })],
    ]);
    await render(<PurchasesPage />);
    await click(await waitFor(() => byText('button', 'New purchase')));
    await waitFor(() => document.querySelector(`select[aria-label="Product"] option[value="${V}"]`));
    await type(document.querySelector('select[aria-label="Product"]') as HTMLSelectElement, V);
    await type(document.querySelector('input[aria-label="Quantity"]') as HTMLInputElement, '1');
    await type(document.querySelector('input[aria-label="Cost per unit (₹)"]') as HTMLInputElement, '20');
    await click(byText('button', 'Save draft'));
    await waitFor(() => text().includes('already recorded invoice INV-77'));
    expect(text()).toContain('New purchase');
  });
});

// ── Batches ─────────────────────────────────────────────────────────────────

describe('batches', () => {
  const batch = (over: Record<string, unknown>) => ({ id: A, productId: B, productName: 'Curd', variantId: V, variantName: null, sku: null, batchNumber: 'CRD-3', manufacturedOn: null, expiresOn: '2026-10-09', daysToExpiry: -2, expiryState: 'expired', quantityReceived: 10, quantityRemaining: 4, unitCostPaise: 3000, receivedAt: '2026-10-01T00:00:00Z', ...over });

  it('writes off an expired lot from that batch, after confirmation', async () => {
    const sent = fakeServer([
      ['GET', base('/inventory/batches'), () => ({ data: { batches: [batch({})], summary: { expiringCount: 0, expiredCount: 1, expiredQuantity: 4 } }, meta: META })],
      ['POST', base('/inventory/stock-out'), () => ({ status: 201, data: { movement: { id: C } } })],
    ]);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await render(<BatchesPage />);
    await waitFor(() => text().includes('CRD-3'));
    expect(sent[0].params).toMatchObject({ status: 'expiring' });
    await click(byText('button', 'Write off'));
    expect(sent.find((r) => r.method === 'POST')!.body).toMatchObject({ variantId: V, quantity: 4, reason: 'expired', batchId: A });
    await waitFor(() => text().includes('Written off'));
  });

  it('offers a clearance offer only on expiring lots', async () => {
    fakeServer([['GET', base('/inventory/batches'), () => ({ data: { batches: [batch({ expiryState: 'expiring', daysToExpiry: 2, expiresOn: '2026-10-13' })], summary: { expiringCount: 1, expiredCount: 0, expiredQuantity: 0 } }, meta: META })]]);
    await render(<BatchesPage />);
    await waitFor(() => text().includes('2 days left'));
    expect(text()).not.toContain('Write off');
    await click(byText('button', 'Clearance offer'));
    expect(text()).toContain('Curd · batch CRD-3 · 4 left');
  });
});

// ── Inbox ───────────────────────────────────────────────────────────────────

function Where() {
  const location = useLocation();
  return <div data-testid="where">{location.pathname}{location.search}</div>;
}

describe('inbox', () => {
  it('marks an alert read and takes the merchant to where it can be handled', async () => {
    const note = { id: A, type: 'low_stock', title: 'Sugar is running low', body: '2 left', payload: { variant_id: V }, isRead: false, createdAt: '2026-10-11T05:00:00Z' };
    const sent = fakeServer([
      ['GET', base('/notifications'), () => ({ data: { notifications: [note], unreadCount: 1 }, meta: META })],
      ['POST', base(`/notifications/${A}/read`), () => ({ data: { notification: { ...note, isRead: true } } })],
      ['POST', base('/notifications/read-all'), () => ({ data: { updated: 3 } })],
    ]);
    await render(<Routes><Route path="/inbox" element={<InboxPage />} /><Route path="*" element={<Where />} /></Routes>, { path: '/inbox' });
    await waitFor(() => text().includes('Sugar is running low'));
    expect(sent[0].params).toMatchObject({ unreadOnly: 'true' });
    await click(byText('button', 'Mark all read'));
    await waitFor(() => text().includes('3 marked read'));
    await click(byText('button', /Sugar is running low/));
    expect(sent.some((r) => r.url.endsWith(`/notifications/${A}/read`))).toBe(true);
    await waitFor(() => document.querySelector('[data-testid="where"]')?.textContent === '/suggestions');
  });

  it('sends a message notification to that conversation', async () => {
    const note = { id: A, type: 'customer_message', title: 'New question', body: null, payload: { conversation_id: C }, isRead: true, createdAt: '2026-10-11T05:00:00Z' };
    fakeServer([['GET', base('/notifications'), () => ({ data: { notifications: [note], unreadCount: 0 }, meta: META })]]);
    await render(<Routes><Route path="/inbox" element={<InboxPage />} /><Route path="*" element={<Where />} /></Routes>, { path: '/inbox' });
    await click(await waitFor(() => byText('button', /New question/)));
    await waitFor(() => document.querySelector('[data-testid="where"]')?.textContent === `/messages?open=${C}`);
  });
});

// ── Suggestions ─────────────────────────────────────────────────────────────

describe('what to reorder', () => {
  it('turns the chosen lines into a draft purchase', async () => {
    const lines = [
      { productId: A, productName: 'Sugar', variantId: V, variantName: null, sku: null, available: 2, onDraftPurchases: 0, soldLastPeriod: 30, dailyRate: 1, suggestedQuantity: 12, lastCostPaise: 4000, estimatedCostPaise: 48000, reason: 'Sold 30 in 30 days; 2 left.' },
      { productId: B, productName: 'Salt', variantId: C, variantName: null, sku: null, available: 1, onDraftPurchases: 0, soldLastPeriod: 10, dailyRate: 0.3, suggestedQuantity: 4, lastCostPaise: null, estimatedCostPaise: null, reason: 'Below alert level.' },
    ];
    const sent = fakeServer([
      ['GET', base('/purchase-suggestions'), () => ({ data: { suggestions: { coverDays: 14, lookbackDays: 30, suggestions: lines } } })],
      ['GET', base('/suppliers'), () => ({ data: { suppliers: [] } })],
      ['POST', base('/purchase-suggestions/draft'), () => ({ status: 201, data: { purchase: { id: A, status: 'draft' } } })],
    ]);
    await render(<Routes><Route path="/suggestions" element={<SuggestionsPage />} /><Route path="*" element={<Where />} /></Routes>, { path: '/suggestions' });
    await waitFor(() => text().includes('Sold 30 in 30 days'));
    expect(text()).toContain('Estimated ₹480.00');
    await click(document.querySelector('input[aria-label="Include Salt"]')!);
    await type(document.querySelectorAll<HTMLInputElement>('input[aria-label="Quantity"]')[0], '10');
    await click(byText('button', 'Create draft purchase (1)'));
    expect(sent.find((r) => r.method === 'POST')!.body).toEqual({ items: [{ variantId: V, quantity: 10, unitCostPaise: 4000 }] });
    await waitFor(() => document.querySelector('[data-testid="where"]')?.textContent === '/purchases');
    await act(async () => undefined);
  });
});

// ── Verification ────────────────────────────────────────────────────────────

const verification = (over: Record<string, unknown> = {}) => ({
  status: 'not_submitted', statusLabel: 'Not submitted', isEditable: true,
  details: { legalName: null, businessType: null, gstApplicable: false, gstin: null, ownerName: null, ownerPhone: null, ownerEmail: null, businessAddress: null },
  documents: [], requiredDocuments: [{ docType: 'shop_photo', label: 'Photo of the shop front', provided: false }],
  missing: ['legalName', 'document:shop_photo'], rejectionReason: null, reviewNote: null, events: [], ...over,
});

describe('verification', () => {
  it('lists what is missing, blocks submit, and shows a field error from the server', async () => {
    const sent = fakeServer([
      ['GET', base('/verification'), () => ({ data: { verification: verification() } })],
      ['PUT', base('/verification'), () => ({ status: 422, error: { code: 'VALIDATION_FAILED', message: 'Request validation failed', details: { issues: [{ field: 'gstin', message: 'That is not a valid GSTIN.' }] } } })],
    ]);
    await render(<VerificationPage />);
    await waitFor(() => text().includes('Still needed: Legal business name, Photo of the shop front.'));
    expect(byText('button', 'Submit for review').hasAttribute('disabled')).toBe(true);
    await type(byLabel('Legal business name *'), 'Sharma Stores');
    await click(byLabel(/registered for GST/));
    await type(byLabel('GSTIN *'), '27abcde1234f1z5');
    await submit(document.querySelector('form')!);
    expect(sent.find((r) => r.method === 'PUT')!.body).toMatchObject({ legalName: 'Sharma Stores', gstApplicable: true, gstin: '27ABCDE1234F1Z5' });
    await waitFor(() => document.querySelector('.input-error')?.textContent === 'That is not a valid GSTIN.');
  });

  it('uploads a document and submits once nothing is missing', async () => {
    let state = verification({ missing: ['document:shop_photo'] });
    const sent = fakeServer([
      ['GET', base('/verification'), () => ({ data: { verification: state } })],
      ['POST', base('/verification/documents/shop_photo'), () => {
        state = verification({ missing: [], documents: [{ id: A, docType: 'shop_photo', label: 'Photo of the shop front', mimeType: 'image/jpeg', sizeBytes: 1000, uploadedAt: '2026-10-11T00:00:00Z' }], requiredDocuments: [{ docType: 'shop_photo', label: 'Photo of the shop front', provided: true }] });
        return { status: 201, data: { verification: state } };
      }],
      ['POST', base('/verification/submit'), () => ({ data: { verification: verification({ status: 'pending', statusLabel: 'Under review', isEditable: false, missing: [] }) } })],
    ]);
    await render(<VerificationPage />);
    await waitFor(() => text().includes('Photo of the shop front'));
    const input = document.querySelector<HTMLInputElement>('input[type=file]')!;
    Object.defineProperty(input, 'files', { value: [new File(['jpeg'], 'front.jpg', { type: 'image/jpeg' })] });
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
    await waitFor(() => text().includes('Uploaded'));
    expect(sent.find((r) => r.url.endsWith('/documents/shop_photo'))!.body).toBeInstanceOf(FormData);
    await click(byText('button', 'Submit for review'));
    await waitFor(() => text().includes('Under review'));
    expect(text()).toContain('Details are locked');
  });
});

// ── Refunds list ────────────────────────────────────────────────────────────

describe('refunds list', () => {
  it('starts on what needs attention and filters by status', async () => {
    const sent = fakeServer([['GET', base('/refunds'), () => ({ data: { refunds: [{ id: A, orderId: B, orderNumber: 'ORD-5', kind: 'cancellation', status: 'failed', statusLabel: 'Failed', amountPaise: 9900, method: 'provider', methodLabel: 'Original payment', failureReason: 'Bank timeout', initiatedAt: '2026-10-10T00:00:00Z', events: [] }] }, meta: META })]]);
    await render(<RefundsPage />);
    await waitFor(() => text().includes('ORD-5'));
    expect(sent[0].params).toMatchObject({ status: 'initiated,processing,failed' });
    expect(text()).toContain('Bank timeout');
    await click(byText('button', 'Refunded'));
    await waitFor(() => sent.some((r) => r.params?.status === 'refunded'));
  });
});
