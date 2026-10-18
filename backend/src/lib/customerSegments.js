/**
 * Customer segments — roadmap §4 P2 "Customer status", P4 "Customer
 * segments", §5 P4 first-order / repeat-customer benefits. Deterministic, from
 * completed orders at one store only, so the same data always gives the same
 * answer and a merchant can read the rule:
 *
 *   prospect  no completed order yet
 *   new       exactly one completed order, within the last 60 days
 *   active    two or more completed orders, the last within 60 days
 *   loyal     five or more completed orders in the last 180 days, the last within 60 days
 *   inactive  has ordered, but not in the last 60 days
 *
 * Pure: the caller passes the completion times and the clock.
 */

export const SEGMENT_RULES = Object.freeze({
  activeWithinDays: 60,
  loyalMinOrders: 5,
  loyalWindowDays: 180,
});

export const SEGMENT_LABELS = {
  prospect: 'Prospect',
  new: 'New',
  active: 'Active',
  loyal: 'Loyal',
  inactive: 'Inactive',
};

const DAY = 86_400_000;

export function segmentFor(completedAt, now = new Date(), rules = SEGMENT_RULES) {
  const times = completedAt.map((value) => new Date(value).getTime()).sort((a, b) => a - b);
  if (times.length === 0) return 'prospect';
  const last = times[times.length - 1];
  const sinceLast = (now.getTime() - last) / DAY;
  if (sinceLast > rules.activeWithinDays) return 'inactive';
  const inLoyalWindow = times.filter((t) => (now.getTime() - t) / DAY <= rules.loyalWindowDays).length;
  if (inLoyalWindow >= rules.loyalMinOrders) return 'loyal';
  return times.length === 1 ? 'new' : 'active';
}

/**
 * Value and rhythm from one customer's completed orders at one store:
 * total spend, first and last order, order count, average order value, and
 * the median gap between orders (null with fewer than two).
 */
export function customerValue(orders) {
  const done = orders
    .filter((order) => order.status === 'completed')
    .sort((a, b) => new Date(a.completed_at ?? a.placed_at) - new Date(b.completed_at ?? b.placed_at));
  const totalSpendPaise = done.reduce((sum, order) => sum + order.total_paise, 0);
  const gaps = [];
  for (let i = 1; i < done.length; i += 1) {
    gaps.push((new Date(done[i].completed_at ?? done[i].placed_at) - new Date(done[i - 1].completed_at ?? done[i - 1].placed_at)) / DAY);
  }
  gaps.sort((a, b) => a - b);
  const median = gaps.length === 0 ? null : gaps.length % 2 ? gaps[(gaps.length - 1) / 2] : (gaps[gaps.length / 2 - 1] + gaps[gaps.length / 2]) / 2;
  return {
    orderCount: done.length,
    totalSpendPaise,
    averageOrderPaise: done.length ? Math.round(totalSpendPaise / done.length) : 0,
    firstOrderAt: done[0]?.completed_at ?? done[0]?.placed_at ?? null,
    lastOrderAt: done.at(-1)?.completed_at ?? done.at(-1)?.placed_at ?? null,
    medianDaysBetweenOrders: median === null ? null : Math.round(median * 10) / 10,
  };
}

/** Products bought most often (by number of orders containing them, then units). */
export function favouriteProducts(items, limit = 5) {
  const byProduct = new Map();
  for (const item of items) {
    if (!item.product_id) continue;
    const entry = byProduct.get(item.product_id) ?? { productId: item.product_id, name: item.product_name, orders: new Set(), units: 0 };
    entry.orders.add(item.order_id);
    entry.units += item.quantity;
    byProduct.set(item.product_id, entry);
  }
  return [...byProduct.values()]
    .map((entry) => ({ productId: entry.productId, name: entry.name, orderCount: entry.orders.size, units: entry.units }))
    .filter((entry) => entry.orderCount >= 2)
    .sort((a, b) => b.orderCount - a.orderCount || b.units - a.units || a.name.localeCompare(b.name))
    .slice(0, limit);
}
