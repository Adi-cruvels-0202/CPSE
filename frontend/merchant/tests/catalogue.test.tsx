import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { cleanup, click, byText, fakeServer, render, text, type, waitFor } from './helpers/render';
import CategoriesPage from '../src/features/categories/CategoriesPage';
import NewSalePage from '../src/features/sales/NewSalePage';
import ProductsPage from '../src/features/products/ProductsPage';

/**
 * Catalogue upkeep on the existing screens (roadmap §4 P1): ordering and
 * deleting categories, duplicating a product, and scanning a barcode at the
 * counter.
 */

const S = '11111111-1111-4111-8111-111111111111';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const V = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

vi.mock('../src/hooks/useStore', () => ({ useActiveStore: () => ({ activeStoreId: S, setActiveStoreId: () => undefined }) }));

const base = (path: string) => new RegExp(`^/merchant/stores/${S}${path}$`);
const META = (total: number) => ({ page: 1, limit: 100, total, totalPages: 1, hasNextPage: false });
const category = (id: string, name: string, productCount: number) => ({ id, name, description: null, productCount, isActive: true, sortOrder: 0 });

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

describe('categories', () => {
  it('moves a category down by sending the whole new order', async () => {
    let order = [category(A, 'Staples', 3), category(B, 'Snacks', 0), category(C, 'Dairy', 2)];
    const sent = fakeServer([
      ['GET', base('/categories'), () => ({ data: { categories: order } })],
      ['PUT', base('/categories/order'), (req) => { order = req.body.categoryIds.map((id: string) => order.find((c) => c.id === id)!); return { data: { ok: true } }; }],
    ]);
    await render(<CategoriesPage />);
    await waitFor(() => text().includes('Staples'));
    expect(byText('button', '↑').closest('tr')!.textContent).toContain('Staples');
    expect((document.querySelector('button[aria-label="Move Staples up"]') as HTMLButtonElement).disabled).toBe(true);
    await click(document.querySelector('button[aria-label="Move Staples down"]')!);
    expect(sent.find((r) => r.method === 'PUT')!.body).toEqual({ categoryIds: [B, A, C] });
    await waitFor(() => document.querySelector('tbody tr')!.textContent!.includes('Snacks'));
  });

  it('deleting a category with products asks where they go', async () => {
    const sent = fakeServer([
      ['GET', base('/categories'), () => ({ data: { categories: [category(A, 'Staples', 3), category(C, 'Dairy', 2)] } })],
      ['DELETE', base(`/categories/${A}`), () => ({ data: { movedProducts: 3 } })],
    ]);
    await render(<CategoriesPage />);
    await waitFor(() => text().includes('Staples'));
    await click(document.querySelector('button[aria-label="Delete Staples"]')!);
    expect(text()).toContain('It has 3 products. Move them to');
    await click(byText('button', 'Delete'));
    expect(sent.find((r) => r.method === 'DELETE')!.body).toEqual({ moveToCategoryId: C });
    await waitFor(() => text().includes('3 products moved'));
  });

  it('can leave the products without a category, and shows a refusal', async () => {
    const sent = fakeServer([
      ['GET', base('/categories'), () => ({ data: { categories: [category(A, 'Staples', 3), category(C, 'Dairy', 2)] } })],
      ['DELETE', base(`/categories/${A}`), () => ({ status: 409, error: { code: 'CATEGORY_NOT_EMPTY', message: 'Staples still has 3 products.' } })],
    ]);
    await render(<CategoriesPage />);
    await waitFor(() => text().includes('Staples'));
    await click(document.querySelector('button[aria-label="Delete Staples"]')!);
    await type(document.getElementById('cat-move') as HTMLSelectElement, '');
    await click(byText('button', 'Delete'));
    expect(sent.find((r) => r.method === 'DELETE')!.body).toEqual({ uncategorise: true });
    await waitFor(() => text().includes('Staples still has 3 products.'));
    expect(text()).toContain('Delete Staples?');
  });
});

const product = (over: Record<string, unknown> = {}) => ({
  id: A, name: 'Basmati Rice', description: null, categoryId: null, categoryName: null, unit: 'pack', taxPercent: 5, trackInventory: true,
  lowStockThreshold: 5, isActive: true, images: [], pricePaise: 12000, stock: { availableQuantity: 10 }, isLowStock: false,
  variants: [{ id: V, name: '1 kg', sku: 'RICE-1KG', barcode: '8901234567890', weightGrams: 1000, pricePaise: 12000, mrpPaise: null, costPaise: null, isActive: true, availableQuantity: 10 }],
  ...over,
});

describe('counter sale barcode scan', () => {
  const scan = async (code: string) => {
    const input = document.getElementById('pos-search') as HTMLInputElement;
    await type(input, code);
    await act(async () => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    await waitFor(() => true);
  };

  it('adds the item whose barcode was scanned, without a server call', async () => {
    const sent = fakeServer([
      ['GET', base('/categories'), () => ({ data: { categories: [] } })],
      ['GET', base('/products'), () => ({ data: { products: [product()] }, meta: META(1) })],
    ]);
    await render(<NewSalePage />);
    await waitFor(() => text().includes('Basmati Rice'));
    const before = sent.length;
    await scan('8901234567890');
    await waitFor(() => (document.getElementById('pos-search') as HTMLInputElement).value === '');
    expect(sent.length).toBe(before);
    expect(text()).toMatch(/₹126\.00/); // 120 + 5% GST
  });

  it('looks up a code it has not loaded, and offers to add a code nothing matches', async () => {
    const fresh = product({ id: B, name: 'Toor Dal', variants: [{ ...product().variants[0], id: C, name: 'Default', sku: 'DAL', barcode: '8909999999999', pricePaise: 15000 }] });
    const sent = fakeServer([
      ['GET', base('/categories'), () => ({ data: { categories: [] } })],
      ['GET', base('/products'), () => ({ data: { products: [product()] }, meta: META(1) })],
      ['GET', base('/product-lookup'), (req) => req.params.barcode === '8909999999999'
        ? { data: { product: fresh, variant: fresh.variants[0] } }
        : { status: 404, error: { code: 'NOT_FOUND', message: 'No product has that barcode.' } }],
    ]);
    await render(<NewSalePage />);
    await waitFor(() => text().includes('Basmati Rice'));
    await scan('8909999999999');
    await waitFor(() => text().includes('Toor Dal'));
    expect(sent.find((r) => r.url.endsWith('/product-lookup'))!.params).toEqual({ barcode: '8909999999999' });
    await scan('0000');
    await waitFor(() => text().includes("0000 isn't on any of your products yet."));
    expect(byText('button', 'Add as new product')).toBeTruthy();
  });
});

describe('duplicate product', () => {
  it('copies a product and tells the merchant the copy is hidden', async () => {
    const sent = fakeServer([
      ['GET', base('/categories'), () => ({ data: { categories: [] } })],
      ['GET', base('/products'), () => ({ data: { products: [product()] }, meta: { ...META(1), limit: 20 } })],
      ['POST', base(`/products/${A}/duplicate`), () => ({ status: 201, data: { product: product({ id: B, name: 'Basmati Rice (Copy)', isActive: false }) } })],
      ['GET', base(`/products/${B}`), () => ({ data: { product: product({ id: B, name: 'Basmati Rice (Copy)', isActive: false }) } })],
    ]);
    await render(<ProductsPage />);
    await waitFor(() => text().includes('Basmati Rice'));
    await click(document.querySelector('button[aria-label="Duplicate Basmati Rice"]')!);
    expect(sent.some((r) => r.method === 'POST' && r.url.endsWith(`/products/${A}/duplicate`))).toBe(true);
    await waitFor(() => text().includes('Copied as “Basmati Rice (Copy)” — hidden until you make it available.'));
  });
});

describe('starter templates and defaults', () => {
  it('adds chosen template products at the merchant’s own prices and reports what was skipped', async () => {
    const { default: CatalogueToolsPage } = await import('../src/features/tools/CatalogueToolsPage');
    const template = {
      industry: 'grocery', label: 'Grocery', defaults: { lowStockThreshold: 5, taxPercent: 5, trackInventory: true, expiryAlertDays: 7 },
      categories: ['Staples', 'Dairy'],
      products: [
        { key: 'rice', name: 'Rice', category: 'Staples', unit: 'kg', taxPercent: 5, variants: [{ name: '1 kg', suggestedPricePaise: 6000, weightGrams: 1000 }, { name: '5 kg', suggestedPricePaise: 28000, weightGrams: 5000 }] },
        { key: 'milk', name: 'Milk', category: 'Dairy', unit: 'l', taxPercent: 0, variants: [{ name: '500 ml', suggestedPricePaise: 3000, weightGrams: null }] },
      ],
    };
    const sent = fakeServer([
      ['GET', /^\/merchant\/templates$/, () => ({ data: { templates: [{ industry: 'grocery', label: 'Grocery', categoryCount: 2, productCount: 2, defaults: {} }] } })],
      ['GET', /^\/merchant\/templates\/grocery$/, () => ({ data: { template } })],
      ['POST', base('/templates/apply'), () => ({ data: { report: { categoriesCreated: ['Dairy'], categoriesSkipped: ['Staples'], productsCreated: [{ key: 'rice', productId: A, name: 'Rice' }], productsSkipped: [], failed: [] } } })],
    ]);
    await render(<CatalogueToolsPage />);
    await click(await waitFor(() => byText('button', /Grocery/)));
    await waitFor(() => text().includes('Categories: Staples, Dairy'));
    await click(document.querySelector('input[aria-label="Add Rice"]')!);
    await type(document.querySelector('input[aria-label="Rice 5 kg price"]') as HTMLInputElement, '265');
    await click(byText('button', 'Add categories and 1 product'));
    expect(sent.find((r) => r.method === 'POST')!.body).toEqual({ industry: 'grocery', applyDefaults: true, categories: 'all', products: [{ key: 'rice', prices: { '5 kg': 26500 } }] });
    await waitFor(() => text().includes('Already there (skipped): Staples'));
  });

  it('saves catalogue defaults for new products', async () => {
    const { default: CatalogueToolsPage } = await import('../src/features/tools/CatalogueToolsPage');
    const sent = fakeServer([
      ['GET', /^\/merchant\/templates$/, () => ({ data: { templates: [] } })],
      ['GET', base('/defaults'), () => ({ data: { defaults: { lowStockThreshold: null, taxPercent: 0, trackInventory: true, expiryAlertDays: 7, templateApplied: null } } })],
      ['PUT', base('/defaults'), (req) => ({ data: { defaults: { ...req.body, templateApplied: null } } })],
    ]);
    await render(<CatalogueToolsPage />);
    await click(byText('button', 'Defaults'));
    await waitFor(() => document.getElementById('df-tax'));
    await type(document.getElementById('df-tax') as HTMLSelectElement, '12');
    await type(document.getElementById('df-low') as HTMLInputElement, '3');
    await click(byText('button', 'Save defaults'));
    expect(sent.find((r) => r.method === 'PUT')!.body).toEqual({ lowStockThreshold: 3, taxPercent: 12, trackInventory: true, expiryAlertDays: 7 });
    await waitFor(() => text().includes('Defaults saved'));
  });
});
