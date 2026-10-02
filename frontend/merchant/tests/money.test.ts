import { describe, it, expect } from 'vitest';
import { formatPaise, rupeesToPaise, paiseToRupees, taxFor } from '../src/lib/money';

describe('money', () => {
  it('turns typed rupees into paise, and refuses what is not a rupee amount', () => {
    expect(rupeesToPaise('129')).toBe(12900);
    expect(rupeesToPaise('129.5')).toBe(12950);
    expect(rupeesToPaise(' 0.07 ')).toBe(7);
    expect(rupeesToPaise('')).toBeNull();
    expect(rupeesToPaise('12.345')).toBeNaN();
    expect(rupeesToPaise('-5')).toBeNaN();
    expect(rupeesToPaise('1e3')).toBeNaN();
  });

  it('shows paise as rupees', () => {
    expect(formatPaise(12950)).toBe('₹129.50');
    expect(formatPaise(null)).toBe('—');
    expect(paiseToRupees(12950)).toBe('129.50');
    expect(paiseToRupees(null)).toBe('');
  });

  // Must agree with backend/src/lib/pricing.js taxFor, or the till's preview
  // and the receipt would disagree by a paisa.
  it('rounds tax half up to the paisa, like the server', () => {
    expect(taxFor(25800, 5)).toBe(1290);
    expect(taxFor(30, 5)).toBe(2);
    expect(taxFor(25, 5)).toBe(1);
    expect(taxFor(999, 18)).toBe(180);
    expect(taxFor(1010, 12.5)).toBe(126);
    expect(taxFor(1000, 0)).toBe(0);
  });
});
