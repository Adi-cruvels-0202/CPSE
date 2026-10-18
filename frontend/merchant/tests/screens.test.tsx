import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, click, byLabel, byText, fakeServer, render, settle, submit, text, type, waitFor } from './helpers/render';
import { RefundPanel } from '../src/features/orders/OrderExtras';
import type { Refund } from '../src/api/ops';

/**
 * The roadmap screens added to the merchant app, driven like a shopkeeper
 * would: they load what the backend returns, send exactly the request the
 * backend documents, and show its errors instead of pretending to succeed.
 */

const S = '11111111-1111-4111-8111-111111111111';
const ID = '22222222-2222-4222-8222-222222222222';
const V = '33333333-3333-4333-8333-333333333333';

vi.mock('../src/hooks/useStore', () => ({ useActiveStore: () => ({ activeStoreId: S, setActiveStoreId: () => undefined }) }));
// jsdom cannot draw on a canvas; the library is trusted, what it is given is tested.
vi.mock('qrcode.react', () => ({ QRCodeCanvas: (props: { value: string; title?: string }) => <canvas data-qr={props.value} aria-label={props.title} /> }));

const META = { page: 1, limit: 20, total: 1, totalPages: 1, hasNextPage: false };
const base = (path: string) => new RegExp(`^/merchant/stores/${S}${path}$`);

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

const refund = (over: Partial<Refund> = {}): Refund => ({
  id: ID, orderId: V, orderNumber: 'ORD-1', kind: 'cancellation', status: 'failed', statusLabel: 'Failed', amountPaise: 25000,
  method: 'provider', methodLabel: 'Back to the original payment', reference: null, reason: 'Store rejected', initiatedBy: 'system',
  failureReason: 'Bank timeout', attempts: 1, initiatedAt: '2026-10-10T10:00:00Z', refundedAt: null, failedAt: '2026-10-10T10:01:00Z',
  nextStep: 'Retry', isFinal: false, events: [{ fromStatus: null, toStatus: 'initiated', label: 'Refund started', source: 'system', note: null, at: '2026-10-10T10:00:00Z' }],
  ...over,
});

describe('refund panel on an order', () => {
  it('retries a failed provider refund and reports the new state', async () => {
    const sent = fakeServer([['POST', base(`/refunds/${ID}/retry`), () => ({ data: { refund: refund({ status: 'processing', statusLabel: 'Processing' }) } })]]);
    const changed = vi.fn();
    await render(<RefundPanel storeId={S} refund={refund()} adjustments={[]} onChanged={changed} />);
    expect(text()).toContain('₹250.00');
    expect(text()).toContain('Bank timeout');
    await click(byText('button', 'Retry refund'));
    expect(sent.map((r) => `${r.method} ${r.url}`)).toEqual([`POST /merchant/stores/${S}/refunds/${ID}/retry`]);
    await waitFor(() => text().includes('now processing'));
    expect(changed).toHaveBeenCalled();
  });

  it('offers cash confirmation only for cash refunds, and never a retry', async () => {
    fakeServer([]);
    await render(<RefundPanel storeId={S} refund={refund({ method: 'cash', methodLabel: 'Cash', status: 'initiated', statusLabel: 'To return', failureReason: null })} adjustments={[]} onChanged={() => undefined} />);
    expect(text()).toContain('I returned the cash');
    expect(text()).not.toContain('Retry refund');
  });

  it('shows the server error when a retry is refused', async () => {
    fakeServer([['POST', base(`/refunds/${ID}/retry`), () => ({ status: 409, error: { code: 'REFUND_NOT_RETRYABLE', message: 'This refund is already being processed.' } })]]);
    const changed = vi.fn();
    await render(<RefundPanel storeId={S} refund={refund()} adjustments={[]} onChanged={changed} />);
    await click(byText('button', 'Retry refund'));
    await waitFor(() => text().includes('already being processed'));
    expect(changed).not.toHaveBeenCalled();
  });
});

describe('coupons', () => {
  it('lists coupons and creates one with paise amounts and an end-of-day expiry', async () => {
    const { default: PromotionsPage } = await import('../src/features/tools/PromotionsPage');
    const created: any[] = [];
    const sent = fakeServer([
      ['GET', base('/loyalty'), () => ({ data: { program: null } })],
      ['GET', base('/loyalty/rewards'), () => ({ data: { rewards: [] } })],
      ['GET', base('/loyalty/members'), () => ({ data: { members: [] }, meta: META })],
      ['GET', base('/coupons'), () => ({ data: { coupons: created } })],
      ['POST', base('/coupons'), (req) => { created.push({ id: ID, ...req.body, timesUsed: 0, totalDiscountPaise: 0, startsAt: '2026-10-11T00:00:00Z', isActive: true }); return { status: 201, data: { coupon: created[0] } }; }],
    ]);
    await render(<PromotionsPage />);
    await click(byText('button', 'Coupons'));
    await waitFor(() => text().includes('No coupons yet'));
    await click(byText('button', 'New coupon'));
    await type(byLabel('Code'), 'DIWALI50');
    await type(byLabel('Discount'), 'flat');
    await type(byLabel('Amount ₹'), '50');
    await type(byLabel('Minimum order ₹'), '300');
    await type(byLabel('Last day'), '2026-11-15');
    await submit(document.getElementById('coupon-form') as HTMLFormElement);
    const post = sent.find((r) => r.method === 'POST')!;
    expect(post.body).toMatchObject({ code: 'DIWALI50', discountType: 'flat', amountOffPaise: 5000, minOrderPaise: 30000, audience: 'all', maxUsesPerCustomer: 1 });
    expect(new Date(post.body.endsAt).getDate()).toBe(15);
    await waitFor(() => text().includes('DIWALI50'));
  });
});

describe('catalogue import', () => {
  it('previews a CSV, shows problem rows, and only commits on request', async () => {
    const { default: CatalogueToolsPage } = await import('../src/features/tools/CatalogueToolsPage');
    const sent = fakeServer([
      ['GET', /^\/merchant\/templates$/, () => ({ data: { templates: [] } })],
      ['POST', base('/catalogue/import'), (req) => req.params.mode === 'preview'
        ? { data: { mode: 'preview', rowCount: 2, failedRows: [{ line: 3, productName: 'Dal', errors: [{ field: 'price', message: 'price is required.' }] }], products: [], summary: { productsToCreate: 1, productsToUpdate: 0, productsSkipped: 0, newCategories: ['Staples'] } } }
        : { data: { mode: 'commit', results: [], summary: { created: 1, updated: 0, skipped: 0, failed: 1 } } }],
    ]);
    await render(<CatalogueToolsPage />);
    await click(byText('button', 'Import & export'));
    const input = document.querySelector<HTMLInputElement>('input[type=file]')!;
    const file = new File(['product_name,price\nRice,60\nDal,\n'], 'stock.csv', { type: 'text/csv' });
    Object.defineProperty(input, 'files', { value: [file] });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await waitFor(() => text().includes('stock.csv · 2 rows'));
    await click(byText('button', 'Check file'));
    await waitFor(() => text().includes('1 new'));
    expect(text()).toContain('Line 3 (Dal): price — price is required.');
    expect(text()).toContain('new categories: Staples');
    expect(sent.filter((r) => r.params?.mode === 'commit')).toHaveLength(0);
    await click(byText('button', 'Import now'));
    const commit = sent.find((r) => r.params?.mode === 'commit')!;
    expect(commit.body).toBe('product_name,price\nRice,60\nDal,\n');
    expect(commit.headers['Content-Type']).toBe('text/csv');
  });
});

describe('bulk changes', () => {
  it('previews before applying and sends the chosen products', async () => {
    const { default: CatalogueToolsPage } = await import('../src/features/tools/CatalogueToolsPage');
    const product = { id: ID, name: 'Rice', isActive: true, variants: [{ id: V, name: '1 kg', pricePaise: 12000, isActive: true }] };
    const sent = fakeServer([
      ['GET', /^\/merchant\/templates$/, () => ({ data: { templates: [] } })],
      ['GET', base('/products'), () => ({ data: { products: [product] }, meta: { ...META, total: 1 } })],
      ['GET', base('/categories'), () => ({ data: { categories: [] } })],
      ['POST', base('/products/bulk'), (req) => ({ data: { bulk: { action: req.body.action, preview: req.body.preview, results: [{ productId: ID, name: 'Rice', status: req.body.preview ? 'ok' : 'applied' }], summary: { total: 1, ok: 1, failed: 0 } } } })],
    ]);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await render(<CatalogueToolsPage />);
    await click(byText('button', 'Bulk changes'));
    await waitFor(() => text().includes('Rice'));
    await type(byLabel('Change'), 'adjust_price_percent');
    await type(byLabel(/^%/), '-10');
    await click(document.querySelector('input[aria-label="Select Rice"]')!);
    expect(byText('button', 'Apply').hasAttribute('disabled')).toBe(true);
    await click(byText('button', 'Preview (1)'));
    await waitFor(() => text().includes('Preview: 1 will change'));
    await click(byText('button', 'Apply'));
    const posts = sent.filter((r) => r.method === 'POST');
    expect(posts.map((p) => p.body)).toEqual([
      { action: 'adjust_price_percent', percent: -10, productIds: [ID], preview: true },
      { action: 'adjust_price_percent', percent: -10, productIds: [ID], preview: false },
    ]);
  });
});

describe('customer messages', () => {
  it('opens a thread from the list and replies, resolving it', async () => {
    const { default: MessagesPage } = await import('../src/features/tools/MessagesPage');
    const conversation = {
      id: ID, kind: 'question', kindLabel: 'Question', requestType: null, subject: 'Do you have basmati?', status: 'awaiting_store', statusLabel: 'Needs your reply',
      customer: { id: V, name: 'Asha' }, order: null, product: null, lastMessageAt: '2026-10-10T09:00:00Z', isUnread: true, createdAt: '2026-10-10T09:00:00Z',
      messages: [{ id: 'm1', from: 'customer', body: 'Do you have basmati?', at: '2026-10-10T09:00:00Z' }],
    };
    const sent = fakeServer([
      ['GET', base('/conversations'), () => ({ data: { conversations: [conversation] } })],
      ['GET', base(`/conversations/${ID}`), () => ({ data: { conversation } })],
      ['POST', base(`/conversations/${ID}/messages`), (req) => ({ status: 201, data: { conversation: { ...conversation, status: 'resolved', statusLabel: 'Resolved', messages: [...conversation.messages, { id: 'm2', from: 'merchant', body: req.body.body, at: '2026-10-10T09:05:00Z' }] } } })],
    ]);
    await render(<MessagesPage />, { path: '/messages' });
    await waitFor(() => text().includes('Do you have basmati?'));
    expect(sent[0].params).toEqual({ status: 'awaiting_store' });
    await click(byText('button', /Do you have basmati\?/));
    await waitFor(() => document.getElementById('reply-text'));
    await type(document.getElementById('reply-text') as HTMLTextAreaElement, 'Yes, 5 kg bags in stock');
    await click(byText('button', 'Reply & resolve'));
    const post = sent.find((r) => r.method === 'POST')!;
    expect(post.body).toEqual({ body: 'Yes, 5 kg bags in stock', resolve: true });
    await waitFor(() => text().includes('Yes, 5 kg bags in stock'));
  });
});

describe('automation', () => {
  it('a weekly task sends its day; khata reminders toggle through the documented route', async () => {
    const { default: AutomationPage } = await import('../src/features/tools/AutomationPage');
    const sent = fakeServer([
      ['GET', base('/tasks'), () => ({ data: { tasks: [] } })],
      ['POST', base('/tasks'), (req) => ({ status: 201, data: { task: { id: ID, ...req.body, isActive: true, nextRunAt: '2026-10-12T03:30:00Z', lastRunAt: null } } })],
      ['GET', base('/low-stock'), () => ({ data: { items: [{ productId: ID, productName: 'Sugar', variantId: V, variantName: 'Default', sku: null, availableQuantity: 2, lowStockThreshold: 5 }] } })],
      ['GET', new RegExp(`^/merchant/stores/${S}$`), () => ({ data: { store: { id: S, khata: { enabled: true, dueDays: 30, autoReminders: false } } } })],
      ['PUT', base('/khata-settings/auto-reminders'), (req) => ({ data: { khataAutoReminders: req.body.enabled } })],
    ]);
    await render(<AutomationPage />);
    await waitFor(() => text().includes('Sugar'));
    expect(text()).toContain('2 left');
    await click(byText('button', 'New task'));
    await type(byLabel('Day'), '3');
    await type(byLabel('Time'), '09:30');
    await submit(document.getElementById('task-form') as HTMLFormElement);
    expect(sent.find((r) => r.method === 'POST')!.body).toEqual({ title: 'What to reorder', taskType: 'purchase_suggestions', frequency: 'weekly', timeOfDay: '09:30', dayOfWeek: 3 });
    await waitFor(() => text().includes('Remind customers automatically'));
    await click(byLabel(/Remind customers automatically/));
    expect(sent.find((r) => r.method === 'PUT')!.body).toEqual({ enabled: true });
  });
});

describe('share', () => {
  it('builds the public link from the store slug and draws its QR code', async () => {
    const { default: SharePage, storeLink } = await import('../src/features/tools/SharePage');
    fakeServer([['GET', new RegExp(`^/merchant/stores/${S}$`), () => ({ data: { store: { id: S, slug: 'sharma-kirana', name: 'Sharma Kirana', isPublished: false, latitude: 19.07, longitude: 72.87 } } })]]);
    expect(storeLink('sharma kirana', 'https://cpse.example')).toBe('https://cpse.example/store/sharma%20kirana');
    await render(<SharePage />);
    await waitFor(() => text().includes('Scan to order from Sharma Kirana'));
    expect((byLabel("Your shop's link") as HTMLInputElement).value).toBe(`${window.location.origin}/store/sharma-kirana`);
    expect(text()).toContain('not published yet');
    const wa = byText('a', 'Share on WhatsApp') as HTMLAnchorElement;
    expect(decodeURIComponent(wa.href)).toContain(`Order from Sharma Kirana online: ${window.location.origin}/store/sharma-kirana`);
    expect((byText('a', 'Show on map') as HTMLAnchorElement).href).toContain('query=19.07,72.87');
    expect(document.querySelector('canvas')!.getAttribute('data-qr')).toBe(`${window.location.origin}/store/sharma-kirana`);

    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,QR');
    const clicks: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { clicks.push(this); });
    await click(byText('button', 'Download QR'));
    expect(clicks[0].download).toBe('sharma-kirana-qr.png');
    expect(clicks[0].href).toBe('data:image/png;base64,QR');
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    await click(byText('button', 'Print poster'));
    expect(print).toHaveBeenCalled();
    await settle();
  });
});
