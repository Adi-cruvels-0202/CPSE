import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { cleanup, fakeServer, render, text, waitFor } from './helpers/render';
import InsightsPage from '../src/features/tools/InsightsPage';
import SuggestionsPage from '../src/features/tools/SuggestionsPage';
import NewSalePage from '../src/features/sales/NewSalePage';

/**
 * Phone-width fixes found by inspecting the app at 375 px in a real browser
 * (docs/implementation/TESTING_AND_VERIFICATION.md). jsdom does no layout, so
 * these guard the fixes themselves — the rules and the classes the screens
 * rely on — rather than measuring pixels.
 */

const css = (file: string) => readFileSync(path.resolve(__dirname, '..', file), 'utf8').replace(/\s+/g, ' ');
const S = '11111111-1111-4111-8111-111111111111';
const base = (p: string) => new RegExp(`^/merchant/stores/${S}${p}$`);
vi.mock('../src/hooks/useStore', () => ({ useActiveStore: () => ({ activeStoreId: S, setActiveStoreId: () => undefined }) }));
afterEach(async () => {
  await cleanup();
  delete (window as any).BarcodeDetector;
});

describe('phone-width layout rules', () => {
  it('dialog footers wrap, so a third button is never pushed out of the dialog', () => {
    expect(css('src/styles/components.css')).toMatch(/\.dialog-footer \{[^}]*flex-wrap: wrap;/);
  });

  it('tables of sentences keep readable columns and scroll inside their frame on a phone', () => {
    expect(css('src/features/tools/Tools.css')).toMatch(/@media \(max-width: 640px\) \{ \.table-scroll > \.table \{ min-width: 600px; \} \}/);
  });

  it('the till search keeps its overlays clear of the camera button', () => {
    const sales = css('src/features/sales/Sales.css');
    expect(sales).toMatch(/\.sale-search-bar\.has-camera \.sale-search-shortcut, \.sale-search-bar\.has-camera \.sale-search-clear \{ right: 48px; \}/);
    expect(sales).toMatch(/@media \(hover: none\) \{ \.sale-search-shortcut \{ display: none; \} \}/);
  });
});

describe('screens use them', () => {
  it('Insights and What to reorder put their tables in a scrolling frame', async () => {
    fakeServer([
      ['GET', base('/intelligence/stock'), () => ({ data: { stock: { today: '', horizonDays: 14, leadDays: 7, counts: {}, method: '', items: [{ productId: 'p', variantId: 'v', name: 'Rice', available: 4, soldLast30: 0, forecast: { confidence: 'insufficient', reason: 'Only 2 days of history.', dailyAverage: null, nextDaysUnits: null, horizonDays: 14 }, health: { status: 'unknown', daysOfCover: null, note: 'x' }, proposedReorderQuantity: null }] } } })],
      ['GET', base('/purchase-suggestions'), () => ({ data: { suggestions: { coverDays: 14, lookbackDays: 30, suggestions: [{ productId: 'p', productName: 'Rice', variantId: 'v', variantName: null, sku: null, available: 1, onDraftPurchases: 0, soldLastPeriod: 4, dailyRate: 0.13, suggestedQuantity: 5, lastCostPaise: 100, estimatedCostPaise: 500, reason: 'Sold 4 in 30 days.' }] } } })],
      ['GET', base('/suppliers'), () => ({ data: { suppliers: [] } })],
    ]);
    await render(<InsightsPage />);
    await waitFor(() => text().includes('Only 2 days of history.'));
    expect(document.querySelector('.table-container.table-scroll > table')).not.toBeNull();
    await cleanup();
    await render(<SuggestionsPage />);
    await waitFor(() => text().includes('Sold 4 in 30 days.'));
    expect(document.querySelector('.table-container.table-scroll > table')).not.toBeNull();
  });

  it('the till search bar makes room for the camera button only when there is one', async () => {
    fakeServer([
      ['GET', base('/categories'), () => ({ data: { categories: [] } })],
      ['GET', base('/products'), () => ({ data: { products: [] }, meta: { page: 1, limit: 100, total: 0, totalPages: 0, hasNextPage: false } })],
    ]);
    await render(<NewSalePage />);
    await waitFor(() => document.querySelector('.sale-search-bar'));
    expect(document.querySelector('.sale-search-bar')!.classList.contains('has-camera')).toBe(false);
    await cleanup();
    (window as any).BarcodeDetector = class {};
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: vi.fn() }, configurable: true });
    await render(<NewSalePage />);
    await waitFor(() => document.querySelector('.sale-search-bar'));
    expect(document.querySelector('.sale-search-bar')!.classList.contains('has-camera')).toBe(true);
  });
});

describe('spacing and dropdowns', () => {
  it('summary tiles do not inherit the big-number letter-spacing that squeezed their labels', () => {
    const tools = css('src/features/tools/Tools.css');
    expect(tools).toMatch(/\.metric-tile \{/);
    expect(tools).toMatch(/\.metric__label \{[^}]*letter-spacing: 0\.01em;/);
    expect(tools).not.toMatch(/(^|\s)\.metric \{/);
    // No screen uses the global .metric class for a tile any more.
    for (const page of ['KhataPage', 'BatchesPage', 'AnalyticsPage']) {
      expect(readFileSync(path.resolve(__dirname, '..', `src/features/tools/${page}.tsx`), 'utf8')).not.toMatch(/className="metric[ "]/);
    }
  });

  it('every dropdown gets the same inset chevron, not the browser arrow', () => {
    const components = css('src/styles/components.css');
    expect(components).toMatch(/\.select-field, select\.input-field \{[^}]*appearance: none;[^}]*background-position: right 12px center;[^}]*padding-right: 40px;/);
  });

  it('fields in a filter bar line up on their bottom edge', () => {
    expect(css('src/styles/components.css')).toMatch(/\.filters-bar \{[^}]*align-items: flex-end;/);
  });
});
