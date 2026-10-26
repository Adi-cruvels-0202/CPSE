import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { cleanup, click, byLabel, byText, fakeServer, render, text, type, waitFor } from './helpers/render';
import NewSalePage from '../src/features/sales/NewSalePage';
import InventoryPage from '../src/features/inventory/InventoryPage';
import ProductsPage from '../src/features/products/ProductsPage';

/**
 * Barcodes end to end on the screens: a scan at the counter goes into the
 * bill, a new pack's code becomes a new product, Receive stock finds the
 * product by its code, and product forms take, check and keep barcodes.
 */

const S = '11111111-1111-4111-8111-111111111111';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const N = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const V = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const NV = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

vi.mock('../src/hooks/useStore', () => ({ useActiveStore: () => ({ activeStoreId: S, setActiveStoreId: () => undefined }) }));

const base = (path: string) => new RegExp(`^/merchant/stores/${S}${path}$`);
const META = (total: number) => ({ page: 1, limit: 100, total, totalPages: 1, hasNextPage: false });
const rice = (available = 5) => ({
  id: A, slug: 'basmati-rice', name: 'Basmati Rice', description: null, categoryId: null, unit: 'kg', taxPercent: 0, trackInventory: true, isActive: true, images: [],
  variants: [{ id: V, name: '1 kg', sku: 'R1', barcode: '8901234567890', pricePaise: 12000, mrpPaise: null, costPaise: 9000, isActive: true, quantityOnHand: available, reservedQuantity: 0, availableQuantity: available, isLowStock: false }],
});
const enter = async (input: HTMLInputElement, value: string) => {
  await type(input, value);
  await act(async () => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
};
const cartLines = () => document.querySelectorAll('.sale-cart-items button[aria-label="One more"]').length;

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

describe('at the counter', () => {
  it('a scanner (or typing) the barcode puts the item in the bill', async () => {
    fakeServer([
      ['GET', base('/categories'), () => ({ data: { categories: [] } })],
      ['GET', base('/products'), () => ({ data: { products: [rice()] }, meta: META(1) })],
    ]);
    await render(<NewSalePage />);
    await waitFor(() => text().includes('Basmati Rice'));
    expect(cartLines()).toBe(0);
    await enter(document.getElementById('pos-search') as HTMLInputElement, '8901234567890');
    await waitFor(() => cartLines() === 1);
    expect((document.getElementById('pos-search') as HTMLInputElement).value).toBe('');
  });

  it('says so instead of selling an item that is out of stock', async () => {
    fakeServer([
      ['GET', base('/categories'), () => ({ data: { categories: [] } })],
      ['GET', base('/products'), () => ({ data: { products: [rice(0)] }, meta: META(1) })],
    ]);
    await render(<NewSalePage />);
    await waitFor(() => text().includes('Basmati Rice'));
    await enter(document.getElementById('pos-search') as HTMLInputElement, '8901234567890');
    await waitFor(() => text().includes('Basmati Rice (1 kg) is out of stock.'));
    expect(cartLines()).toBe(0);
  });

  it('turns an unknown code into a new product with that barcode, then sells it', async () => {
    let products = [rice()];
    const sent = fakeServer([
      ['GET', base('/categories'), () => ({ data: { categories: [] } })],
      ['GET', base('/products'), () => ({ data: { products }, meta: META(products.length) })],
      ['GET', base('/product-lookup'), () => ({ status: 404, error: { code: 'NOT_FOUND', message: 'Product not found.' } })],
      ['POST', base('/products'), (req) => {
        const created = { ...rice(), id: N, slug: 'tata-salt', name: req.body.name, variants: [{ ...rice().variants[0], id: NV, name: 'Default', sku: 'S1', barcode: req.body.variants[0].barcode, pricePaise: req.body.variants[0].pricePaise, quantityOnHand: 12, availableQuantity: 12 }] };
        products = [...products, created];
        return { status: 201, data: { product: created } };
      }],
    ]);
    await render(<NewSalePage />);
    await waitFor(() => text().includes('Basmati Rice'));
    await enter(document.getElementById('pos-search') as HTMLInputElement, '8904043901015');
    await waitFor(() => text().includes("isn't on any of your products yet"));
    await click(byText('button', 'Add as new product'));
    const barcode = await waitFor(() => document.getElementById('new-barcode-0') as HTMLInputElement);
    expect(barcode.value).toBe('8904043901015');
    await type(document.getElementById('product-name') as HTMLInputElement, 'Tata Salt');
    await type(document.querySelector('input[aria-label="Price ₹"]') as HTMLInputElement, '28');
    await type(document.querySelector('input[aria-label="Opening stock"]') as HTMLInputElement, '12');
    await click(byText('button', 'Create product'));
    await waitFor(() => text().includes('Tata Salt saved and added to the bill.'));
    expect(sent.find((r) => r.method === 'POST' && /\/products$/.test(r.url))!.body.variants[0]).toMatchObject({ barcode: '8904043901015', pricePaise: 2800, openingQuantity: 12 });
    expect(cartLines()).toBe(1);
  });
});

describe('receiving stock', () => {
  const routes = () => fakeServer([
    ['GET', base('/products'), () => ({ data: { products: [rice()] }, meta: META(1) })],
    ['GET', base('/product-lookup'), () => ({ status: 404, error: { code: 'NOT_FOUND', message: 'Product not found.' } })],
    ['POST', base('/inventory/stock-in'), () => ({ status: 201, data: { movement: { id: 'm1' } } })],
  ]);

  it('finds the product by its scanned code, fills in the cost and waits for the quantity', async () => {
    const sent = routes();
    await render(<InventoryPage />);
    await click(await waitFor(() => byText('button', 'Receive stock')));
    await enter(document.getElementById('stock-scan') as HTMLInputElement, '8901234567890');
    await waitFor(() => text().includes('Found Basmati Rice (1 kg). Enter the quantity.'));
    expect((document.getElementById('stock-product') as HTMLSelectElement).value).toBe(V);
    expect((byLabel('Cost per unit ₹ (optional)') as HTMLInputElement).value).toBe('90.00');
    await waitFor(() => document.activeElement?.id === 'stock-quantity');
    await type(document.getElementById('stock-quantity') as HTMLInputElement, '24');
    await click(document.querySelector('.dialog-footer button[type="submit"]')!);
    await waitFor(() => sent.some((r) => r.url.endsWith('/stock-in')));
    expect(sent.find((r) => r.url.endsWith('/stock-in'))!.body).toMatchObject({ variantId: V, quantity: 24, unitCostPaise: 9000 });
  });

  it('still lets you choose from the list, and offers to add an unknown code', async () => {
    routes();
    await render(<InventoryPage />);
    await click(await waitFor(() => byText('button', 'Receive stock')));
    expect(text()).toContain('Or choose it from the list below.');
    await enter(document.getElementById('stock-scan') as HTMLInputElement, '8904043901015');
    await waitFor(() => text().includes('No product has barcode 8904043901015.'));
    expect(byText('a', 'Add as new product').getAttribute('href')).toBe('/products?new=1&barcode=8904043901015');
  });
});

describe('product forms', () => {
  it('takes a barcode for a new product and warns at once when another product has it', async () => {
    const sent = fakeServer([
      ['GET', base('/categories'), () => ({ data: { categories: [] } })],
      ['GET', base('/products'), () => ({ data: { products: [] }, meta: META(0) })],
      ['GET', base('/product-lookup'), (req) => (req.params?.barcode === '8901234567890'
        ? { data: { product: rice(), variant: rice().variants[0] } }
        : { status: 404, error: { code: 'NOT_FOUND', message: 'Product not found.' } })],
      ['POST', base('/products'), (req) => ({ status: 201, data: { product: { ...rice(), id: N, name: req.body.name } } })],
    ]);
    await render(<ProductsPage />);
    await click(await waitFor(() => byText('button', 'Add product')));
    const barcode = document.getElementById('new-barcode-0') as HTMLInputElement;
    await enter(barcode, '8901234567890');
    await waitFor(() => text().includes('Already on Basmati Rice (1 kg)'));
    await enter(barcode, '8904043901015');
    await waitFor(() => !text().includes('Already on'));
    await type(document.getElementById('product-name') as HTMLInputElement, 'Tata Salt');
    await type(document.querySelector('input[aria-label="Price ₹"]') as HTMLInputElement, '28');
    await click(byText('button', 'Create product'));
    await waitFor(() => sent.some((r) => r.method === 'POST'));
    expect(sent.find((r) => r.method === 'POST')!.body.variants[0].barcode).toBe('8904043901015');
  });

  it('keeps the barcode the photo reader saw on the pack', async () => {
    fakeServer([
      ['GET', base('/categories'), () => ({ data: { categories: [] } })],
      ['GET', base('/products'), () => ({ data: { products: [] }, meta: META(0) })],
      ['GET', base('/product-lookup'), () => ({ status: 404, error: { code: 'NOT_FOUND', message: 'x' } })],
      ['POST', base('/intelligence/recognize'), () => ({ data: { recognition: {
        read: { isProduct: true, name: 'Iodised Salt', brand: 'Tata', sizeText: '1 kg', category: 'Salt', barcode: '8904043901015', mrpPaise: 2800, weightGrams: 1000, confidence: 0.95 },
        identified: true, match: null, candidates: [], note: '',
        suggestion: { name: 'Tata Iodised Salt 1 kg', category: null, unit: null, taxPercent: null, weightGrams: 1000, mrpPaise: 2800, barcode: '8904043901015', duplicates: [] },
      } } })],
    ]);
    await render(<ProductsPage />);
    await click(await waitFor(() => byText('button', 'Add product')));
    const photo = document.querySelector('[data-testid="product-photo"]') as HTMLInputElement;
    Object.defineProperty(photo, 'files', { value: [new File(['x'], 'pack.jpg', { type: 'image/jpeg' })], configurable: true });
    await act(async () => { photo.dispatchEvent(new Event('change', { bubbles: true })); });
    await click(await waitFor(() => byText('button', 'Use these')));
    expect((document.getElementById('new-barcode-0') as HTMLInputElement).value).toBe('8904043901015');
  });
});

describe('the CPSE product library', () => {
  const SALT = '8904043901015';
  const CAT = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  const library = (found = true) => ({ data: { library: found ? {
    barcode: SALT, found: true, shops: 3, agreeing: 2, note: 'x',
    suggestion: { name: 'Tata Salt', optionName: '1 kg', unit: 'kg', taxPercent: 5, mrpPaise: 2800, weightGrams: 1000, category: { name: 'Salt & Sugar', id: CAT } },
  } : { barcode: SALT, found: false, suggestion: null } } });

  it('at the counter: a pack another shop sells arrives filled in, leaving only price and stock', async () => {
    const sent = fakeServer([
      ['GET', base('/categories'), () => ({ data: { categories: [{ id: CAT, name: 'Salt & Sugar', description: null, productCount: 0, isActive: true, sortOrder: 0 }] } })],
      ['GET', base('/products'), () => ({ data: { products: [rice()] }, meta: META(1) })],
      ['GET', base('/product-lookup'), () => ({ status: 404, error: { code: 'NOT_FOUND', message: 'x' } })],
      ['GET', base('/barcode-library'), () => library()],
      ['POST', base('/products'), (req) => ({ status: 201, data: { product: { ...rice(), id: N, name: req.body.name, variants: [{ ...rice().variants[0], id: NV, name: '1 kg', barcode: SALT, quantityOnHand: 10, availableQuantity: 10 }] } } })],
    ]);
    await render(<NewSalePage />);
    await waitFor(() => text().includes('Basmati Rice'));
    await enter(document.getElementById('pos-search') as HTMLInputElement, SALT);
    await waitFor(() => text().includes('Tata Salt (1 kg) isn\'t in your products yet — CPSE already knows it'));
    await click(byText('button', 'Add to my products'));
    await waitFor(() => text().includes('Filled in from the CPSE product library'));
    expect(text()).toContain('2 of 3 shops agree');
    expect((document.getElementById('product-name') as HTMLInputElement).value).toBe('Tata Salt');
    expect((document.getElementById('product-sold-by') as HTMLSelectElement).value).toBe('kg');
    expect((document.getElementById('product-gst') as HTMLSelectElement).value).toBe('5');
    expect((document.getElementById('product-category') as HTMLSelectElement).value).toBe(CAT);
    expect((document.querySelector('input[aria-label="Option 1 name"]') as HTMLInputElement).value).toBe('1 kg');
    expect((document.querySelector('input[aria-label="MRP ₹, option 1"]') as HTMLInputElement).value).toBe('28.00');
    // Only this shop's own numbers are left.
    await type(document.querySelector('input[aria-label="Price ₹, option 1"]') as HTMLInputElement, '26');
    await type(document.querySelector('input[aria-label="Opening stock, option 1"]') as HTMLInputElement, '10');
    await click(byText('button', 'Create product'));
    await waitFor(() => text().includes('Tata Salt saved and added to the bill.'));
    const body = sent.find((r) => r.method === 'POST' && /\/products$/.test(r.url))!.body;
    expect(body).toMatchObject({ name: 'Tata Salt', unit: 'kg', taxPercent: 5, categoryId: CAT });
    expect(body.variants[0]).toMatchObject({ name: '1 kg', barcode: SALT, pricePaise: 2600, mrpPaise: 2800, openingQuantity: 10 });
  });

  it('in Receive stock: says CPSE knows the pack and offers to add it', async () => {
    fakeServer([
      ['GET', base('/products'), () => ({ data: { products: [rice()] }, meta: META(1) })],
      ['GET', base('/product-lookup'), () => ({ status: 404, error: { code: 'NOT_FOUND', message: 'x' } })],
      ['GET', base('/barcode-library'), () => library()],
    ]);
    await render(<InventoryPage />);
    await click(await waitFor(() => byText('button', 'Receive stock')));
    await enter(document.getElementById('stock-scan') as HTMLInputElement, SALT);
    await waitFor(() => text().includes('Tata Salt (1 kg) isn\'t in your products yet — CPSE already knows it.'));
    expect(byText('a', 'Add to my products').getAttribute('href')).toBe(`/products?new=1&barcode=${SALT}`);
  });

  it('never overwrites a name the owner already typed, and says nothing when no shop has the code', async () => {
    const sent = fakeServer([
      ['GET', base('/categories'), () => ({ data: { categories: [] } })],
      ['GET', base('/products'), () => ({ data: { products: [] }, meta: META(0) })],
      ['GET', base('/product-lookup'), () => ({ status: 404, error: { code: 'NOT_FOUND', message: 'x' } })],
      ['GET', base('/barcode-library'), (req) => library(req.params?.barcode === SALT)],
    ]);
    await render(<ProductsPage />);
    await click(await waitFor(() => byText('button', 'Add product')));
    await type(document.getElementById('product-name') as HTMLInputElement, 'My own salt');
    await enter(document.getElementById('new-barcode-0') as HTMLInputElement, SALT);
    await act(async () => undefined);
    expect((document.getElementById('product-name') as HTMLInputElement).value).toBe('My own salt');
    expect(sent.some((r) => r.url.endsWith('/barcode-library'))).toBe(false);
    await type(document.getElementById('product-name') as HTMLInputElement, '');
    await enter(document.getElementById('new-barcode-0') as HTMLInputElement, '5000000000001');
    await waitFor(() => sent.some((r) => r.url.endsWith('/barcode-library')));
    expect(text()).not.toContain('Filled in from the CPSE product library');
    expect((document.getElementById('product-name') as HTMLInputElement).value).toBe('');
  });
});
