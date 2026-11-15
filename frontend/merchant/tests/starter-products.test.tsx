import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, click, byLabel, byText, fakeServer, render, text, type, waitFor } from './helpers/render';
import ProductsPage from '../src/features/products/ProductsPage';

/**
 * The first visit to Products in a new shop: the basics for its kind of shop,
 * added in one go at the owner's prices, with optional opening stock and
 * expiry. Only while the shop has no products and the owner has not chosen to
 * add their own.
 */

const S = '11111111-1111-4111-8111-111111111111';

vi.mock('../src/hooks/useStore', () => ({ useActiveStore: () => ({ activeStoreId: S, setActiveStoreId: () => undefined }) }));

/** The starter cards' inputs are named by aria-label. */
const field = <T extends HTMLElement = HTMLInputElement>(name: string) => {
  const el = document.querySelector<T>(`[aria-label="${name}"]`);
  if (!el) throw new Error(`No field named ${name}`);
  return el;
};

const base = (path: string) => new RegExp(`^/merchant/stores/${S}${path}$`);
const META = (total: number) => ({ page: 1, limit: 20, total, totalPages: 1, hasNextPage: false });

const TEMPLATES = [
  { industry: 'bakery', label: 'Bakery & Sweets', categoryCount: 7, productCount: 3, defaults: {} },
  { industry: 'hardware', label: 'Hardware & Paints', categoryCount: 6, productCount: 1, defaults: {} },
];
const BAKERY = {
  industry: 'bakery', label: 'Bakery & Sweets', categories: ['Breads', 'Dairy & Eggs', 'Biscuits & Rusk'],
  defaults: { lowStockThreshold: 5, taxPercent: 5, trackInventory: true, expiryAlertDays: 2 },
  products: [
    { key: 'milk', name: 'Toned Milk', category: 'Dairy & Eggs', unit: 'ml', taxPercent: 0, variants: [{ name: '500 ml', suggestedPricePaise: 2800, weightGrams: null }] },
    { key: 'white-bread', name: 'White Bread', category: 'Breads', unit: 'pcs', taxPercent: 0, variants: [{ name: '400 g loaf', suggestedPricePaise: 4500, weightGrams: 400 }] },
    { key: 'glucose-biscuits', name: 'Glucose Biscuits', category: 'Biscuits & Rusk', unit: 'pack', taxPercent: 18, variants: [{ name: 'Small pack', suggestedPricePaise: 1000, weightGrams: null }] },
  ],
};
const HARDWARE = {
  industry: 'hardware', label: 'Hardware & Paints', categories: ['Hand Tools'],
  defaults: { lowStockThreshold: 5, taxPercent: 18, trackInventory: true, expiryAlertDays: 0 },
  products: [{ key: 'hammer', name: 'Claw Hammer', category: 'Hand Tools', unit: 'pcs', taxPercent: 18, variants: [{ name: '500 g', suggestedPricePaise: 38000, weightGrams: null }] }],
};

const product = (id: string, name: string) => ({
  id, name, description: null, categoryId: null, categoryName: null, unit: 'pcs', taxPercent: 0, trackInventory: true,
  lowStockThreshold: 5, isActive: true, images: [], pricePaise: 1000, stock: { availableQuantity: 0 }, isLowStock: false,
  variants: [{ id: `${id}-v`, name: 'Default', sku: null, barcode: null, weightGrams: null, pricePaise: 1000, mrpPaise: null, costPaise: null, isActive: true, availableQuantity: 0 }],
});

function server({ shopCategory = 'bakery', products = [] as unknown[] } = {}) {
  let list = products;
  const sent = fakeServer([
    ['GET', base(''), () => ({ data: { store: { id: S, name: 'Corner Bakery', shopCategory } } })],
    ['GET', base('/categories'), () => ({ data: { categories: [] } })],
    ['GET', base('/products'), () => ({ data: { products: list }, meta: META(list.length) })],
    ['GET', /^\/merchant\/templates$/, () => ({ data: { templates: TEMPLATES } })],
    ['GET', /^\/merchant\/templates\/bakery$/, () => ({ data: { template: BAKERY } })],
    ['GET', /^\/merchant\/templates\/hardware$/, () => ({ data: { template: HARDWARE } })],
    ['POST', base('/templates/apply'), (req) => {
      list = req.body.products.map((p: { key: string }, i: number) => product(`p${i}`, p.key));
      return { status: 201, data: { report: { categoriesCreated: [], categoriesSkipped: [], productsCreated: req.body.products.map((p: { key: string }) => ({ key: p.key, productId: 'x', name: p.key })), productsSkipped: [], failed: [] } } };
    }],
  ]);
  return sent;
}

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

describe('starter products for a new shop', () => {
  it('offers the basics for the kind of shop, prefilled with suggested prices', async () => {
    server();
    await render(<ProductsPage />);
    await waitFor(() => text().includes('Start with the basics for your bakery & sweets shop'));
    expect(text()).toContain('Toned Milk');
    expect(text()).toContain('White Bread');
    expect((field('Toned Milk 500 ml price')).value).toBe('28.00');
    expect(byText('button', 'Add 3 products')).toBeTruthy();
  });

  it('adds the ticked products at the owner’s prices, with opening stock and expiry', async () => {
    const sent = server();
    await render(<ProductsPage />);
    await waitFor(() => text().includes('Toned Milk'));
    await type(field('Toned Milk 500 ml price'), '30');
    await type(field('Toned Milk 500 ml opening stock'), '20');
    await type(field('Toned Milk 500 ml expiry date'), '2099-01-02');
    await click(field('Add Glucose Biscuits'));
    await click(byText('button', 'Add 2 products'));
    await waitFor(() => text().includes('2 products added.'));
    expect(sent.find((r) => r.method === 'POST')!.body).toEqual({
      industry: 'bakery',
      applyDefaults: false,
      categories: [],
      products: [
        { key: 'milk', prices: { '500 ml': 3000 }, stock: { '500 ml': { quantity: 20, expiresOn: '2099-01-02' } } },
        { key: 'white-bread', prices: { '400 g loaf': 4500 } },
      ],
    });
  });

  it('catches a missing price and an expiry without stock before sending', async () => {
    const sent = server();
    await render(<ProductsPage />);
    await waitFor(() => text().includes('Toned Milk'));
    await type(field('White Bread 400 g loaf price'), '');
    await click(byText('button', 'Add 3 products'));
    await waitFor(() => text().includes('Enter a price for White Bread (400 g loaf).'));
    await type(field('White Bread 400 g loaf price'), '45');
    await type(field('Toned Milk 500 ml expiry date'), '2099-01-02');
    await click(byText('button', 'Add 3 products'));
    await waitFor(() => text().includes('Add how many Toned Milk (500 ml) you have, or clear its expiry date.'));
    expect(sent.some((r) => r.method === 'POST')).toBe(false);
  });

  it('works for every kind of shop: a hardware shop gets its own list and no expiry dates', async () => {
    server({ shopCategory: 'hardware' });
    await render(<ProductsPage />);
    await waitFor(() => text().includes('Claw Hammer'));
    expect(text()).toContain('Start with the basics for your hardware & paints shop');
    expect(document.querySelector('input[type="date"]')).toBeNull();
  });

  it('lets a shop of type "other" pick its kind of shop', async () => {
    server({ shopCategory: 'other' });
    await render(<ProductsPage />);
    await waitFor(() => text().includes('Start with the basics for your shop'));
    await type(byLabel('Kind of shop') as HTMLSelectElement, 'hardware');
    await waitFor(() => text().includes('Claw Hammer'));
  });

  it('"I’ll add my own" hides it for good, leaving the usual empty page', async () => {
    server();
    await render(<ProductsPage />);
    await waitFor(() => text().includes('Toned Milk'));
    await click(byText('button', 'I\'ll add my own'));
    await waitFor(() => text().includes('No products yet'));
    expect(window.localStorage.getItem(`cpse.merchant.starterProducts.dismissed.${S}`)).toBe('1');
    await cleanup();
    server();
    await render(<ProductsPage />);
    await waitFor(() => text().includes('No products yet'));
    expect(text()).not.toContain('Start with the basics');
  });

  it('is not shown once the shop has products', async () => {
    server({ products: [product('p1', 'Cake')] });
    await render(<ProductsPage />);
    await waitFor(() => text().includes('1 products'));
    expect(text()).not.toContain('Start with the basics');
  });
});
