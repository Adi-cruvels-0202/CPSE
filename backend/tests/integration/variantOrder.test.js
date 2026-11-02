/**
 * Options of a product come back smallest first, wherever they are read —
 * the merchant's product panel and the customer's product page — however
 * they were added (the reported case: 1 kg and 5 kg, then 2 kg, 500 g, 250 g).
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

describe('variant order', () => {
  it('shows added pack sizes in ascending order to merchant and customer', async () => {
    const shop = await flow.openShop();
    await flow.publish(shop);
    const base = `/merchant/stores/${shop.store.id}`;
    const { product } = expectStatus(await call('post', `${base}/products`, shop.merchant, {
      name: 'Basmati Rice', unit: 'kg', variants: [
        { name: '1 kg', pricePaise: 12900, openingQuantity: 5 },
        { name: '5 kg', pricePaise: 59900, openingQuantity: 5 },
      ],
    }), 201);
    for (const [name, pricePaise] of [['2 kg', 25900], ['500 g', 6900], ['250 g', 3900]]) {
      expectStatus(await call('post', `${base}/products/${product.id}/variants`, shop.merchant, { name, pricePaise, openingQuantity: 5 }), 201);
    }
    const expected = ['250 g', '500 g', '1 kg', '2 kg', '5 kg'];

    const merchantView = expectStatus(await call('get', `${base}/products/${product.id}`, shop.merchant), 200);
    expect(merchantView.product.variants.map((v) => v.name)).toEqual(expected);

    const list = expectStatus(await call('get', `${base}/products`, shop.merchant), 200);
    expect(list.products.find((p) => p.id === product.id).variants.map((v) => v.name)).toEqual(expected);

    const customerView = expectStatus(await call('get', `/stores/${shop.store.slug}/products/${product.id}`, null), 200);
    expect(customerView.product.variants.map((v) => v.name)).toEqual(expected);
  });
});
