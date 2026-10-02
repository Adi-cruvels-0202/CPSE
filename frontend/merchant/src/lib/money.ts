/**
 * Money is integer paise everywhere in the API (MERGE_MAPPING D-3). Rupees
 * exist only on screen: typed into an input, or formatted for display.
 */

export function formatPaise(paise: number | null | undefined, { decimals = 2 }: { decimals?: number } = {}) {
  if (paise === null || paise === undefined) return '—';
  return `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
}

/** "129.50" → 12950. Empty → null. Anything that is not a number → NaN, for the form to catch. */
export function rupeesToPaise(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (!/^\d+(\.\d{0,2})?$/.test(trimmed)) return Number.NaN;
  return Math.round(Number(trimmed) * 100);
}

/** 12950 → "129.50", for an input's value. null → "". */
export function paiseToRupees(paise: number | null | undefined): string {
  if (paise === null || paise === undefined) return '';
  return (paise / 100).toFixed(2);
}

/**
 * Tax on a line, rounded half up to the paisa — the same rule as the
 * backend's pricing engine (D-4). Used only to preview a bill; the server's
 * number is the one charged.
 */
export function taxFor(lineSubtotalPaise: number, taxPercent: number) {
  const basisPoints = Math.round(taxPercent * 100);
  if (basisPoints <= 0 || lineSubtotalPaise <= 0) return 0;
  return Math.floor((lineSubtotalPaise * basisPoints + 5000) / 10000);
}
