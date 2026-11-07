/**
 * Barcodes on products (migration 0040: one barcode is one physical product in
 * a store) against real Postgres: saved on new products and options, found by
 * the scan lookup, a clash named, and cleared on request.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../src/lib/supabase.js', async () => {
  const { createPgSupabase } = await import('../helpers/pgSupabase.js');
  return createPgSupabase();
});

const { resetDatabase } = await import('../helpers/pgSupabase.js');
const flow = await import('./flow.js');
const { call, expectStatus } = flow;

beforeEach(async () => {
  await resetDatabase();
});

const base = (shop) => `/merchant/stores/${shop.store.id}`;

describe('barcodes', () => {
  it('saves a scanned barcode on a new product, and the scan lookup finds it', async () => {
    const shop = await flow.openShop();
    const { product } = expectStatus(await call('post', `${base(shop)}/products`, shop.merchant, {
      name: 'Tata Salt', unit: 'pcs', variants: [{ name: 'Default', pricePaise: 2800, barcode: '8904043901015', openingQuantity: 12 }],
    }), 201);
    expect(product.variants[0].barcode).toBe('8904043901015');

    const found = expectStatus(await call('get', `${base(shop)}/product-lookup?barcode=8904043901015`, shop.merchant), 200);
    expect(found).toMatchObject({ product: { id: product.id }, variant: { availableQuantity: 12 } });
    expect((await call('get', `${base(shop)}/product-lookup?barcode=0000000000000`, shop.merchant)).status).toBe(404);
  });

  it('names the product that already has a barcode, on create, new option and edit', async () => {
    const shop = await flow.openShop();
    const rice = await flow.addRice(shop);
    expectStatus(await call('patch', `${base(shop)}/products/${rice.product.id}/variants/${rice.kg.id}`, shop.merchant, { barcode: '8901234567890' }), 200);

    const onCreate = await call('post', `${base(shop)}/products`, shop.merchant, { name: 'New Rice', variants: [{ name: 'Default', pricePaise: 100, barcode: '8901234567890' }] });
    expect(onCreate.status).toBe(409);
    expect(onCreate.body.error).toMatchObject({ code: 'BARCODE_TAKEN', message: 'Basmati Rice (1 kg) already has barcode 8901234567890.' });
    expect(onCreate.body.error.details).toMatchObject({ productId: rice.product.id, variantId: rice.kg.id });

    const onOption = await call('post', `${base(shop)}/products/${rice.product.id}/variants`, shop.merchant, { name: '2 kg', pricePaise: 100, barcode: '8901234567890' });
    expect(onOption.body.error.code).toBe('BARCODE_TAKEN');
    const onEdit = await call('patch', `${base(shop)}/products/${rice.product.id}/variants/${rice.halfKg.id}`, shop.merchant, { barcode: '8901234567890' });
    expect(onEdit.body.error.message).toMatch(/Basmati Rice \(1 kg\)/);

    const twice = await call('post', `${base(shop)}/products`, shop.merchant, { name: 'Twins', variants: [{ name: 'A', pricePaise: 1, barcode: '111222333' }, { name: 'B', pricePaise: 1, barcode: '111222333' }] });
    expect(twice.status).toBe(422);
  });

  it('lets an option keep its own barcode when edited, and clears it on request', async () => {
    const shop = await flow.openShop();
    const rice = await flow.addRice(shop);
    const path = `${base(shop)}/products/${rice.product.id}/variants/${rice.kg.id}`;
    expectStatus(await call('patch', path, shop.merchant, { barcode: '8901234567890' }), 200);
    expectStatus(await call('patch', path, shop.merchant, { barcode: '8901234567890', pricePaise: 12500 }), 200);
    const cleared = expectStatus(await call('patch', path, shop.merchant, { barcode: null }), 200);
    expect(cleared.product.variants.find((v) => v.id === rice.kg.id).barcode).toBeNull();
    expect((await call('get', `${base(shop)}/product-lookup?barcode=8901234567890`, shop.merchant)).status).toBe(404);
  });

  it('a barcode is per store: another shop may use the same code', async () => {
    const shop = await flow.openShop();
    const other = await flow.openShop({ name: 'Other' });
    for (const s of [shop, other]) {
      expectStatus(await call('post', `${base(s)}/products`, s.merchant, { name: 'Tata Salt', variants: [{ name: 'Default', pricePaise: 2800, barcode: '8904043901015' }] }), 201);
    }
  });
});
