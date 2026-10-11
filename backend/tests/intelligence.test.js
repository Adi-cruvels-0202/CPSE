import { describe, it, expect } from 'vitest';
import {
  tokens,
  similarity,
  coverage,
  productKey,
  parseSize,
  parsePriceCeiling,
  parseShoppingQuery,
  describeQuery,
  parseShoppingList,
  sizeFit,
  packFor,
  forecastDemand,
  stockHealth,
  anonymousSpread,
  parseMerchantCommand,
  parseInvoiceText,
  isoDay,
} from '../src/modules/intelligence/engines.js';
import { formatPaise } from '../src/lib/pricing.js';

/** The deterministic intelligence engines (roadmap Phase D/E, §5 P6), without a database. */

describe('text', () => {
  it('tokenises without filler words, numbers or plurals', () => {
    expect(tokens('I want 2 packets of the Basmati Rices!')).toEqual(['basmati', 'rice']);
    expect(tokens('Tomatoes')).toEqual(['tomato']);
    expect(tokens('Cherries, boxes and glass')).toEqual(['cherry', 'box', 'glass']);
  });

  it('scores name similarity and query coverage', () => {
    expect(similarity('Basmati Rice', 'basmati rice')).toBe(1);
    expect(similarity('Basmati Rice', 'Sona Masoori Rice')).toBeCloseTo(0.25);
    expect(similarity('', 'Rice')).toBe(0);
    expect(coverage('rice', 'Basmati Rice 1 kg')).toBe(1);
    expect(coverage('basm', 'Basmati Rice')).toBe(1);
    expect(coverage('ghee', 'Basmati Rice')).toBe(0);
    expect(productKey('Rice Basmati')).toBe(productKey('basmati rice'));
  });
});

describe('sizes and prices in words', () => {
  it.each([
    ['2 kg rice', { grams: 2000 }, 'rice'],
    ['500g dal', { grams: 500 }, 'dal'],
    ['1.5 litre oil', { millilitres: 1500 }, 'oil'],
    ['200 ml curd', { millilitres: 200 }, 'curd'],
    ['a dozen eggs', { count: 12 }, 'eggs'],
    ['bread', null, 'bread'],
  ])('%s', (text, size, rest) => {
    const parsed = parseSize(text);
    expect(parsed.size).toEqual(size);
    expect(parsed.rest.trim()).toBe(rest);
  });

  it('reads price ceilings', () => {
    expect(parsePriceCeiling('rice under 150').maxPricePaise).toBe(15000);
    expect(parsePriceCeiling('oil below ₹199.50').maxPricePaise).toBe(19950);
    expect(parsePriceCeiling('atta less than rs 300').maxPricePaise).toBe(30000);
    expect(parsePriceCeiling('just rice').maxPricePaise).toBeNull();
  });

  it('understands a whole search and says it back', () => {
    const parsed = parseShoppingQuery('cheapest 5 kg atta under 300');
    expect(parsed).toMatchObject({ words: ['atta'], size: { grams: 5000 }, maxPricePaise: 30000, sort: 'price', onOffer: false });
    expect(describeQuery(parsed, formatPaise)).toBe('atta · about 5 kg · under ₹300.00 · cheapest first');
    expect(parseShoppingQuery('milk on offer')).toMatchObject({ words: ['milk'], onOffer: true });
  });

  it('splits a shopping list into lines with quantities', () => {
    expect(parseShoppingList('2 kg rice, 1 litre oil and 6 eggs\nbread x2; sugar').map(({ quantity, size, words }) => ({ quantity, size, words }))).toEqual([
      { quantity: 1, size: { grams: 2000 }, words: ['rice'] },
      { quantity: 1, size: { millilitres: 1000 }, words: ['oil'] },
      { quantity: 6, size: null, words: ['egg'] },
      { quantity: 2, size: null, words: ['bread'] },
      { quantity: 1, size: null, words: ['sugar'] },
    ]);
    expect(parseShoppingList('  ,, and ')).toEqual([]);
  });
});

describe('choosing a pack', () => {
  const variants = [
    { id: '1kg', name: '1 kg', weightGrams: 1000, isPurchasable: true },
    { id: '5kg', name: '5 kg', weightGrams: 5000, isPurchasable: true },
    { id: '500g', name: '500 g', weightGrams: 500, isPurchasable: false },
  ];

  it('fits sizes by weight or by the variant name', () => {
    expect(sizeFit({ grams: 1000 }, variants[0])).toBe(1);
    expect(sizeFit({ grams: 2500 }, variants[1])).toBe(0.5);
    expect(sizeFit({ millilitres: 1000 }, { name: '1 litre' })).toBe(1);
    expect(sizeFit(null, variants[0])).toBeNull();
  });

  it('takes the exact pack, else whole multiples, never an unavailable one', () => {
    expect(packFor({ grams: 5000 }, variants)).toMatchObject({ variant: { id: '5kg' }, quantity: 1, exact: true });
    expect(packFor({ grams: 2000 }, variants)).toMatchObject({ variant: { id: '1kg' }, quantity: 2, exact: true });
    expect(packFor({ grams: 500 }, variants)).toMatchObject({ variant: { id: '1kg' }, exact: false });
    expect(packFor(null, variants)).toMatchObject({ variant: { id: '1kg' }, quantity: 1 });
    expect(packFor({ grams: 1000 }, [{ ...variants[2] }])).toBeNull();
  });
});

describe('demand forecast', () => {
  const today = '2026-10-11';
  const day = (offset) => isoDay(Date.parse(`${today}T00:00:00Z`) - offset * 86_400_000);

  it('refuses with too little history, and says why', () => {
    const short = forecastDemand([{ date: day(3), units: 5 }], { today, firstSeen: day(5) });
    expect(short).toMatchObject({ confidence: 'insufficient', forecastUnits: null });
    expect(short.reason).toMatch(/at least 14/);
    const sparse = forecastDemand([{ date: day(20), units: 5 }, { date: day(2), units: 1 }], { today, firstSeen: day(40) });
    expect(sparse.reason).toMatch(/at least 3/);
  });

  it('averages the last 28 days when there are fewer than four weeks', () => {
    const history = Array.from({ length: 20 }, (_, i) => ({ date: day(i + 1), units: 2 }));
    const result = forecastDemand(history, { today, horizonDays: 7, firstSeen: day(20) });
    expect(result.dailyAverage).toBe(2);
    expect(result.forecastUnits).toBe(14);
    expect(result.weekdayFactors).toBeNull();
    expect(result.confidence).toBe('low');
  });

  it('shapes the forecast by weekday with eight weeks of history', () => {
    // 4 units on Saturdays, 1 on every other day.
    const history = Array.from({ length: 56 }, (_, i) => {
      const date = day(i + 1);
      return { date, units: new Date(`${date}T00:00:00Z`).getUTCDay() === 6 ? 4 : 1 };
    });
    const result = forecastDemand(history, { today, horizonDays: 7, firstSeen: day(70) });
    expect(result.confidence).toBe('high');
    const saturday = result.days.find((d) => new Date(`${d.date}T00:00:00Z`).getUTCDay() === 6);
    const monday = result.days.find((d) => new Date(`${d.date}T00:00:00Z`).getUTCDay() === 1);
    expect(saturday.units).toBeGreaterThan(monday.units * 3);
    // The week's total equals the weekly sales pattern: 6 × 1 + 4 = 10.
    expect(result.forecastUnits).toBe(10);
  });
});

describe('stock health', () => {
  it.each([
    [{ available: 0, dailyRate: 2 }, 'stockout'],
    [{ available: 6, dailyRate: 2 }, 'at_risk'],
    [{ available: 40, dailyRate: 2 }, 'healthy'],
    [{ available: 400, dailyRate: 2 }, 'overstock'],
    [{ available: 10, dailyRate: 0 }, 'slow'],
    [{ available: 10, dailyRate: null, soldLast30: 0 }, 'slow'],
    [{ available: 0, dailyRate: null, soldLast30: 3 }, 'unknown'],
  ])('%o → %s', (input, status) => {
    expect(stockHealth(input).status).toBe(status);
  });

  it('reports days of cover', () => {
    expect(stockHealth({ available: 6, dailyRate: 2 }).daysOfCover).toBe(3);
  });
});

describe('privacy-safe cross-store figures', () => {
  it('publishes nothing below five stores', () => {
    const four = [1, 2, 3, 4].map((n) => ({ storeId: `s${n}`, value: n * 100 }));
    expect(anonymousSpread(four)).toBeNull();
    // Many rows from one store do not count as many stores.
    expect(anonymousSpread([...four, { storeId: 's1', value: 9999 }])).toBeNull();
  });

  it('uses one value per store, so one large catalogue cannot skew it', () => {
    const rows = [
      ...[1, 2, 3, 4, 5].map((n) => ({ storeId: `s${n}`, value: n * 1000 })),
      ...Array.from({ length: 50 }, () => ({ storeId: 's5', value: 5000 })),
    ];
    expect(anonymousSpread(rows)).toEqual({ stores: 5, p25: 2000, median: 3000, p75: 4000 });
  });
});

describe('merchant commands', () => {
  it.each([
    ['add 10 basmati rice', { type: 'stock_in', quantity: 10, product: 'basmati rice' }],
    ['Received 24 units of milk 500 ml', { type: 'stock_in', quantity: 24, product: 'milk 500 ml' }],
    ['write off 3 bread', { type: 'stock_out', quantity: 3, product: 'bread', reason: 'other' }],
    ['expired 2 curd', { type: 'stock_out', quantity: 2, product: 'curd', reason: 'expired' }],
    ['set price of sugar to 45', { type: 'set_price', product: 'sugar', pricePaise: 4500 }],
    ['toor dal price 162.50', { type: 'set_price', product: 'toor dal', pricePaise: 16250 }],
    ['mark ghee out of stock', { type: 'deactivate', product: 'ghee' }],
    ['ghee back in stock', { type: 'activate', product: 'ghee' }],
  ])('%s', (text, expected) => {
    expect(parseMerchantCommand(text)).toEqual(expected);
  });

  it('returns nothing for what it does not understand', () => {
    expect(parseMerchantCommand('what a lovely day')).toBeNull();
  });
});

describe('invoice text', () => {
  const invoice = `Gupta Wholesale
Invoice No: GW/2026/118
Date: 09/10/2026
Basmati Rice 1kg 10 x 95.00
20 Toor Dal @ 140
Sunflower Oil 1L   12   150.00   1800.00
Thank you 2026
Grand Total 5550.00`;

  it('reads the header, three line styles and the stated total', () => {
    const result = parseInvoiceText(invoice);
    expect(result.invoiceNumber).toBe('GW/2026/118');
    expect(result.invoiceDate).toBe('2026-10-09');
    expect(result.lines.map(({ name, quantity, unitCostPaise }) => ({ name, quantity, unitCostPaise }))).toEqual([
      { name: 'Basmati Rice 1kg', quantity: 10, unitCostPaise: 9500 },
      { name: 'Toor Dal', quantity: 20, unitCostPaise: 14000 },
      { name: 'Sunflower Oil 1L', quantity: 12, unitCostPaise: 15000 },
    ]);
    expect(result.computedTotalPaise).toBe(555000);
    expect(result.totalMatches).toBe(true);
    expect(result.skipped).toEqual(['Thank you 2026']);
  });

  it('flags a total that does not add up', () => {
    expect(parseInvoiceText('Rice 2 x 50\nTotal 500').totalMatches).toBe(false);
  });

  it('ignores a qty-rate-amount line whose arithmetic is wrong', () => {
    expect(parseInvoiceText('Rice 10 95 50').lines).toEqual([]);
  });
});
