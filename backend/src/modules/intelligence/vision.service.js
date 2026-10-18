import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { askVision, filePart } from '../../lib/ai.js';
import * as engines from './engines.js';
import { catalogue, extractInvoice, label, suggestForProduct } from './merchantIntelligence.service.js';

/**
 * Photo and document reading for the merchant (roadmap Phase D "Product
 * recognition", "Invoice extraction"). The model only reads; everything it
 * says is validated here, matched against the shop's own records, and handed
 * back as a proposal. Nothing is written — the merchant confirms through the
 * ordinary product, cart and purchase forms (roadmap AI rule, E-06).
 */

const nullableString = (max) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null), z.string().nullable());

// ── Product from a photo ────────────────────────────────────────────────────

const PRODUCT_PROMPT = `You are looking at a photo taken in a small shop in India.
Identify the single retail product that is the subject of the photo (a packaged item or loose produce).
Report only what is visible or certain; use null for anything you cannot read.
- name: the product as a shopkeeper would list it, without brand or size (for example "Iodised Salt", "Basmati Rice", "Toor Dal").
- brand: the brand printed on the pack, or null.
- sizeText: the net quantity exactly as printed (for example "1 kg", "500 ml", "Pack of 6"), or null.
- category: a short generic category (for example "Salt", "Rice", "Biscuits", "Soap"), or null.
- barcode: the barcode digits only if they are clearly printed and readable, otherwise null.
- mrpRupees: the printed MRP in rupees, or null.
- isProduct: false if there is no retail product in the photo.
- confidence: from 0 to 1, how sure you are of the name and brand.`;

const PRODUCT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    isProduct: { type: 'BOOLEAN' },
    name: { type: 'STRING', nullable: true },
    brand: { type: 'STRING', nullable: true },
    sizeText: { type: 'STRING', nullable: true },
    category: { type: 'STRING', nullable: true },
    barcode: { type: 'STRING', nullable: true },
    mrpRupees: { type: 'NUMBER', nullable: true },
    confidence: { type: 'NUMBER' },
  },
  required: ['isProduct', 'confidence'],
};

const productRead = z.object({
  isProduct: z.boolean(),
  name: nullableString(120),
  brand: nullableString(80),
  sizeText: nullableString(40),
  category: nullableString(60),
  barcode: z.preprocess((v) => (typeof v === 'string' && /^\d{8,14}$/.test(v.replace(/\s/g, '')) ? v.replace(/\s/g, '') : null), z.string().nullable()),
  mrpRupees: z.preprocess((v) => (typeof v === 'number' && v > 0 && v < 1_000_000 ? v : null), z.number().nullable()),
  confidence: z.preprocess((v) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(Math.max(v, 0), 1) : 0), z.number()),
});

/** Below this the photo reader's answer is not used for anything but a hint. */
export const MIN_CONFIDENCE = 0.5;

const badAnswer = () => new AppError(502, 'AI_BAD_RESPONSE', 'The photo reader gave an answer that could not be used. Try another photo, or fill the form in by hand.');

export async function recognizeProduct(store, upload) {
  const file = await filePart(upload.buffer);
  const parsed = productRead.safeParse(await askVision({ file, prompt: PRODUCT_PROMPT, schema: PRODUCT_SCHEMA }));
  if (!parsed.success) throw badAnswer();
  const read = parsed.data;
  const size = engines.parseSize(read.sizeText ?? '').size;
  const result = {
    read: { ...read, weightGrams: size?.grams ?? null, mrpPaise: read.mrpRupees === null ? null : Math.round(read.mrpRupees * 100) },
    identified: read.isProduct && Boolean(read.name) && read.confidence >= MIN_CONFIDENCE,
    match: null,
    candidates: [],
    suggestion: null,
    note: 'Read from the photo — check it. Nothing is saved until you save the product or the sale.',
  };
  if (!result.identified) {
    result.note = read.isProduct === false
      ? 'No product could be seen in that photo. Try again closer to the label, or fill the form in by hand.'
      : 'The photo reader is not sure what this is. Try a clearer photo of the label, or fill the form in by hand.';
    return result;
  }

  const { products, variants } = await catalogue(store);
  const productById = new Map(products.map((p) => [p.id, p]));
  const pickVariant = (productId) => {
    const own = variants.filter((v) => v.product_id === productId && v.is_available);
    if (own.length <= 1) return own[0] ?? null;
    const fits = own.map((v) => ({ v, fit: engines.sizeFit(size, { weightGrams: v.weight_grams, name: v.name }) ?? 0 })).sort((a, b) => b.fit - a.fit);
    return size && fits[0].fit >= 0.999 ? fits[0].v : null;
  };

  // A readable barcode is decisive; otherwise compare names (brand + product).
  const byBarcode = read.barcode ? variants.find((v) => v.barcode === read.barcode) : null;
  if (byBarcode && productById.has(byBarcode.product_id)) {
    const product = productById.get(byBarcode.product_id);
    result.match = { productId: product.id, variantId: byBarcode.id, name: label(product, byBarcode), by: 'barcode', score: 1, isAvailable: product.is_available && byBarcode.is_available, pricePaise: byBarcode.price_paise };
  }
  const query = [read.brand, read.name].filter(Boolean).join(' ');
  result.candidates = products
    .map((p) => ({ p, score: Math.max(engines.similarity(query, p.name), engines.similarity(read.name, p.name), engines.coverage(read.name, p.name) * 0.9) }))
    .filter((x) => x.score >= 0.34)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(({ p, score }) => {
      const v = pickVariant(p.id);
      return { productId: p.id, variantId: v?.id ?? null, name: label(p, v), score: Math.round(score * 100) / 100, isAvailable: p.is_available, pricePaise: v?.price_paise ?? null };
    });
  if (!result.match && result.candidates[0]?.score >= 0.75) result.match = { ...result.candidates[0], by: 'name' };

  // Not in the shop yet: what the New product form should start with.
  if (!result.match) {
    const name = [read.brand, read.name, read.sizeText].filter(Boolean).join(' ');
    const { suggestions, duplicates } = await suggestForProduct(store, { name });
    result.suggestion = {
      name,
      category: suggestions.category,
      unit: suggestions.unit,
      taxPercent: suggestions.taxPercent,
      weightGrams: size?.grams ?? suggestions.weightGrams?.value ?? null,
      mrpPaise: result.read.mrpPaise,
      barcode: read.barcode,
      duplicates,
    };
  }
  return result;
}

// ── Invoice from a photo or PDF ─────────────────────────────────────────────

const INVOICE_PROMPT = `This is a supplier invoice or bill for a small shop in India (a photo or a PDF).
Transcribe it faithfully; do not calculate or guess anything that is not printed.
- supplier: the seller's business name, or null.
- invoiceNumber: as printed, or null.
- invoiceDate: as printed, written DD/MM/YYYY, or null.
- lines: one entry per item row: name (as printed, without batch or expiry), quantity (a number), unitPrice (rupees per unit, a number), batch (batch or lot as printed, or null), expiry (expiry as printed, written MM/YYYY or DD/MM/YYYY, or null).
- total: the grand total in rupees as printed, or null.`;

const INVOICE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    supplier: { type: 'STRING', nullable: true },
    invoiceNumber: { type: 'STRING', nullable: true },
    invoiceDate: { type: 'STRING', nullable: true },
    lines: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' },
          quantity: { type: 'NUMBER' },
          unitPrice: { type: 'NUMBER' },
          batch: { type: 'STRING', nullable: true },
          expiry: { type: 'STRING', nullable: true },
        },
        required: ['name', 'quantity', 'unitPrice'],
      },
    },
    total: { type: 'NUMBER', nullable: true },
  },
  required: ['lines'],
};

const invoiceRead = z.object({
  supplier: nullableString(120),
  invoiceNumber: z.preprocess((v) => (typeof v === 'string' && /^[A-Za-z0-9/-]{2,30}$/.test(v.trim()) ? v.trim() : null), z.string().nullable()),
  invoiceDate: z.preprocess((v) => (typeof v === 'string' && /^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$/.test(v.trim()) ? v.trim() : null), z.string().nullable()),
  lines: z.array(z.object({
    name: z.string().trim().min(1).max(200),
    quantity: z.number(),
    unitPrice: z.number(),
    batch: nullableString(40),
    expiry: nullableString(20),
  })).max(300),
  total: z.preprocess((v) => (typeof v === 'number' && v > 0 ? v : null), z.number().nullable()),
});

/** The words the text parser treats as markers must not leak in from a name. */
const cleanName = (name) => name.replace(/\b(batch|lot|b\.?\s?no|exp(iry)?|best before|total|invoice|date)\b[:.]?/gi, ' ').replace(/\s+/g, ' ').trim();

/**
 * Reads the document into the same lines a merchant would paste, then runs
 * them through the pasted-text reader — so every rule there (real dates,
 * batch format, totals, catalogue matching) applies unchanged.
 */
export async function extractInvoiceFromFile(store, upload, options = {}) {
  const file = await filePart(upload.buffer, { allowPdf: true });
  const parsed = invoiceRead.safeParse(await askVision({ file, prompt: INVOICE_PROMPT, schema: INVOICE_SCHEMA }));
  if (!parsed.success) throw badAnswer();
  const read = parsed.data;
  const skipped = [];
  const text = [];
  if (read.supplier) text.push(`Supplier: ${read.supplier}`);
  if (read.invoiceNumber) text.push(`Invoice No: ${read.invoiceNumber}`);
  if (read.invoiceDate) text.push(`Date: ${read.invoiceDate}`);
  for (const line of read.lines) {
    const name = cleanName(line.name);
    if (!name || !Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 99_999 || !(line.unitPrice >= 0) || line.unitPrice > 10_000_000) {
      skipped.push(`${line.name} — quantity ${line.quantity}, price ${line.unitPrice} (needs a whole quantity and a price)`);
      continue;
    }
    const batch = line.batch && /^[A-Za-z0-9/-]{1,30}$/.test(line.batch) ? ` Batch ${line.batch}` : '';
    const expiry = line.expiry ? ` Exp ${line.expiry.replace(/\s/g, '')}` : '';
    text.push(`${name}${batch}${expiry} ${line.quantity} x ${Math.round(line.unitPrice * 100) / 100}`);
  }
  if (read.total) text.push(`Total ${read.total}`);
  if (!read.lines.length || text.every((t) => /^(Supplier|Invoice No|Date|Total)\b/.test(t))) {
    throw new AppError(422, 'NOTHING_READ', 'No item lines could be read from that file. Try a clearer photo, or paste the text.', { skipped });
  }
  const invoice = await extractInvoice(store, { text: text.join('\n') }, options);
  return { ...invoice, source: 'file', transcript: text, skipped: [...skipped, ...invoice.skipped] };
}
