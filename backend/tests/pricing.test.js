import { describe, it, expect } from 'vitest';
import {
  unitPriceOf,
  lineTotal,
  deliveryFeeFor,
  priceTotals,
  meetsMinimumOrder,
  formatPaise,
} from '../src/lib/pricing.js';

/** Checklist 5.9 — the totals maths, tested without a database in the way. */

const store = { min_order_paise: 19900, delivery_fee_paise: 2900 };

describe('unit price (5.9, D15)', () => {
  it("uses the product's price when there is no variant", () => {
    expect(unitPriceOf({ price_paise: 12900 }, null)).toBe(12900);
  });

  it("uses the variant's absolute price, not a delta, when there is one", () => {
    expect(unitPriceOf({ price_paise: 12900 }, { price_paise: 59900 })).toBe(59900);
  });

  it('multiplies out the line total', () => {
    expect(lineTotal(12900, 3)).toBe(38700);
  });
});

describe('delivery fee (5.9, 6.8)', () => {
  it("charges the store's fee for delivery", () => {
    expect(deliveryFeeFor(store, 'delivery')).toBe(2900);
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

  it('keeps tax at zero because catalogue prices are tax-inclusive (D27)', () => {
    expect(priceTotals({ lines }).taxPaise).toBe(0);
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
