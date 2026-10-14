import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { cleanup, click, byLabel, byText, fakeServer, render, text, type, waitFor } from './helpers/render';
import InsightsPage from '../src/features/tools/InsightsPage';
import PurchasesPage from '../src/features/tools/PurchasesPage';
import ProductsPage from '../src/features/products/ProductsPage';
import NewSalePage from '../src/features/sales/NewSalePage';
import { ProposeSubstitutionModal } from '../src/features/orders/OrderExtras';

/**
 * The intelligence screens (roadmap §4 Phase D/E): they show what the server
 * worked out and why, and change nothing until the merchant confirms.
 */

const S = '11111111-1111-4111-8111-111111111111';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const V = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const V2 = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

vi.mock('../src/hooks/useStore', () => ({ useActiveStore: () => ({ activeStoreId: S, setActiveStoreId: () => undefined }) }));

const base = (path: string) => new RegExp(`^/merchant/stores/${S}${path}$`);
const META = { page: 1, limit: 100, total: 1, totalPages: 1, hasNextPage: false };

beforeEach(() => window.localStorage.clear());
afterEach(async () => {
  await cleanup();
  delete (window as any).SpeechRecognition;
  delete (window as any).BarcodeDetector;
});

describe('stock and demand', () => {
  it('shows health, the forecast with its confidence, and when there is not enough data', async () => {
    fakeServer([['GET', base('/intelligence/stock'), () => ({ data: { stock: { today: '2026-10-11', horizonDays: 14, leadDays: 7, counts: { at_risk: 1, unknown: 1 }, method: 'Average of the last 28 days.', items: [
      { productId: A, variantId: V, name: 'Basmati Rice (1 kg)', available: 6, soldLast30: 60, forecast: { confidence: 'medium', reason: 'x', dailyAverage: 2, nextDaysUnits: 28, horizonDays: 14 }, health: { status: 'at_risk', daysOfCover: 3, note: 'Runs out in about 3 days.' }, proposedReorderQuantity: 36 },
      { productId: B, variantId: V2, name: 'Ghee', available: 4, soldLast30: 0, forecast: { confidence: 'insufficient', reason: 'Only 5 days of history; a forecast needs at least 14.', dailyAverage: null, nextDaysUnits: null, horizonDays: 14 }, health: { status: 'unknown', daysOfCover: null, note: 'Not enough sales history to judge.' }, proposedReorderQuantity: null },
    ] } } })]]);
    await render(<InsightsPage />);
    await waitFor(() => text().includes('Basmati Rice (1 kg)'));
    expect(text()).toContain('Running out');
    expect(text()).toContain('~28 (medium confidence)');
    expect(text()).toContain('36');
    expect(text()).toContain('Only 5 days of history; a forecast needs at least 14.');
    expect(text()).toContain('Average of the last 28 days.');
  });
});

describe('ask', () => {
  it('answers with its source, and applies an instruction only on Confirm', async () => {
    const sent = fakeServer([
      ['GET', base('/intelligence/stock'), () => ({ data: { stock: { today: '', horizonDays: 14, leadDays: 7, counts: {}, items: [], method: '' } } })],
      ['POST', base('/intelligence/ask'), (req) => req.body.question.startsWith('set')
        ? { data: { reply: { kind: 'proposal', understood: true, proposal: { summary: 'Change Sugar from ₹40.00 to ₹45.00', requiresConfirmation: true, apply: { method: 'PATCH', path: `/merchant/stores/${S}/products/${A}/variants/${V}`, body: { pricePaise: 4500 } } } } } }
        : { data: { reply: { kind: 'answer', intent: 'sales', answer: 'Sales for the last 7 days: ₹1,234.00.', source: 'Reports.', actions: [{ type: 'open', text: 'Open Reports', to: '/analytics' }] } } }],
      ['PATCH', base(`/products/${A}/variants/${V}`), () => ({ data: { variant: { id: V } } })],
    ]);
    await render(<InsightsPage />);
    await click(byText('button', 'Ask'));
    await type(document.querySelector('input[aria-label="Ask or instruct"]') as HTMLInputElement, 'how much did I sell');
    await click(document.querySelector('form button[type=submit]')!);
    await waitFor(() => text().includes('Sales for the last 7 days: ₹1,234.00.'));
    expect(text()).toContain('From: Reports.');

    await type(document.querySelector('input[aria-label="Ask or instruct"]') as HTMLInputElement, 'set price of sugar to 45');
    await click(document.querySelector('form button[type=submit]')!);
    await waitFor(() => text().includes('Change Sugar from ₹40.00 to ₹45.00'));
    expect(sent.filter((r) => r.method === 'PATCH')).toHaveLength(0);
    await click(byText('button', 'Confirm'));
    expect(sent.find((r) => r.method === 'PATCH')!.body).toEqual({ pricePaise: 4500 });
    await waitFor(() => text().includes('Done'));
  });

  it('fills the question from speech where the browser can listen', async () => {
    fakeServer([['GET', base('/intelligence/stock'), () => ({ data: { stock: { today: '', horizonDays: 14, leadDays: 7, counts: {}, items: [], method: '' } } })]]);
    class FakeRecognition { lang = ''; interimResults = true; onresult: any = null; onerror: any = null; onend: any = null; start() { setTimeout(() => this.onresult({ results: [[{ transcript: 'what is running low' }]] }), 0); } }
    (window as any).SpeechRecognition = FakeRecognition;
    await render(<InsightsPage />);
    await click(byText('button', 'Ask'));
    await click(document.querySelector('button[aria-label="Speak"]')!);
    await waitFor(() => (document.querySelector('input[aria-label="Ask or instruct"]') as HTMLInputElement).value === 'what is running low');
  });
});

describe('your area', () => {
  it('shows benchmarks only as the server returns them, with the privacy note', async () => {
    fakeServer([
      ['GET', base('/intelligence/stock'), () => ({ data: { stock: { today: '', horizonDays: 14, leadDays: 7, counts: {}, items: [], method: '' } } })],
      ['GET', base('/intelligence/area'), () => ({ data: { area: { city: 'Ludhiana', minStores: 5, otherStores: 6, note: 'From at least 5 other shops in Ludhiana, one figure per shop; no shop is named.', benchmarks: [{ productId: A, variantId: V, name: 'Basmati Rice (1 kg)', basis: 'per_kg', yourPricePaise: 15000, area: { stores: 6, p25: 11000, median: 12000, p75: 13000 }, position: 'above_most' }], popularNearby: [{ name: 'Paneer', shops: '5+' }] } } })],
    ]);
    await render(<InsightsPage />);
    await click(byText('button', 'Your area'));
    await waitFor(() => text().includes('Higher than most'));
    expect(text()).toContain('₹110.00 – ₹130.00');
    expect(text()).toContain('no shop is named');
    expect(text()).toContain('Paneer');
  });
});

describe('reading an invoice', () => {
  it('reads pasted text into matched lines and opens a draft with them', async () => {
    const product = { id: A, name: 'Basmati Rice', trackInventory: true, isActive: true, variants: [{ id: V, name: '1 kg', costPaise: 9000, pricePaise: 12000, isActive: true }] };
    const sent = fakeServer([
      ['GET', base('/purchases'), () => ({ data: { purchases: [] }, meta: { ...META, total: 0 } })],
      ['GET', base('/products'), () => ({ data: { products: [product] }, meta: META })],
      ['GET', base('/suppliers'), () => ({ data: { suppliers: [{ id: B, name: 'Gupta Wholesale', isActive: true }] } })],
      ['POST', base('/intelligence/invoice'), () => ({ data: { invoice: { supplier: { name: 'Gupta Wholesale', source: 'label', match: { supplierId: B, name: 'Gupta Wholesale' } }, warnings: [], invoiceNumber: 'GW-118', invoiceDate: '2026-10-09', statedTotalPaise: 100000, computedTotalPaise: 92000, totalMatches: false, skipped: ['Thank you'], lines: [
        { source: 'Basmati Rice 1kg Batch R-77 Exp 06/2027 10 x 92', readAs: { name: 'Basmati Rice 1kg', quantity: 10, unitCostPaise: 9200, batchNumber: 'R-77', expiresOn: '2027-06-30' }, match: { productId: A, variantId: V, name: 'Basmati Rice (1 kg)', lastCostPaise: 9000 }, confidence: 'high', warnings: [], alternatives: [] },
        { source: 'Unicorn Exp 13/2027 1 x 5', readAs: { name: 'Unicorn', quantity: 1, unitCostPaise: 500, batchNumber: null, expiresOn: null }, match: null, confidence: 'none', warnings: ['Expiry “13/2027” is not a valid date — left empty.'], alternatives: [] },
      ] } } })],
    ]);
    await render(<PurchasesPage />);
    await click(await waitFor(() => byText('button', 'Read an invoice')));
    await type(document.getElementById('inv-text') as HTMLTextAreaElement, 'Basmati Rice 1kg 10 x 92\nUnicorn 1 x 5');
    await click(byText('button', 'Read text'));
    await waitFor(() => text().includes('the invoice says ₹1,000.00, check it'));
    expect(text()).toContain('Supplier: Gupta Wholesale (your saved supplier)');
    expect(text()).toContain('R-77');
    expect(text()).toContain('Expiry “13/2027” is not a valid date — left empty.');
    expect(sent.filter((r) => r.method === 'POST' && r.url.endsWith('/purchases'))).toHaveLength(0);
    await click(byText('button', 'Use 1 lines'));
    await waitFor(() => (document.querySelector('input[aria-label="Quantity"]') as HTMLInputElement)?.value === '10');
    expect((document.querySelector('input[aria-label="Cost per unit (₹)"]') as HTMLInputElement).value).toBe('92.00');
    expect((byLabel('Invoice number') as HTMLInputElement).value).toBe('GW-118');
    expect((byLabel('Supplier') as HTMLSelectElement).value).toBe(B);
    expect((document.querySelector('input[aria-label="Batch number"]') as HTMLInputElement).value).toBe('R-77');
    expect((document.querySelector('input[aria-label="Expiry date"]') as HTMLInputElement).value).toBe('2027-06-30');
  });
});

describe('product suggestions', () => {
  it('suggests category, unit and GST with reasons and applies them only on request', async () => {
    const categories = [{ id: B, name: 'Staples', description: null, productCount: 1, isActive: true }];
    fakeServer([
      ['GET', base('/categories'), () => ({ data: { categories } })],
      ['GET', base('/products'), () => ({ data: { products: [] }, meta: { ...META, total: 0 } })],
      ['POST', base('/intelligence/product-suggestions'), () => ({ data: { suggestion: { duplicates: [], related: [], nextActions: [], suggestions: { category: { id: B, name: 'Staples', reason: 'Like your “Basmati Rice”.' }, unit: { value: 'kg', reason: 'From the size in the name.' }, taxPercent: { value: 5, reason: 'Same as your “Basmati Rice”.' }, weightGrams: null, variants: [] } } } })],
    ]);
    await render(<ProductsPage />);
    await click(await waitFor(() => byText('button', 'Add product')));
    await type(document.getElementById('product-name') as HTMLInputElement, 'Sona Masoori Rice 5kg');
    await click(byText('button', 'Suggest category, unit and GST'));
    await waitFor(() => text().includes('Like your “Basmati Rice”.'));
    expect((document.getElementById('product-sold-by') as HTMLSelectElement).value).toBe('pcs');
    await click(byText('button', 'Use these'));
    expect((document.getElementById('product-category') as HTMLSelectElement).value).toBe(B);
    expect((document.getElementById('product-sold-by') as HTMLSelectElement).value).toBe('kg');
    expect((document.getElementById('product-gst') as HTMLSelectElement).value).toBe('5');
  });
});

describe('camera scanning at the counter', () => {
  it('adds the item whose barcode the camera reads', async () => {
    const product = { id: A, name: 'Basmati Rice', description: null, categoryId: null, unit: 'kg', taxPercent: 0, trackInventory: true, isActive: true, images: [], variants: [{ id: V, name: '1 kg', sku: 'R1', barcode: '8901234567890', pricePaise: 12000, isActive: true, availableQuantity: 5 }] };
    fakeServer([
      ['GET', base('/categories'), () => ({ data: { categories: [] } })],
      ['GET', base('/products'), () => ({ data: { products: [product] }, meta: META })],
    ]);
    (window as any).BarcodeDetector = class { detect() { return Promise.resolve([{ rawValue: '8901234567890' }]); } };
    const getUserMedia = vi.fn(async () => ({ getTracks: () => [{ stop: vi.fn() }] }));
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true });
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    await render(<NewSalePage />);
    await waitFor(() => text().includes('Basmati Rice'));
    await click(document.querySelector('button[aria-label="Scan with camera"]')!);
    await waitFor(() => text().includes('₹120.00') && !document.querySelector('[aria-label="Camera"]'));
    expect(getUserMedia).toHaveBeenCalledWith({ video: { facingMode: 'environment' } });
    await act(async () => undefined);
  });

  it('offers no camera button where the browser cannot read barcodes', async () => {
    fakeServer([
      ['GET', base('/categories'), () => ({ data: { categories: [] } })],
      ['GET', base('/products'), () => ({ data: { products: [] }, meta: { ...META, total: 0 } })],
    ]);
    await render(<NewSalePage />);
    await waitFor(() => document.getElementById('pos-search'));
    expect(document.querySelector('button[aria-label="Scan with camera"]')).toBeNull();
  });
});

// ── Photos (roadmap Phase D "Product recognition", "Invoice extraction") ───

const choose = async (input: HTMLInputElement, file: File) => {
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
};
const photo = () => new File(['jpeg'], 'pack.jpg', { type: 'image/jpeg' });
const read = { isProduct: true, name: 'Iodised Salt', brand: 'Tata', sizeText: '1 kg', category: 'Salt', barcode: null, mrpPaise: 2800, weightGrams: 1000, confidence: 0.95 };

describe('identifying a product from a photo', () => {
  const categories = [{ id: B, name: 'Staples', description: null, productCount: 1, isActive: true }];
  const screen = (recognition: unknown) => fakeServer([
    ['GET', base('/categories'), () => ({ data: { categories } })],
    ['GET', base('/products'), () => ({ data: { products: [] }, meta: { ...META, total: 0 } })],
    ['POST', base('/intelligence/recognize'), () => ({ data: { recognition } })],
  ]);
  const openForm = async () => {
    await render(<ProductsPage />);
    await click(await waitFor(() => byText('button', 'Add product')));
  };

  it('fills the New product form from the photo only when asked, and saves nothing', async () => {
    const sent = screen({ read, identified: true, match: null, candidates: [], note: 'Read from the photo — check it.', suggestion: {
      name: 'Tata Iodised Salt 1 kg', category: { id: B, name: 'Staples', reason: 'x' }, unit: { value: 'kg', reason: 'x' }, taxPercent: { value: 0, reason: 'x' },
      weightGrams: 1000, mrpPaise: 2800, barcode: null, duplicates: [] } });
    await openForm();
    expect(byText('button', 'Identify from photo')).toBeTruthy();
    await choose(document.querySelector('[data-testid="product-photo"]') as HTMLInputElement, photo());
    await waitFor(() => text().includes('From the photo: Tata Iodised Salt 1 kg'));
    expect(sent.find((r) => r.url.endsWith('/intelligence/recognize'))!.body).toBeInstanceOf(FormData);
    expect((document.getElementById('product-name') as HTMLInputElement).value).toBe('');
    await click(byText('button', 'Use these'));
    expect((document.getElementById('product-name') as HTMLInputElement).value).toBe('Tata Iodised Salt 1 kg');
    expect((document.getElementById('product-category') as HTMLSelectElement).value).toBe(B);
    expect((document.getElementById('product-sold-by') as HTMLSelectElement).value).toBe('kg');
    expect((document.querySelector('input[aria-label="MRP ₹"]') as HTMLInputElement).value).toBe('28.00');
    expect(sent.filter((r) => r.method === 'POST' && r.url.endsWith('/products'))).toHaveLength(0);
  });

  it('says when the shop already sells it, and when the photo could not be read', async () => {
    screen({ read, identified: true, match: { productId: A, variantId: V, name: 'Tata Salt (1 kg)', by: 'barcode', score: 1, isAvailable: true, pricePaise: 2800 }, candidates: [], suggestion: null, note: '' });
    await openForm();
    await choose(document.querySelector('[data-testid="product-photo"]') as HTMLInputElement, photo());
    await waitFor(() => text().includes('You already sell “Tata Salt (1 kg)”.'));
    expect(text()).toContain('The barcode matches it.');
    expect(() => byText('button', 'Use these')).toThrow();
    await cleanup();

    screen({ read: { ...read, confidence: 0.2 }, identified: false, match: null, candidates: [], suggestion: null, note: 'The photo reader is not sure what this is.' });
    await openForm();
    await choose(document.querySelector('[data-testid="product-photo"]') as HTMLInputElement, photo());
    await waitFor(() => text().includes('The photo reader is not sure what this is.'));
  });

  it('shows the server’s refusal when no AI provider is set up', async () => {
    fakeServer([
      ['GET', base('/categories'), () => ({ data: { categories } })],
      ['GET', base('/products'), () => ({ data: { products: [] }, meta: { ...META, total: 0 } })],
      ['POST', base('/intelligence/recognize'), () => ({ status: 503, error: { code: 'AI_UNAVAILABLE', message: 'Reading photos is not available right now (no AI provider is configured). Fill the form in by hand.' } })],
    ]);
    await openForm();
    await choose(document.querySelector('[data-testid="product-photo"]') as HTMLInputElement, photo());
    await waitFor(() => text().includes('Reading photos is not available right now'));
  });

  it('adds a recognised item at the counter', async () => {
    const product = { id: A, name: 'Basmati Rice', description: null, categoryId: null, unit: 'kg', taxPercent: 0, trackInventory: true, isActive: true, images: [], variants: [{ id: V, name: '1 kg', sku: 'R1', barcode: null, pricePaise: 12000, isActive: true, availableQuantity: 5 }] };
    const sent = fakeServer([
      ['GET', base('/categories'), () => ({ data: { categories: [] } })],
      ['GET', base('/products'), () => ({ data: { products: [product] }, meta: META })],
      ['POST', base('/intelligence/recognize'), () => ({ data: { recognition: { read: { ...read, name: 'Basmati Rice' }, identified: true, match: { productId: A, variantId: V, name: 'Basmati Rice (1 kg)', by: 'name', score: 1, isAvailable: true, pricePaise: 12000 }, candidates: [], suggestion: null, note: '' } } })],
    ]);
    await render(<NewSalePage />);
    await waitFor(() => text().includes('Basmati Rice'));
    expect(document.querySelector('button[aria-label="One more"]')).toBeNull();
    await choose(document.querySelector('[data-testid="sale-photo"]') as HTMLInputElement, photo());
    await waitFor(() => text().includes('Added Basmati Rice (1 kg) — check it is the right item.'));
    expect(document.querySelectorAll('.sale-cart-items button[aria-label="One more"]')).toHaveLength(1);
    expect(sent.filter((r) => r.url.endsWith('/sales'))).toHaveLength(0);
  });

  it('says so at the counter when the recognised item is out of stock', async () => {
    const product = { id: A, name: 'Basmati Rice', description: null, categoryId: null, unit: 'kg', taxPercent: 0, trackInventory: true, isActive: true, images: [], variants: [{ id: V, name: '1 kg', sku: 'R1', barcode: null, pricePaise: 12000, isActive: true, availableQuantity: 0 }] };
    fakeServer([
      ['GET', base('/categories'), () => ({ data: { categories: [] } })],
      ['GET', base('/products'), () => ({ data: { products: [product] }, meta: META })],
      ['POST', base('/intelligence/recognize'), () => ({ data: { recognition: { read, identified: true, match: { productId: A, variantId: V, name: 'Basmati Rice (1 kg)', by: 'name', score: 1, isAvailable: true, pricePaise: 12000 }, candidates: [], suggestion: null, note: '' } } })],
    ]);
    await render(<NewSalePage />);
    await waitFor(() => text().includes('Basmati Rice'));
    await choose(document.querySelector('[data-testid="sale-photo"]') as HTMLInputElement, photo());
    await waitFor(() => text().includes('Basmati Rice (1 kg) is out of stock.'));
    expect((document.getElementById('pos-search') as HTMLInputElement).value).toBe('Basmati Rice');
    expect(document.querySelectorAll('.sale-cart-items button[aria-label="One more"]')).toHaveLength(0);
  });
});

describe('reading an invoice from a photo or PDF', () => {
  it('uploads the file and shows the lines read from it for checking', async () => {
    const sent = fakeServer([
      ['GET', base('/purchases'), () => ({ data: { purchases: [] }, meta: { ...META, total: 0 } })],
      ['GET', base('/products'), () => ({ data: { products: [] }, meta: META })],
      ['GET', base('/suppliers'), () => ({ data: { suppliers: [] } })],
      ['POST', base('/intelligence/invoice-file'), () => ({ data: { invoice: { source: 'file', transcript: [], supplier: null, warnings: [], invoiceNumber: 'GW-204', invoiceDate: '2026-10-12', statedTotalPaise: 114000, computedTotalPaise: 114000, totalMatches: true, skipped: [], lines: [
        { source: 'Basmati Rice 1 kg Batch R-91 Exp 08/2027 12 x 95', readAs: { name: 'Basmati Rice 1 kg', quantity: 12, unitCostPaise: 9500, batchNumber: 'R-91', expiresOn: '2027-08-31' }, match: { productId: A, variantId: V, name: 'Basmati Rice (1 kg)', lastCostPaise: 9000 }, confidence: 'high', warnings: [], alternatives: [] },
      ] } } })],
    ]);
    await render(<PurchasesPage />);
    await click(await waitFor(() => byText('button', 'Read an invoice')));
    const input = document.getElementById('inv-file') as HTMLInputElement;
    expect(input.accept).toContain('application/pdf');
    await choose(input, new File(['%PDF-1.4'], 'bill.pdf', { type: 'application/pdf' }));
    await waitFor(() => text().includes('Invoice GW-204'));
    expect(sent.find((r) => r.url.endsWith('/intelligence/invoice-file'))!.body).toBeInstanceOf(FormData);
    expect(text()).toContain('R-91');
    expect(byText('button', 'Use 1 lines')).toBeTruthy();
    expect(sent.filter((r) => r.method === 'POST' && r.url.endsWith('/purchases'))).toHaveLength(0);
  });
});

describe('suggested replacements', () => {
  it('lists the alternatives engine’s picks first, marked', async () => {
    const products = [
      { id: B, name: 'Desi Ghee', isActive: true, variants: [{ id: 'g1', name: 'Default', pricePaise: 60000, isActive: true, availableQuantity: 4 }] },
      { id: 'sona', name: 'Sona Masoori Rice', isActive: true, variants: [{ id: 's1', name: '1 kg', pricePaise: 9000, isActive: true, availableQuantity: 4 }] },
    ];
    fakeServer([
      ['GET', base('/products'), () => ({ data: { products }, meta: META })],
      ['GET', base(`/products/${A}/alternatives`), () => ({ data: { alternatives: { productId: A, items: [{ product: { id: 'sona', name: 'Sona Masoori Rice', pricePaise: 9000, isPurchasable: true }, reason: 'Similar name.', score: 0.6 }] } } })],
    ]);
    const item = { id: 'it1', productId: A, variantId: V, productName: 'Basmati Rice', variantName: '1 kg', quantity: 1, unitPricePaise: 12000 } as any;
    await render(<ProposeSubstitutionModal storeId={S} orderId="o1" item={item} preference="contact_me" onClose={() => undefined} onDone={() => undefined} />);
    await waitFor(() => text().includes('★ Suggested'));
    const options = [...document.querySelectorAll('#sub-variant option')].map((o) => o.textContent);
    expect(options[1]).toMatch(/^★ Sona Masoori Rice/);
    expect(options[2]).toMatch(/^Desi Ghee/);
  });
});
