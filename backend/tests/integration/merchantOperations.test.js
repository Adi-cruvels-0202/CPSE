/**
 * Merchant operations against real Postgres (migration 0040): templates and
 * defaults, categories, duplicate, barcode lookup, purchases with batches and
 * expiry (FEFO), CSV import/export and bulk actions. Roadmap §4 P1; §6 flows
 * "Catalogue" and "Inventory".
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../src/lib/supabase.js', async () => {
  const { createPgSupabase } = await import('../helpers/pgSupabase.js');
  return createPgSupabase();
});

const { resetDatabase, sql } = await import('../helpers/pgSupabase.js');
const { api, url } = await import('../helpers/app.js');
const flow = await import('./flow.js');
const { call, expectStatus } = flow;

beforeEach(async () => {
  await resetDatabase();
});

const base = (shop) => `/merchant/stores/${shop.store.id}`;

describe('industry templates and workflow defaults', () => {
  it('lists all eight industries', async () => {
    const shop = await flow.openShop();
    const { templates } = expectStatus(await call('get', '/merchant/templates', shop.merchant), 200);
    expect(templates.map((t) => t.industry).sort()).toEqual(
      ['bakery', 'clothing', 'electronics', 'general', 'grocery', 'pharmacy', 'restaurant', 'stationery'],
    );
  });

  it('creates categories, chosen products at the merchant’s prices, and defaults — and is safe to apply twice', async () => {
    const shop = await flow.openShop({ shopCategory: 'other' });
    const { report } = expectStatus(
      await call('post', `${base(shop)}/templates/apply`, shop.merchant, {
        industry: 'pharmacy',
        categories: 'all',
        products: [{ key: 'paracetamol-500', prices: { 'Strip of 10': 3200 } }, { key: 'ors' }],
      }),
      201,
    );
    expect(report.categoriesCreated).toHaveLength(6);
    expect(report.productsCreated.map((p) => p.key)).toEqual(['paracetamol-500', 'ors']);

    const defaults = expectStatus(await call('get', `${base(shop)}/defaults`, shop.merchant), 200).defaults;
    expect(defaults).toMatchObject({ lowStockThreshold: 10, taxPercent: 12, expiryAlertDays: 90, templateApplied: 'pharmacy' });

    const [paracetamol] = await sql(
      `select p.tax_percent::float as tax, p.unit, v.price_paise, v.quantity_on_hand from products p join product_variants v on v.product_id = p.id where p.name = 'Paracetamol 500 mg'`,
    );
    expect(paracetamol).toEqual({ tax: 12, unit: 'pack', price_paise: 3200, quantity_on_hand: 0 });

    const again = expectStatus(
      await call('post', `${base(shop)}/templates/apply`, shop.merchant, { industry: 'pharmacy', products: [{ key: 'ors' }] }),
      201,
    ).report;
    expect(again.productsSkipped).toEqual(['ORS Sachet']);
    expect(again.categoriesCreated).toEqual([]);
    expect(await sql(`select count(*)::int as n from products where name = 'ORS Sachet'`)).toEqual([{ n: 1 }]);
  });

  it('defaults are only defaults: a new product without tax or threshold takes them, an explicit value wins', async () => {
    const shop = await flow.openShop();
    expectStatus(await call('put', `${base(shop)}/defaults`, shop.merchant, { taxPercent: 18, lowStockThreshold: 7 }), 200);
    const inherited = expectStatus(
      await call('post', `${base(shop)}/products`, shop.merchant, { name: 'Torch', variants: [{ name: 'Default', pricePaise: 25000 }] }),
      201,
    ).product;
    expect(inherited).toMatchObject({ taxPercent: 18, lowStockThreshold: 7 });
    const explicit = expectStatus(
      await call('post', `${base(shop)}/products`, shop.merchant, {
        name: 'Rice',
        taxPercent: 5,
        lowStockThreshold: null,
        variants: [{ name: 'Default', pricePaise: 100 }],
      }),
      201,
    ).product;
    expect(explicit).toMatchObject({ taxPercent: 5, lowStockThreshold: null });
  });
});

describe('categories', () => {
  it('reorders atomically and refuses a partial list', async () => {
    const shop = await flow.openShop({ shopCategory: 'other' });  // no starter categories
    const ids = [];
    for (const name of ['A', 'B', 'C']) {
      ids.push(expectStatus(await call('post', `${base(shop)}/categories`, shop.merchant, { name }), 201).category.id);
    }
    const { categories } = expectStatus(
      await call('put', `${base(shop)}/categories/order`, shop.merchant, { categoryIds: [ids[2], ids[0], ids[1]] }),
      200,
    );
    expect(categories.map((c) => c.name)).toEqual(['C', 'A', 'B']);
    expect((await call('put', `${base(shop)}/categories/order`, shop.merchant, { categoryIds: [ids[0]] })).status).toBe(422);
  });

  it('will not silently uncategorise products: move them, or say so explicitly', async () => {
    const shop = await flow.openShop();
    const dairy = expectStatus(await call('post', `${base(shop)}/categories`, shop.merchant, { name: 'Dairy' }), 201).category;
    const fresh = expectStatus(await call('post', `${base(shop)}/categories`, shop.merchant, { name: 'Fresh' }), 201).category;
    const { product } = await flow.addSimpleProduct(shop, { name: 'Paneer', categoryId: dairy.id });

    const refused = await call('delete', `${base(shop)}/categories/${dairy.id}`, shop.merchant, {});
    expect(refused.status).toBe(409);
    expect(refused.body.error.details.productCount).toBe(1);

    const done = expectStatus(await call('delete', `${base(shop)}/categories/${dairy.id}`, shop.merchant, { moveToCategoryId: fresh.id }), 200);
    expect(done.movedProducts).toBe(1);
    expect((await sql('select category_id from products where id = $1', [product.id]))[0].category_id).toBe(fresh.id);
  });
});

describe('duplicate and barcode lookup', () => {
  it('copies a product inactive, with new SKUs, no barcode and no stock', async () => {
    const shop = await flow.openShop();
    const rice = await flow.addRice(shop);
    expectStatus(await call('patch', `${base(shop)}/products/${rice.product.id}/variants/${rice.kg.id}`, shop.merchant, { barcode: '8901234567890' }), 200);

    const { product } = expectStatus(await call('post', `${base(shop)}/products/${rice.product.id}/duplicate`, shop.merchant, {}), 201);
    expect(product).toMatchObject({ name: 'Basmati Rice (Copy)', isActive: false });
    expect(product.variants).toHaveLength(2);
    for (const variant of product.variants) {
      expect(variant.barcode).toBeNull();
      expect(variant.quantityOnHand).toBe(0);
      expect(['RICE-1KG', 'RICE-500G']).not.toContain(variant.sku);
    }
  });

  it('finds a product by barcode or SKU; barcodes are unique per store', async () => {
    const shop = await flow.openShop();
    const rice = await flow.addRice(shop);
    expectStatus(await call('patch', `${base(shop)}/products/${rice.product.id}/variants/${rice.kg.id}`, shop.merchant, { barcode: '8901234567890' }), 200);

    const byBarcode = expectStatus(await call('get', `${base(shop)}/product-lookup?barcode=8901234567890`, shop.merchant), 200);
    expect(byBarcode.variant.id).toBe(rice.kg.id);
    const bySku = expectStatus(await call('get', `${base(shop)}/product-lookup?sku=rice-500g`, shop.merchant), 200);
    expect(bySku.variant.id).toBe(rice.halfKg.id);
    expect((await call('get', `${base(shop)}/product-lookup?barcode=000`, shop.merchant)).status).toBe(404);

    const listed = expectStatus(await call('get', `${base(shop)}/products?search=8901234567890`, shop.merchant), 200);
    expect(listed.products.map((p) => p.id)).toEqual([rice.product.id]);

    const clash = await call('patch', `${base(shop)}/products/${rice.product.id}/variants/${rice.halfKg.id}`, shop.merchant, { barcode: '8901234567890' });
    expect(clash.status).toBe(409);
    expect(clash.body.error.code).toBe('BARCODE_TAKEN');
    expect(await sql(`select count(*)::int as n from product_variants where barcode = '8901234567890'`)).toEqual([{ n: 1 }]);
  });
});

describe('purchases, batches and expiry', () => {
  async function shopWithRice() {
    const shop = await flow.openShop();
    const rice = await flow.addRice(shop, { stock1kg: 0, stock500g: 0 });
    const { supplier } = expectStatus(await call('post', `${base(shop)}/suppliers`, shop.merchant, { name: 'Punjab Grains' }), 201);
    return { shop, rice, supplier };
  }

  it('a draft changes nothing; confirming puts stock on the shelf as traceable purchase movements with batches', async () => {
    const { shop, rice, supplier } = await shopWithRice();
    const { purchase } = expectStatus(
      await call('post', `${base(shop)}/purchases`, shop.merchant, {
        supplierId: supplier.id,
        invoiceNumber: 'PG-1001',
        items: [
          { variantId: rice.kg.id, quantity: 10, unitCostPaise: 9000, batchNumber: 'B1', expiresOn: '2099-01-01' },
          { variantId: rice.halfKg.id, quantity: 20, unitCostPaise: 4700, taxPaise: 4700 },
        ],
      }),
      201,
    );
    expect(purchase).toMatchObject({ status: 'draft', supplierName: 'Punjab Grains', totals: { subtotalPaise: 184000, taxPaise: 4700, totalPaise: 188700 } });
    expect((await sql('select quantity_on_hand from product_variants where id = $1', [rice.kg.id]))[0].quantity_on_hand).toBe(0);

    const confirmed = expectStatus(await call('post', `${base(shop)}/purchases/${purchase.id}/confirm`, shop.merchant, {}), 200).purchase;
    expect(confirmed.status).toBe('confirmed');
    expectStatus(await call('post', `${base(shop)}/purchases/${purchase.id}/confirm`, shop.merchant, {}), 200);

    const ledger = await sql(
      `select variant_id, movement_type, on_hand_change, unit_cost_paise, reference_type, reference_id, batch_id is not null as batched
         from inventory_ledger where reference_id = $1 order by on_hand_change`,
      [purchase.id],
    );
    expect(ledger).toHaveLength(2);
    expect(ledger.every((row) => row.movement_type === 'purchase' && row.reference_type === 'purchase')).toBe(true);
    expect(ledger.find((row) => row.variant_id === rice.kg.id)).toMatchObject({ on_hand_change: 10, unit_cost_paise: 9000, batched: true });
    expect(ledger.find((row) => row.variant_id === rice.halfKg.id)).toMatchObject({ batched: false });
    // The variant's cost is now the latest purchase cost.
    expect((await sql('select cost_paise, quantity_on_hand from product_variants where id = $1', [rice.kg.id]))[0]).toEqual({ cost_paise: 9000, quantity_on_hand: 10 });

    const edit = await call('put', `${base(shop)}/purchases/${purchase.id}`, shop.merchant, { items: [] });
    expect(edit.status).toBe(409);
  });

  it('refuses the same supplier invoice twice', async () => {
    const { shop, rice, supplier } = await shopWithRice();
    const body = { supplierId: supplier.id, invoiceNumber: 'PG-7', items: [{ variantId: rice.kg.id, quantity: 1, unitCostPaise: 1 }] };
    expectStatus(await call('post', `${base(shop)}/purchases`, shop.merchant, body), 201);
    expect((await call('post', `${base(shop)}/purchases`, shop.merchant, { ...body, invoiceNumber: 'pg-7' })).status).toBe(409);
  });

  it('draws batches down first-expiring first as stock is sold, and lists what is expiring or expired', async () => {
    const { shop, rice } = await shopWithRice();
    expectStatus(await call('put', `${base(shop)}/defaults`, shop.merchant, { expiryAlertDays: 30 }), 200);
    expectStatus(
      await call('post', `${base(shop)}/purchases`, shop.merchant, {
        confirm: true,
        items: [
          { variantId: rice.kg.id, quantity: 5, unitCostPaise: 9000, batchNumber: 'LATE', expiresOn: '2099-12-31' },
          { variantId: rice.kg.id, quantity: 5, unitCostPaise: 9000, batchNumber: 'SOON', expiresOn: '2099-01-31' },
          { variantId: rice.kg.id, quantity: 2, unitCostPaise: 9000, batchNumber: 'OLD', expiresOn: '2020-01-01' },
        ],
      }),
      201,
    );

    // A counter sale of 6: SOON (5) then LATE (1). The expired lot is not sold.
    expectStatus(
      await call('post', `${base(shop)}/sales`, shop.merchant, { items: [{ variantId: rice.kg.id, quantity: 6 }], paymentMethod: 'cash' }, { 'Idempotency-Key': 's1' }),
      201,
    );
    const remaining = Object.fromEntries(
      (await sql('select batch_number, quantity_remaining from inventory_batches where variant_id = $1', [rice.kg.id])).map((r) => [r.batch_number, r.quantity_remaining]),
    );
    expect(remaining).toEqual({ SOON: 0, LATE: 4, OLD: 2 });

    const expired = expectStatus(await call('get', `${base(shop)}/inventory/batches?status=expired`, shop.merchant), 200);
    expect(expired.batches.map((b) => b.batchNumber)).toEqual(['OLD']);
    expect(expired.summary).toMatchObject({ expiredCount: 1, expiredQuantity: 2 });

    // Writing off the expired lot takes it, not the good one.
    const [{ id: oldId }] = await sql(`select id from inventory_batches where batch_number = 'OLD'`);
    expectStatus(
      await call('post', `${base(shop)}/inventory/stock-out`, shop.merchant, { variantId: rice.kg.id, quantity: 2, reason: 'expired', batchId: oldId }),
      200,
    );
    expect((await sql(`select quantity_remaining from inventory_batches where batch_number = 'OLD'`))[0].quantity_remaining).toBe(0);
    expect((await sql(`select quantity_remaining from inventory_batches where batch_number = 'LATE'`))[0].quantity_remaining).toBe(4);
  });

  it('stock-in can open a batch directly, and an expiring one is reported as expiring', async () => {
    const { shop, rice } = await shopWithRice();
    const soon = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
    expectStatus(
      await call('post', `${base(shop)}/inventory/stock-in`, shop.merchant, { variantId: rice.halfKg.id, quantity: 8, batchNumber: 'X1', expiresOn: soon }),
      200,
    );
    const expiring = expectStatus(await call('get', `${base(shop)}/inventory/batches?status=expiring`, shop.merchant), 200);
    expect(expiring.batches).toHaveLength(1);
    expect(expiring.batches[0]).toMatchObject({ batchNumber: 'X1', expiryState: 'expiring', quantityRemaining: 8 });
    expect(expiring.batches[0].daysToExpiry).toBeGreaterThanOrEqual(4);
  });

  it('another merchant cannot read this store’s purchases or confirm them', async () => {
    const { shop, rice } = await shopWithRice();
    const { purchase } = expectStatus(
      await call('post', `${base(shop)}/purchases`, shop.merchant, { items: [{ variantId: rice.kg.id, quantity: 1, unitCostPaise: 1 }] }),
      201,
    );
    const other = await flow.openShop({ name: 'Other' });
    expect((await call('get', `${base(other)}/purchases/${purchase.id}`, other.merchant)).status).toBe(404);
    expect((await call('post', `${base(shop)}/purchases/${purchase.id}/confirm`, other.merchant, {})).status).toBe(404);
    // A purchase line for another store's variant is refused.
    expect(
      (await call('post', `${base(other)}/purchases`, other.merchant, { items: [{ variantId: rice.kg.id, quantity: 1, unitCostPaise: 1 }] })).status,
    ).toBe(404);
  });
});

describe('CSV import and export', () => {
  const importCsv = (shop, csv, mode = 'preview') =>
    api().post(url(`${base(shop)}/catalogue/import?mode=${mode}`)).set(shop.merchant).set('Content-Type', 'text/csv').send(csv);

  it('exports the catalogue one row per variant, in rupees', async () => {
    const shop = await flow.openShop();
    await flow.addRice(shop);
    const response = await api().get(url(`${base(shop)}/catalogue/export`)).set(shop.merchant);
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/text\/csv/);
    const lines = response.text.trim().split('\r\n');
    expect(lines[0]).toBe('product_name,category,unit,tax_percent,track_inventory,low_stock_threshold,product_active,variant_name,sku,barcode,weight_grams,price,mrp,cost,quantity_on_hand,variant_active');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('Basmati Rice');
    expect(lines.join('\n')).toContain('120.00');
  });

  it('previews without writing, reporting every bad line and skipping that whole product', async () => {
    const shop = await flow.openShop();
    const csv = [
      'product_name,category,unit,tax_percent,variant_name,sku,price,mrp,quantity_on_hand',
      'Sugar,Essentials,kg,5,1 kg,SUG-1,48,50,30',
      'Sugar,Essentials,kg,5,5 kg,SUG-5,abc,,10',
      'Salt,Essentials,kg,0,1 kg,SALT-1,20,18,10',
      'Jaggery,Essentials,kg,5,500 g,JAG-500,60,,12',
    ].join('\n');
    const preview = expectStatus(await importCsv(shop, csv), 200);
    expect(preview.failedRows.map((r) => r.line)).toEqual([3, 4]);
    expect(preview.failedRows[0].errors[0].message).toMatch(/price/);
    expect(preview.failedRows[1].errors[0].message).toMatch(/mrp/);
    expect(preview.summary).toMatchObject({ productsToCreate: 1, productsSkipped: 2, newCategories: ['Essentials'] });
    expect(await sql('select count(*)::int as n from products')).toEqual([{ n: 0 }]);

    const committed = expectStatus(await importCsv(shop, csv, 'commit'), 200);
    expect(committed.summary).toEqual({ created: 1, updated: 0, skipped: 3, failed: 0 });
    const jaggery = await sql(`select v.sku, v.price_paise, v.quantity_on_hand from product_variants v join products p on p.id = v.product_id where p.name = 'Jaggery'`);
    expect(jaggery).toEqual([{ sku: 'JAG-500', price_paise: 6000, quantity_on_hand: 12 }]);
    // Opening stock is logged, like any other.
    expect(await sql(`select movement_type from inventory_ledger l join product_variants v on v.id = l.variant_id where v.sku = 'JAG-500'`)).toEqual([
      { movement_type: 'stock_in' },
    ]);
  });

  it('re-importing an export updates by SKU and logs a changed count as an adjustment', async () => {
    const shop = await flow.openShop();
    await flow.addRice(shop, { stock1kg: 20 });
    const exported = (await api().get(url(`${base(shop)}/catalogue/export`)).set(shop.merchant)).text;
    const edited = exported.replace('RICE-1KG,,1000,120.00', 'RICE-1KG,,1000,125.00').replace(/(RICE-1KG,,1000,125\.00,,90\.00,)20/, '$118');

    const result = expectStatus(await importCsv(shop, edited, 'commit'), 200);
    expect(result.summary).toMatchObject({ updated: 2, failed: 0 });
    const [kg] = await sql(`select price_paise, quantity_on_hand from product_variants where sku = 'RICE-1KG'`);
    expect(kg).toEqual({ price_paise: 12500, quantity_on_hand: 18 });
    expect(await sql(`select reason from inventory_ledger where movement_type = 'adjustment'`)).toEqual([{ reason: 'Catalogue import' }]);
  });

  it('refuses a file without the required columns', async () => {
    const shop = await flow.openShop();
    const response = await importCsv(shop, 'name,cost\nx,1');
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('IMPORT_HEADERS');
  });

  it('neutralises spreadsheet formulas in an export', async () => {
    const shop = await flow.openShop();
    await flow.addSimpleProduct(shop, { name: '=HYPERLINK("http://evil")' });
    const response = await api().get(url(`${base(shop)}/catalogue/export`)).set(shop.merchant);
    expect(response.text).toContain(`"'=HYPERLINK(""http://evil"")"`);
  });
});

describe('bulk actions', () => {
  it('previews price changes without writing, flags MRP breaches per product, and applies the rest', async () => {
    const shop = await flow.openShop();
    const rice = await flow.addRice(shop);
    const { product: dal } = await flow.addSimpleProduct(shop, { name: 'Dal', pricePaise: 10000 });
    expectStatus(await call('patch', `${base(shop)}/products/${dal.id}/variants/${dal.variants[0].id}`, shop.merchant, { mrpPaise: 10500 }), 200);

    const preview = expectStatus(
      await call('post', `${base(shop)}/products/bulk`, shop.merchant, {
        action: 'adjust_price_percent',
        percent: 10,
        productIds: [rice.product.id, dal.id],
      }),
      200,
    ).bulk;
    expect(preview.preview).toBe(true);
    expect(preview.summary).toEqual({ total: 2, ok: 1, failed: 1 });
    expect(preview.results.find((r) => r.productId === dal.id).errors[0].code).toBe('ABOVE_MRP');
    expect((await sql('select price_paise from product_variants where id = $1', [rice.kg.id]))[0].price_paise).toBe(12000);

    const applied = expectStatus(
      await call('post', `${base(shop)}/products/bulk`, shop.merchant, {
        action: 'adjust_price_percent',
        percent: 10,
        productIds: [rice.product.id, dal.id],
        preview: false,
      }),
      200,
    ).bulk;
    expect(applied.results.find((r) => r.productId === rice.product.id).status).toBe('applied');
    expect((await sql('select price_paise from product_variants where id = $1', [rice.kg.id]))[0].price_paise).toBe(13200);
    expect((await sql('select price_paise from product_variants where id = $1', [dal.variants[0].id]))[0].price_paise).toBe(10000);
  });

  it('archives, recategorises and reports ids it cannot find', async () => {
    const shop = await flow.openShop();
    const { product: a } = await flow.addSimpleProduct(shop, { name: 'A' });
    const { product: b } = await flow.addSimpleProduct(shop, { name: 'B' });
    const other = await flow.openShop({ name: 'Other' });
    const { product: foreign } = await flow.addSimpleProduct(other, { name: 'Foreign' });

    const result = expectStatus(
      await call('post', `${base(shop)}/products/bulk`, shop.merchant, {
        action: 'archive',
        productIds: [a.id, b.id, foreign.id],
        preview: false,
      }),
      200,
    ).bulk;
    expect(result.summary).toEqual({ total: 3, ok: 2, failed: 1 });
    expect(await sql('select count(*)::int as n from products where archived_at is not null')).toEqual([{ n: 2 }]);
    expect((await sql('select archived_at from products where id = $1', [foreign.id]))[0].archived_at).toBeNull();
  });
});
