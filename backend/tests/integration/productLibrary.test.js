/**
 * The CPSE product library (productLibrary.service.js) on real Postgres: a
 * shop scanning a pack another shop already sells gets the printed details,
 * majority wins, and nothing private to another shop ever comes back.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../src/lib/supabase.js', async () => {
  const { createPgSupabase } = await import('../helpers/pgSupabase.js');
  return createPgSupabase();
});

const { resetDatabase, sql } = await import('../helpers/pgSupabase.js');
const flow = await import('./flow.js');
const { call, expectStatus } = flow;

beforeEach(async () => {
  await resetDatabase();
});

const CODE = '8904043901015';
const base = (shop) => `/merchant/stores/${shop.store.id}`;

async function sells(shop, { name = 'Tata Salt', option = 'Default', unit = 'pcs', taxPercent = 0, pricePaise = 2600, mrpPaise = 2800, costPaise = 2100, stock = 40, category } = {}) {
  let categoryId;
  if (category) categoryId = expectStatus(await call('post', `${base(shop)}/categories`, shop.merchant, { name: category }), 201).category.id;
  return expectStatus(await call('post', `${base(shop)}/products`, shop.merchant, {
    name, unit, taxPercent, ...(categoryId ? { categoryId } : {}),
    variants: [{ name: option, pricePaise, mrpPaise, costPaise, barcode: CODE, openingQuantity: stock }],
  }), 201).product;
}
const library = async (shop, code = CODE) => expectStatus(await call('get', `${base(shop)}/barcode-library?barcode=${code}`, shop.merchant), 200).library;

describe('product library', () => {
  it('pre-fills a new pack from what another shop entered, and only the printed details', async () => {
    const seller = await flow.openShop({ name: 'Gupta Store', shopCategory: 'other' });
    await sells(seller, { name: 'Tata Salt', option: '1 kg', unit: 'kg', taxPercent: 5, mrpPaise: 2800, category: 'Salt & Sugar' });
    const newcomer = await flow.openShop({ name: 'Sharma Kirana', shopCategory: 'other' });
    expectStatus(await call('post', `${base(newcomer)}/categories`, newcomer.merchant, { name: 'salt & sugar' }), 201);

    const found = await library(newcomer);
    expect(found).toMatchObject({
      found: true, shops: 1, agreeing: 1,
      suggestion: { name: 'Tata Salt', optionName: '1 kg', unit: 'kg', taxPercent: 5, mrpPaise: 2800, category: { name: 'Salt & Sugar' } },
    });
    // The newcomer's own category of the same name is the one to use.
    const [{ id: own }] = await sql("select id from categories where store_id = $1 and name = 'salt & sugar'", [newcomer.store.id]);
    expect(found.suggestion.category.id).toBe(own);

    // Nothing private to the selling shop: no prices, cost, stock, ids or names.
    const text = JSON.stringify(found);
    for (const secret of ['2600', '2100', seller.store.id, 'Gupta', '"pricePaise"', '"costPaise"', '"stock"', '"availableQuantity"', '"storeId"', '"store"']) {
      expect(text).not.toContain(secret);
    }
    expect(Object.keys(found.suggestion).sort()).toEqual(['category', 'mrpPaise', 'name', 'optionName', 'taxPercent', 'unit', 'weightGrams']);
  });

  it('lets the majority of shops decide, counting each shop once', async () => {
    for (const [i, name] of ['Tata Salt', 'tata  salt', 'Salt Tata 1kg'].entries()) {
      const shop = await flow.openShop({ name: `Shop ${i}`, shopCategory: 'other' });
      await sells(shop, { name, mrpPaise: i === 2 ? 3000 : 2800 });
    }
    const asker = await flow.openShop({ name: 'Asker', shopCategory: 'other' });
    const found = await library(asker);
    expect(found).toMatchObject({ shops: 3, agreeing: 2, suggestion: { name: 'Tata Salt', mrpPaise: 2800, optionName: null } });
  });

  it('never answers from the asking shop itself, archived products or closed stores', async () => {
    const own = await flow.openShop({ shopCategory: 'other' });
    await sells(own);
    expect(await library(own)).toMatchObject({ found: false, suggestion: null });

    const other = await flow.openShop({ name: 'Other', shopCategory: 'other' });
    const product = await sells(other);
    await sql('update products set archived_at = now() where id = $1', [product.id]);
    expect((await library(own)).found).toBe(false);

    await sql('update products set archived_at = null where id = $1', [product.id]);
    await sql('update stores set is_active = false where id = $1', [other.store.id]);
    expect((await library(own)).found).toBe(false);
  });

  it('is for shop owners only, and checks the code', async () => {
    const shop = await flow.openShop();
    const stranger = await flow.openShop({ name: 'Stranger' });
    expect((await call('get', `${base(shop)}/barcode-library?barcode=${CODE}`, stranger.merchant)).status).toBe(404);
    expect((await call('get', `${base(shop)}/barcode-library?barcode=${CODE}`, null)).status).toBe(401);
    expect((await call('get', `${base(shop)}/barcode-library?barcode=12`, shop.merchant)).status).toBe(422);
    expect((await call('get', `${base(shop)}/barcode-library?barcode=${encodeURIComponent('12,34)')}`, shop.merchant)).status).toBe(422);
  });
});
