import { describe, it, expect } from 'vitest';
import {
  lineTotal,
  taxFor,
  priceLine,
  deliveryFeeFor,
  priceTotals,
  meetsMinimumOrder,
  formatPaise,
} from '../src/lib/pricing.js';

/** Checklist 5.9 — the totals maths, tested without a database in the way. */

const store = { min_order_paise: 19900, delivery_fee_paise: 2900 };

describe('line price (5.9)', () => {
  it('multiplies out the line subtotal', () => {
    expect(lineTotal(12900, 3)).toBe(38700);
  });
});

describe('tax (D-4, MERCHANT_RULES §7)', () => {
  it('is added on top of the line subtotal at the product’s rate', () => {
    expect(taxFor(25800, 5)).toBe(1290);
  });

  it('rounds half up to the paisa', () => {
    expect(taxFor(30, 5)).toBe(2); // 1.5 → 2
    expect(taxFor(25, 5)).toBe(1); // 1.25 → 1
    expect(taxFor(999, 18)).toBe(180); // 179.82 → 180
  });

  it('handles a rate with decimals without floating-point drift', () => {
    // 12.5 % of ₹10.10 is 126.25 paise → 126; 0.1 + 0.2 style errors would not round cleanly.
    expect(taxFor(1010, 12.5)).toBe(126);
    expect(taxFor(1010, '12.50')).toBe(126);
  });

  it('is zero for a zero or missing rate', () => {
    expect(taxFor(25800, 0)).toBe(0);
    expect(taxFor(25800, null)).toBe(0);
  });

  it('prices a whole line, with tax inside the line total (O-16)', () => {
    expect(priceLine(12900, 2, 5)).toEqual({
      unitPricePaise: 12900,
      quantity: 2,
      lineSubtotalPaise: 25800,
      taxPercent: 5,
      taxPaise: 1290,
      lineTotalPaise: 27090,
    });
  });
});

describe('delivery fee (5.9, 6.8)', () => {
  it("charges the store's fee for delivery", () => {
    expect(deliveryFeeFor(store, 'delivery')).toBe(2900);
  });

  it('is free once the subtotal reaches the store’s threshold (S-14)', () => {
    const generous = { ...store, free_delivery_threshold_paise: 99900 };
    expect(deliveryFeeFor(generous, 'delivery', 99899)).toBe(2900);
    expect(deliveryFeeFor(generous, 'delivery', 99900)).toBe(0);
  });

  it('is never free when the store sets no threshold', () => {
    expect(deliveryFeeFor({ ...store, free_delivery_threshold_paise: null }, 'delivery', 10_000_000)).toBe(2900);
  });

  it('never charges a delivery fee on pickup', () => {
    expect(deliveryFeeFor(store, 'pickup')).toBe(0);
  });

  it('charges nothing when the mode is not yet chosen', () => {
    expect(deliveryFeeFor(store, null)).toBe(0);
  });

  it('treats a missing fee as free rather than NaN', () => {
    expect(deliveryFeeFor({}, 'delivery')).toBe(0);
  });
});

describe('priceTotals (5.9)', () => {
  const lines = [
    { lineTotalPaise: 38700, quantity: 3 },
    { lineTotalPaise: 12000, quantity: 2 },
  ];

  it('adds the subtotal from the lines', () => {
    expect(priceTotals({ lines }).subtotalPaise).toBe(50700);
  });

  it('satisfies the orders_total_adds_up constraint (D17)', () => {
    const totals = priceTotals({ lines, store, fulfilmentMode: 'delivery', discountPaise: 5000 });

    expect(totals.totalPaise).toBe(
      totals.subtotalPaise - totals.discountPaise + totals.deliveryFeePaise + totals.taxPaise,
    );
    expect(totals.totalPaise).toBe(50700 - 5000 + 2900);
  });

  it('sums each line’s own rounded tax, never re-taxing the total', () => {
    const taxed = [priceLine(30, 1, 5), priceLine(30, 1, 5)];
    // Each line rounds 1.5 → 2; taxing the ₹0.60 total would give 3.
    expect(priceTotals({ lines: taxed })).toMatchObject({ subtotalPaise: 60, taxPaise: 4, totalPaise: 64 });
  });

  it('never taxes the delivery fee (D-4)', () => {
    const totals = priceTotals({ lines: [priceLine(10000, 1, 18)], store, fulfilmentMode: 'delivery' });
    expect(totals).toMatchObject({ subtotalPaise: 10000, taxPaise: 1800, deliveryFeePaise: 2900, totalPaise: 14700 });
  });

  it('applies the free-delivery threshold to the pre-tax subtotal', () => {
    const generous = { ...store, free_delivery_threshold_paise: 10000 };
    const totals = priceTotals({ lines: [priceLine(10000, 1, 18)], store: generous, fulfilmentMode: 'delivery' });
    expect(totals.deliveryFeePaise).toBe(0);
  });

  it('never lets a discount exceed the subtotal — the constraint forbids it', () => {
    const totals = priceTotals({ lines, discountPaise: 999999 });

    expect(totals.discountPaise).toBe(50700);
    expect(totals.totalPaise).toBe(0);
  });

  it('ignores a negative discount rather than inflating the total', () => {
    expect(priceTotals({ lines, discountPaise: -5000 }).discountPaise).toBe(0);
  });

  it('counts lines and units separately', () => {
    const totals = priceTotals({ lines });

    expect(totals.itemCount).toBe(2);
    expect(totals.totalQuantity).toBe(5);
  });

  it('totals an empty basket to zero, not NaN', () => {
    expect(priceTotals({ lines: [] })).toMatchObject({
      subtotalPaise: 0,
      totalPaise: 0,
      itemCount: 0,
      totalQuantity: 0,
    });
  });
});

describe('minimum order (6.9)', () => {
  it('measures the subtotal, so a delivery fee cannot lift an order over the floor', () => {
    expect(meetsMinimumOrder(store, 19899)).toBe(false);
    expect(meetsMinimumOrder(store, 19900)).toBe(true);
  });

  it('passes when the store sets no minimum', () => {
    expect(meetsMinimumOrder({}, 0)).toBe(true);
  });
});

describe('formatPaise', () => {
  it('renders paise as rupees with two decimals', () => {
    expect(formatPaise(19900)).toBe('₹199.00');
    expect(formatPaise(0)).toBe('₹0.00');
  });
});
