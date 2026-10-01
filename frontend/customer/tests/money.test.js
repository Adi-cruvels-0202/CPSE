import { describe, it, expect } from 'vitest';
import { discountPercent, formatPaise, formatPaiseShort } from '../src/lib/money.js';

/**
 * Money is integer paise in and out of the API. These are the only functions
 * that divide by 100, so this is the only place that can get it wrong.
 */
describe('formatPaise', () => {
  it('formats rupees and paise', () => {
    expect(formatPaise(19900)).toBe('₹199.00');
    expect(formatPaise(2940)).toBe('₹29.40');
    expect(formatPaise(5)).toBe('₹0.05');
  });

  it('formats zero as zero, not as nothing', () => {
    // A ₹0 delivery fee is a fact worth showing; an em dash would read as unknown.
    expect(formatPaise(0)).toBe('₹0.00');
  });

  it('groups thousands the Indian way', () => {
    // 12,345.67 — lakh grouping, not 1,234,567.
    expect(formatPaise(1234567)).toBe('₹12,345.67');
    expect(formatPaise(123456789)).toBe('₹12,34,567.89');
  });

  it('shows a refund or credit as negative rather than hiding the sign', () => {
    expect(formatPaise(-5000)).toBe('-₹50.00');
  });

  it('renders a missing amount as an em dash, never as ₹0.00 or NaN', () => {
    for (const value of [null, undefined, 'abc', NaN]) {
      expect(formatPaise(value)).toBe('—');
    }
  });
});

describe('formatPaiseShort', () => {
  it('drops the paise when they are zero', () => {
    expect(formatPaiseShort(19900)).toBe('₹199');
    expect(formatPaiseShort(100000)).toBe('₹1,000');
  });

  it('keeps the paise when they are not', () => {
    expect(formatPaiseShort(2940)).toBe('₹29.40');
  });

  it('renders a missing amount as an em dash', () => {
    expect(formatPaiseShort(null)).toBe('—');
  });
});

describe('discountPercent', () => {
  it('works out the saving against the MRP', () => {
    expect(discountPercent(5500, 6000)).toBe(8);
    expect(discountPercent(5000, 10000)).toBe(50);
  });

  it('says nothing when there is no saving to show', () => {
    expect(discountPercent(6000, 6000)).toBeNull();
    // A price above its own MRP is a merchant data error, not a -10% badge.
    expect(discountPercent(6600, 6000)).toBeNull();
    expect(discountPercent(5500, null)).toBeNull();
    expect(discountPercent(5500, 0)).toBeNull();
  });
});
