import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, click, byLabel, byText, fakeServer, render, text, type, waitFor } from './helpers/render';
import OrderDetailModal from '../src/features/orders/OrderDetailModal';

/**
 * When the shop cannot pack everything: mark a line not available, or pack
 * fewer, and the order goes ahead with the rest.
 */

const S = '11111111-1111-4111-8111-111111111111';
const O = '22222222-2222-4222-8222-222222222222';

const line = (over: Record<string, unknown> = {}) => ({
  id: 'i1', productId: 'p1', variantId: 'v1', productName: 'Basmati Rice', variantName: '1 kg', sku: 'RICE-1KG',
  quantity: 3, unitPricePaise: 12000, lineSubtotalPaise: 36000, taxPercent: 5, taxPaise: 1800, lineTotalPaise: 37800,
  orderedQuantity: 3, unavailableQuantity: 0, ...over,
});
const order = (over: Record<string, unknown> = {}) => ({
  id: O, orderNumber: 'CPSE-261124-ABC123', status: 'accepted', statusLabel: 'Accepted by the store', paymentStatus: 'pending',
  paymentMethod: 'cash', fulfilmentMode: 'pickup', allowedActions: ['status:preparing', 'reject', 'cancel'],
  customer: { id: 'c1', name: 'Asha Verma', phone: null }, customerNote: null, cancellationReason: null,
  totals: { subtotalPaise: 36000, discountPaise: 0, deliveryFeePaise: 0, taxPaise: 1800, totalPaise: 37800 },
  itemCount: 1, placedAt: '2026-11-24T10:00:00Z', acceptedAt: null, completedAt: null, cancelledAt: null,
  items: [line()], unavailableItems: [], replacedItems: [], substitutions: [], refundAdjustments: [], refund: null,
  substitutionPreference: 'no_substitutions', canChangeItems: true, itemsChangedAt: null, history: [],
  ...over,
});

afterEach(cleanup);

describe("an item the shop can't pack", () => {
  it('packs fewer: asks how many, sends it, and shows "2 of 3"', async () => {
    const sent = fakeServer([
      ['GET', new RegExp(`/orders/${O}$`), () => ({ data: { order: order() } })],
      ['POST', new RegExp(`/orders/${O}/items/i1/unavailable$`), (req) => ({
        data: { order: order({ items: [line({ quantity: req.body.quantityLeft, orderedQuantity: 3, unavailableQuantity: 3 - req.body.quantityLeft, lineTotalPaise: 25200 })], itemsChangedAt: '2026-11-24T10:05:00Z', totals: { subtotalPaise: 24000, discountPaise: 0, deliveryFeePaise: 0, taxPaise: 1200, totalPaise: 25200 } }) },
      })],
    ]);
    await render(<OrderDetailModal storeId={S} orderId={O} onClose={() => undefined} />);
    await waitFor(() => text().includes('Basmati Rice'));
    await click(byText('button', "Can't pack…"));
    await type(byLabel('How many can you pack?') as HTMLSelectElement, '2');
    await click(byText('button', 'Pack only 2'));
    await waitFor(() => text().includes('of 3 (1 not available)'));
    expect(sent.find((r) => r.method === 'POST')!.body).toEqual({ quantityLeft: 2 });
    expect(text()).toContain('New total ₹252.00');
    expect(text()).toContain('can cancel the order while it is being prepared');
  });

  it('removes a line it has none of, and lists it as not available', async () => {
    fakeServer([
      ['GET', new RegExp(`/orders/${O}$`), () => ({ data: { order: order({ items: [line(), line({ id: 'i2', productName: 'Toor Dal', variantName: null, quantity: 1 })] }) } })],
      ['POST', new RegExp(`/orders/${O}/items/i2/unavailable$`), () => ({
        data: { order: order({ unavailableItems: [line({ id: 'i2', productName: 'Toor Dal', variantName: null, quantity: 1, orderedQuantity: 1 })], itemsChangedAt: '2026-11-24T10:05:00Z' }) },
      })],
    ]);
    await render(<OrderDetailModal storeId={S} orderId={O} onClose={() => undefined} />);
    await waitFor(() => text().includes('Toor Dal'));
    await click(document.querySelectorAll<HTMLButtonElement>('.line-actions button')[1]);
    await click(byText('button', 'Remove from order'));
    await waitFor(() => text().includes('Not available, removed: Toor Dal × 1'));
  });

  it("isn't offered once the order is ready", async () => {
    fakeServer([['GET', new RegExp(`/orders/${O}$`), () => ({ data: { order: order({ status: 'ready_for_pickup', canChangeItems: false }) } })]]);
    await render(<OrderDetailModal storeId={S} orderId={O} onClose={() => undefined} />);
    await waitFor(() => text().includes('Basmati Rice'));
    expect(text()).not.toContain("Can't pack");
  });
});
