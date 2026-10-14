/**
 * Photo product recognition and invoice photos/PDFs (roadmap Phase D) against
 * real Postgres, with the vision model replaced by a scripted one. What is
 * proved: the model's answer is validated, matched only against the calling
 * shop's catalogue, turned into a proposal, and nothing is written.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../src/lib/supabase.js', async () => {
  const { createPgSupabase } = await import('../helpers/pgSupabase.js');
  return createPgSupabase();
});

const { resetDatabase, sql } = await import('../helpers/pgSupabase.js');
const { setVisionProviderForTests } = await import('../../src/lib/ai.js');
const { api, url } = await import('../helpers/app.js');
const flow = await import('./flow.js');
const { call, expectStatus } = flow;

let calls;
const answer = (reply) => {
  calls = [];
  setVisionProviderForTests(async (request) => {
    calls.push(request);
    if (reply instanceof Error) throw reply;
    return typeof reply === 'function' ? reply(request) : reply;
  });
};

beforeEach(async () => {
  await resetDatabase();
  answer({});
});
afterEach(() => setVisionProviderForTests(null));

const upload = (shop, path, buffer, auth = shop.merchant, filename = 'photo.png') => {
  let request = api().post(url(`/merchant/stores/${shop.store.id}/intelligence/${path}`));
  if (auth) request = request.set(auth);
  return request.attach('file', buffer, filename);
};

async function counts() {
  const [row] = await sql(`select
    (select count(*)::int from products) as products, (select count(*)::int from product_variants) as variants,
    (select count(*)::int from inventory_ledger) as ledger, (select count(*)::int from purchases) as purchases,
    (select count(*)::int from cart_items) as cart, (select count(*)::int from orders) as orders`);
  return row;
}

const riceRead = { isProduct: true, name: 'Basmati Rice', brand: 'India Gate', sizeText: '1 kg', category: 'Rice', barcode: null, mrpRupees: 140, confidence: 0.92 };

describe('product from a photo', () => {
  it('matches a product the shop already sells, choosing the pack size on the label', async () => {
    const shop = await flow.openShop();
    const rice = await flow.addRice(shop);
    const before = await counts();
    answer(riceRead);

    const { recognition } = expectStatus(await upload(shop, 'recognize', await flow.samplePhoto()), 200);
    expect(recognition.identified).toBe(true);
    expect(recognition.match).toMatchObject({ productId: rice.product.id, variantId: rice.kg.id, by: 'name', pricePaise: 12000 });
    expect(recognition.suggestion).toBeNull();
    expect(recognition.read).toMatchObject({ weightGrams: 1000, mrpPaise: 14000 });
    // The model saw a re-encoded JPEG (EXIF dropped), not the raw upload.
    expect(calls[0].parts[0].inlineData.mimeType).toBe('image/jpeg');
    expect(await counts()).toEqual(before);
  });

  it('matches on a readable barcode before anything else', async () => {
    const shop = await flow.openShop();
    const rice = await flow.addRice(shop);
    await sql('update product_variants set barcode = $1 where id = $2', ['8901234567890', rice.halfKg.id]);
    answer({ ...riceRead, name: 'Rice', brand: null, sizeText: null, barcode: '8901 2345 67890' });

    const { recognition } = expectStatus(await upload(shop, 'recognize', await flow.samplePhoto()), 200);
    expect(recognition.match).toMatchObject({ variantId: rice.halfKg.id, by: 'barcode', score: 1 });
  });

  it('prefills the New product form when the shop does not sell it, and saves nothing', async () => {
    const shop = await flow.openShop();
    await flow.addRice(shop);
    const before = await counts();
    answer({ isProduct: true, name: 'Iodised Salt', brand: 'Tata', sizeText: '1 kg', category: 'Salt', barcode: '8904043901015', mrpRupees: 28, confidence: 0.88 });

    const { recognition } = expectStatus(await upload(shop, 'recognize', await flow.samplePhoto()), 200);
    expect(recognition.match).toBeNull();
    expect(recognition.suggestion).toMatchObject({ name: 'Tata Iodised Salt 1 kg', weightGrams: 1000, mrpPaise: 2800, barcode: '8904043901015' });
    expect(await counts()).toEqual(before);
  });

  it('says it could not identify the product rather than guessing', async () => {
    const shop = await flow.openShop();
    await flow.addRice(shop);
    answer({ ...riceRead, confidence: 0.3 });
    const unsure = expectStatus(await upload(shop, 'recognize', await flow.samplePhoto()), 200).recognition;
    expect(unsure).toMatchObject({ identified: false, match: null, suggestion: null, candidates: [] });
    expect(unsure.note).toMatch(/not sure/);

    answer({ isProduct: false, confidence: 0.9 });
    const nothing = expectStatus(await upload(shop, 'recognize', await flow.samplePhoto()), 200).recognition;
    expect(nothing.identified).toBe(false);
    expect(nothing.note).toMatch(/No product/);
  });

  it('only ever matches the calling shop’s own catalogue', async () => {
    const shop = await flow.openShop();
    const other = await flow.openShop({ name: 'Other Kirana' });
    await flow.addRice(other);
    answer(riceRead);
    const { recognition } = expectStatus(await upload(shop, 'recognize', await flow.samplePhoto()), 200);
    expect(recognition.match).toBeNull();
    expect(recognition.candidates).toEqual([]);
  });

  it('refuses unusable answers, PDFs, non-images and a missing provider', async () => {
    const shop = await flow.openShop();
    answer({ isProduct: 'yes', confidence: 'high' });
    const bad = await upload(shop, 'recognize', await flow.samplePhoto());
    expect(bad.status).toBe(502);
    expect(bad.body.error.code).toBe('AI_BAD_RESPONSE');

    const pdf = await upload(shop, 'recognize', flow.SAMPLE_PDF, shop.merchant, 'bill.pdf');
    expect(pdf.status).toBe(422);
    expect(pdf.body.error.code).toBe('IMAGE_INVALID');

    const junk = await upload(shop, 'recognize', Buffer.from('not an image at all'), shop.merchant, 'x.png');
    expect(junk.status).toBe(422);
    expect(junk.body.error.code).toBe('IMAGE_INVALID');

    const missing = await api().post(url(`/merchant/stores/${shop.store.id}/intelligence/recognize`)).set(shop.merchant);
    expect(missing.status).toBe(422);
    expect(missing.body.error.code).toBe('DOCUMENT_REQUIRED');

    setVisionProviderForTests(null); // tests run with AI_PROVIDER unset
    const off = await upload(shop, 'recognize', await flow.samplePhoto());
    expect(off.status).toBe(503);
    expect(off.body.error.code).toBe('AI_UNAVAILABLE');
  });

  it('is for the shop’s owner only', async () => {
    const shop = await flow.openShop();
    const other = await flow.openShop({ name: 'Other' });
    answer(riceRead);
    expect((await upload(shop, 'recognize', await flow.samplePhoto(), other.merchant)).status).toBe(404);
    expect((await upload(shop, 'recognize', await flow.samplePhoto(), null)).status).toBe(401);
    const customer = await flow.newCustomer();
    expect((await upload(shop, 'recognize', await flow.samplePhoto(), customer.auth)).status).toBe(403);
    expect(calls).toHaveLength(0);
  });
});

describe('invoice from a photo or PDF', () => {
  const invoiceRead = {
    supplier: 'Gupta Wholesale',
    invoiceNumber: 'GW-118',
    invoiceDate: '09/10/2026',
    lines: [
      { name: 'Basmati Rice 1kg', quantity: 10, unitPrice: 92, batch: 'R-77', expiry: '06/2027' },
      { name: 'Toor Dal', quantity: 20, unitPrice: 140, batch: null, expiry: null },
      { name: 'Loose Jaggery', quantity: 2.5, unitPrice: 60, batch: null, expiry: null },
    ],
    total: 3070,
  };

  it('reads the document through the same checks as pasted text, and saves nothing', async () => {
    const shop = await flow.openShop();
    const rice = await flow.addRice(shop);
    await flow.addSimpleProduct(shop, { name: 'Toor Dal', pricePaise: 16500 });
    expectStatus(await call('post', `/merchant/stores/${shop.store.id}/suppliers`, shop.merchant, { name: 'Gupta Wholesale' }), 201);
    const before = await counts();
    answer(invoiceRead);

    const { invoice } = expectStatus(await upload(shop, 'invoice-file', flow.SAMPLE_PDF, shop.merchant, 'bill.pdf'), 200);
    expect(calls[0].parts[0].inlineData.mimeType).toBe('application/pdf');
    expect(invoice).toMatchObject({ source: 'file', invoiceNumber: 'GW-118', invoiceDate: '2026-10-09', computedTotalPaise: 372000, statedTotalPaise: 307000, totalMatches: false });
    expect(invoice.supplier).toMatchObject({ name: 'Gupta Wholesale', match: { name: 'Gupta Wholesale' } });
    const [riceLine, dalLine] = invoice.lines;
    expect(riceLine.match.variantId).toBe(rice.kg.id);
    expect(riceLine.readAs).toMatchObject({ batchNumber: 'R-77', expiresOn: '2027-06-30', quantity: 10, unitCostPaise: 9200 });
    expect(dalLine.match.name).toBe('Toor Dal');
    expect(invoice.lines).toHaveLength(2);
    expect(invoice.skipped.join(' ')).toMatch(/Loose Jaggery/);
    expect(invoice.transcript).toContain('Basmati Rice 1kg Batch R-77 Exp 06/2027 10 x 92');
    expect(await counts()).toEqual(before);
  });

  it('accepts a photo, and refuses a document with no item lines', async () => {
    const shop = await flow.openShop();
    answer({ supplier: 'Gupta', invoiceNumber: null, invoiceDate: null, lines: [], total: null });
    const empty = await upload(shop, 'invoice-file', await flow.samplePhoto());
    expect(empty.status).toBe(422);
    expect(empty.body.error.code).toBe('NOTHING_READ');
    expect(calls[0].parts[0].inlineData.mimeType).toBe('image/jpeg');

    answer({ lines: 'none' });
    expect((await upload(shop, 'invoice-file', await flow.samplePhoto())).status).toBe(502);
  });

  it('is for the shop’s owner only', async () => {
    const shop = await flow.openShop();
    const other = await flow.openShop({ name: 'Other' });
    answer(invoiceRead);
    expect((await upload(shop, 'invoice-file', flow.SAMPLE_PDF, other.merchant, 'bill.pdf')).status).toBe(404);
    expect((await upload(shop, 'invoice-file', flow.SAMPLE_PDF, null, 'bill.pdf')).status).toBe(401);
    expect(calls).toHaveLength(0);
  });
});
