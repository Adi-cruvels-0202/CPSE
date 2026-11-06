import { describe, it, expect } from 'vitest';
import { sortVariants, variantSize } from '../src/lib/variantOrder.js';

const v = (name, extra = {}) => ({ name, sort_order: 0, weight_grams: null, ...extra });
const names = (rows) => sortVariants(rows).map((r) => r.name);

describe('variant order (smallest pack first)', () => {
  it('orders weights by size, whatever order they were added in', () => {
    const rows = [v('1 kg', { sort_order: 0 }), v('5 kg', { sort_order: 1 }), v('2 kg', { sort_order: 2 }), v('500 g', { sort_order: 3 }), v('250 g', { sort_order: 4 })];
    expect(names(rows)).toEqual(['250 g', '500 g', '1 kg', '2 kg', '5 kg']);
  });

  it('uses weight_grams before the name', () => {
    expect(names([v('Big bag', { weight_grams: 5000 }), v('Small bag', { weight_grams: 1000 })])).toEqual(['Small bag', 'Big bag']);
  });

  it('reads litres, millilitres, packs and dozens', () => {
    expect(names([v('1 litre'), v('500 ml'), v('1.5 L'), v('200ml')])).toEqual(['200ml', '500 ml', '1 litre', '1.5 L']);
    expect(names([v('Pack of 12', { sort_order: 0 }), v('Pack of 6', { sort_order: 1 }), v('2 dozen', { sort_order: 2 }), v('a dozen', { sort_order: 3 })])).toEqual(['Pack of 6', 'Pack of 12', 'a dozen', '2 dozen']);
    expect(variantSize(v('1.5 kg'))).toEqual({ kind: 'weight', amount: 1500 });
  });

  it('keeps weights, volumes and counts in their own groups, unsized options last in added order', () => {
    const rows = [v('Large', { sort_order: 0 }), v('1 l', { sort_order: 1 }), v('Small', { sort_order: 2 }), v('Pack of 2', { sort_order: 3 }), v('100 g', { sort_order: 4 })];
    expect(names(rows)).toEqual(['100 g', '1 l', 'Pack of 2', 'Large', 'Small']);
  });

  it('keeps a product\'s original Default option first', () => {
    expect(names([v('5 kg', { sort_order: 1 }), v('Default', { sort_order: 0, weight_grams: 1000 }), v('500 g', { sort_order: 2 })])).toEqual(['Default', '500 g', '5 kg']);
  });

  it('does not change the input', () => {
    const rows = [v('2 kg'), v('1 kg')];
    sortVariants(rows);
    expect(rows.map((r) => r.name)).toEqual(['2 kg', '1 kg']);
  });
});
