import { supabaseAdmin } from '../../lib/supabase.js';
import { internal } from '../../lib/errors.js';
import { formatPaise } from '../../lib/pricing.js';
import { segmentFor } from '../../lib/customerSegments.js';
import { localDate } from '../../lib/khataAgeing.js';

/**
 * Coupons and loyalty points at checkout — roadmap §5 P4 Coupons,
 * First-order / repeat-customer benefits, Occasion offers, Favourite-store
 * benefits, Merchant-specific loyalty; §6 Loyalty flow.
 *
 * Decided here, deterministically, for the quote the customer sees; then
 * re-checked under row locks by create_order (migration 0042), which is what
 * stops two orders at once both taking the last use of a coupon or the same
 * points. Benefits never reduce what is owed below zero, never discount the
 * delivery fee except through a free-delivery coupon, and are scoped to one
 * store: a coupon or point balance from one shop means nothing at another.
 */

export const COUPON_COLUMNS = `
  id, store_id, code, title, description, discount_type, percent_off, amount_off_paise, max_discount_paise,
  min_order_paise, starts_at, ends_at, max_uses, max_uses_per_customer, audience, customer_id,
  stackable_with_loyalty, is_active, source, created_at, updated_at
`;
export const PROGRAM_COLUMNS = `
  store_id, is_active, earn_points_per_100, point_value_paise, min_order_paise_to_earn, min_redeem_points,
  max_redeem_percent, welcome_bonus_points, points_expire_days, updated_at
`;

const fail = (error, message) => {
  if (error) throw internal(message);
};

export const COUPON_REASON_MESSAGES = {
  not_found: 'That code is not valid at this store.',
  inactive: 'That coupon is no longer active.',
  not_started: 'That coupon has not started yet.',
  expired: 'That coupon has expired.',
  used_up: 'That coupon has been fully used.',
  already_used: 'You have already used this coupon.',
  not_yours: 'That coupon belongs to someone else.',
  min_order: 'Add more to your order to use this coupon.',
  not_delivery: 'Free delivery applies to delivery orders only.',
  audience_new: 'This coupon is for your first order at this store.',
  audience_returning: 'This coupon is for customers who have ordered here before.',
  audience_loyal: 'This coupon is for the store’s loyal customers.',
  audience_followers: 'Save this store to use this coupon.',
  audience_birthday: 'This coupon is for your birthday week (turn on occasion offers in your profile).',
};

export async function loyaltyProgram(storeId) {
  const { data, error } = await supabaseAdmin.from('loyalty_programs').select(PROGRAM_COLUMNS).eq('store_id', storeId).maybeSingle();
  fail(error, 'Could not load the loyalty programme.');
  return data ?? null;
}

export async function loyaltyBalance(storeId, customerId) {
  const { data, error } = await supabaseAdmin
    .from('loyalty_accounts')
    .select('current_points, lifetime_earned, lifetime_redeemed')
    .eq('store_id', storeId)
    .eq('customer_id', customerId)
    .maybeSingle();
  fail(error, 'Could not load your points.');
  return data ?? { current_points: 0, lifetime_earned: 0, lifetime_redeemed: 0 };
}

/** Everything about this customer at this store that a coupon audience can depend on. */
export async function customerStanding(store, customerId, now = new Date()) {
  const [orders, saved, customer, prefs] = await Promise.all([
    supabaseAdmin.from('orders').select('status, completed_at, placed_at').eq('store_id', store.id).eq('customer_id', customerId),
    supabaseAdmin.from('saved_stores').select('store_id').eq('store_id', store.id).eq('customer_id', customerId).maybeSingle(),
    supabaseAdmin.from('customers').select('birthday_month, birthday_day, occasion_offers').eq('id', customerId).maybeSingle(),
    supabaseAdmin.from('customer_store_preferences').select('allow_promotions').eq('store_id', store.id).eq('customer_id', customerId).maybeSingle(),
  ]);
  fail(orders.error || saved.error || customer.error || prefs.error, 'Could not check your eligibility.');

  const rows = orders.data ?? [];
  const completed = rows.filter((o) => o.status === 'completed').map((o) => o.completed_at ?? o.placed_at);
  const inProgress = rows.filter((o) => !['cancelled', 'rejected', 'pending_payment', 'completed'].includes(o.status));

  return {
    completedOrders: completed.length,
    isFirstOrder: completed.length === 0 && inProgress.length === 0,
    segment: segmentFor(completed, now),
    isFollower: Boolean(saved.data),
    isBirthdayWeek: isBirthdayWeek(customer.data, localDate(now, store.timezone)),
    occasionConsent: Boolean(customer.data?.occasion_offers) && Boolean(prefs.data?.allow_promotions),
  };
}

/** Within seven days either side of the customer's birthday (month/day), across a year end. */
export function isBirthdayWeek(customer, today) {
  if (!customer?.birthday_month || !customer?.birthday_day) return false;
  const [y, m, d] = today.split('-').map(Number);
  const todayUtc = Date.UTC(y, m - 1, d);
  return [y - 1, y, y + 1].some((year) => {
    const birthday = Date.UTC(year, customer.birthday_month - 1, customer.birthday_day);
    return Math.abs(todayUtc - birthday) <= 7 * 86_400_000;
  });
}

async function couponUses(couponId, customerId) {
  const { data, error } = await supabaseAdmin
    .from('coupon_redemptions')
    .select('customer_id')
    .eq('coupon_id', couponId)
    .eq('status', 'applied');
  fail(error, 'Could not check the coupon.');
  const rows = data ?? [];
  return { total: rows.length, mine: rows.filter((row) => row.customer_id === customerId).length };
}

/**
 * Whether this coupon applies, and for how much. `subtotalPaise` is the item
 * value after offers; `deliveryFeePaise` is what delivery would cost.
 */
export async function evaluateCoupon(coupon, { store, customerId, standing, subtotalPaise, deliveryFeePaise, fulfilmentMode, now = new Date() }) {
  const refuse = (reason, extra = {}) => ({
    applies: false,
    reason,
    message: reason === 'min_order'
      ? `Add ${formatPaise(coupon.min_order_paise - subtotalPaise)} more to use ${coupon.code}.`
      : COUPON_REASON_MESSAGES[reason],
    ...extra,
  });

  if (!coupon.is_active) return refuse('inactive');
  if (now < new Date(coupon.starts_at)) return refuse('not_started');
  if (coupon.ends_at && now >= new Date(coupon.ends_at)) return refuse('expired');
  if (coupon.customer_id && coupon.customer_id !== customerId) return refuse('not_yours');

  const uses = await couponUses(coupon.id, customerId);
  if (coupon.max_uses !== null && uses.total >= coupon.max_uses) return refuse('used_up');
  if (uses.mine >= coupon.max_uses_per_customer) return refuse('already_used');

  const audienceOk = {
    all: true,
    new: standing.isFirstOrder,
    returning: standing.completedOrders >= 1,
    loyal: standing.segment === 'loyal',
    followers: standing.isFollower,
    birthday: standing.isBirthdayWeek && standing.occasionConsent,
  }[coupon.audience];
  if (!audienceOk) return refuse(`audience_${coupon.audience}`);
  if (subtotalPaise < coupon.min_order_paise) return refuse('min_order');

  if (coupon.discount_type === 'free_delivery') {
    if (fulfilmentMode !== 'delivery') return refuse('not_delivery');
    return { applies: true, discountPaise: 0, waivedDeliveryPaise: deliveryFeePaise };
  }
  let discount =
    coupon.discount_type === 'percent'
      ? Math.floor((subtotalPaise * coupon.percent_off) / 100)
      : coupon.amount_off_paise;
  if (coupon.max_discount_paise !== null) discount = Math.min(discount, coupon.max_discount_paise);
  return { applies: true, discountPaise: Math.min(discount, subtotalPaise), waivedDeliveryPaise: 0 };
}

export const toPublicCoupon = (row) => ({
  id: row.id,
  code: row.code,
  title: row.title,
  description: row.description ?? null,
  discountType: row.discount_type,
  percentOff: row.percent_off ?? null,
  amountOffPaise: row.amount_off_paise ?? null,
  maxDiscountPaise: row.max_discount_paise ?? null,
  minOrderPaise: row.min_order_paise,
  startsAt: row.starts_at,
  endsAt: row.ends_at ?? null,
  audience: row.audience,
  isPersonal: Boolean(row.customer_id),
  stackableWithLoyalty: row.stackable_with_loyalty,
});

async function findCouponByCode(storeId, code) {
  const { data, error } = await supabaseAdmin
    .from('coupons')
    .select(COUPON_COLUMNS)
    .eq('store_id', storeId)
    .eq('code', code)
    .maybeSingle();
  fail(error, 'Could not check the coupon.');
  return data ?? null;
}

/**
 * The coupons this customer could use here now, with what each would take
 * off this basket — "offers for you", from deterministic rules only.
 */
export async function couponsForCustomer(store, customerId, { subtotalPaise = 0, deliveryFeePaise = 0, fulfilmentMode = 'pickup', now = new Date() } = {}) {
  const { data, error } = await supabaseAdmin
    .from('coupons')
    .select(COUPON_COLUMNS)
    .eq('store_id', store.id)
    .eq('is_active', true)
    .order('created_at', { ascending: false });
  fail(error, 'Could not load coupons.');

  const standing = await customerStanding(store, customerId, now);
  const result = [];
  for (const coupon of data ?? []) {
    if (coupon.customer_id && coupon.customer_id !== customerId) continue;
    const verdict = await evaluateCoupon(coupon, { store, customerId, standing, subtotalPaise, deliveryFeePaise, fulfilmentMode, now });
    // Shown when usable now, or when only the basket size stands in the way.
    if (verdict.applies || verdict.reason === 'min_order' || verdict.reason === 'not_delivery') {
      result.push({ ...toPublicCoupon(coupon), applies: verdict.applies, reason: verdict.reason ?? null, message: verdict.message ?? null, discountPaise: verdict.discountPaise ?? 0, waivedDeliveryPaise: verdict.waivedDeliveryPaise ?? 0 });
    }
  }
  return result;
}

/**
 * The benefits on one basket: the coupon (if a code was given) and points (if
 * asked for). Returns what to take off, and any reason it could not be given
 * — as blockers, so the customer decides rather than being charged a surprise.
 */
export async function evaluateBenefits(store, customerId, { couponCode, redeemPoints, subtotalPaise, deliveryFeePaise, fulfilmentMode, now = new Date() }) {
  const blockers = [];
  let coupon = null;
  let couponDiscount = 0;
  let waivedDelivery = 0;

  if (couponCode) {
    const row = await findCouponByCode(store.id, couponCode);
    if (!row) {
      blockers.push({ code: 'COUPON_INVALID', reason: 'not_found', message: COUPON_REASON_MESSAGES.not_found });
    } else {
      const standing = await customerStanding(store, customerId, now);
      const verdict = await evaluateCoupon(row, { store, customerId, standing, subtotalPaise, deliveryFeePaise, fulfilmentMode, now });
      coupon = { ...toPublicCoupon(row), applies: verdict.applies, discountPaise: verdict.discountPaise ?? 0, waivedDeliveryPaise: verdict.waivedDeliveryPaise ?? 0, row };
      if (!verdict.applies) {
        blockers.push({ code: 'COUPON_INVALID', reason: verdict.reason, message: verdict.message });
      } else {
        couponDiscount = verdict.discountPaise;
        waivedDelivery = verdict.waivedDeliveryPaise;
      }
    }
  }

  const program = await loyaltyProgram(store.id);
  const balance = program?.is_active ? (await loyaltyBalance(store.id, customerId)).current_points : 0;
  let pointsUsed = 0;
  let pointsDiscount = 0;
  let maxRedeemablePoints = 0;
  if (program?.is_active) {
    const room = Math.floor(((subtotalPaise - couponDiscount) * program.max_redeem_percent) / 100);
    maxRedeemablePoints = Math.max(0, Math.min(balance, Math.floor(room / program.point_value_paise)));
  }
  if (redeemPoints) {
    if (!program?.is_active) {
      blockers.push({ code: 'LOYALTY_UNAVAILABLE', message: 'This store has no loyalty programme running.' });
    } else if (coupon?.applies && !coupon.stackableWithLoyalty) {
      blockers.push({ code: 'NOT_STACKABLE', message: `${coupon.code} cannot be combined with points. Remove one of them.` });
    } else if (redeemPoints > balance) {
      blockers.push({ code: 'INSUFFICIENT_POINTS', message: `You have ${balance} points here.` });
    } else if (redeemPoints < program.min_redeem_points) {
      blockers.push({ code: 'BELOW_MIN_REDEEM', message: `Redeem at least ${program.min_redeem_points} points at a time.` });
    } else if (redeemPoints > maxRedeemablePoints) {
      blockers.push({
        code: 'ABOVE_MAX_REDEEM',
        message: `Points can pay for at most ${program.max_redeem_percent}% of this order — up to ${maxRedeemablePoints} points.`,
        maxRedeemablePoints,
      });
    } else {
      pointsUsed = redeemPoints;
      pointsDiscount = redeemPoints * program.point_value_paise;
    }
  }

  return {
    blockers,
    discountPaise: couponDiscount + pointsDiscount,
    waivedDeliveryPaise: waivedDelivery,
    coupon: coupon
      ? (({ row, ...rest }) => rest)(coupon)
      : null,
    couponRow: coupon?.applies ? coupon.row : null,
    loyalty: program?.is_active
      ? {
          balancePoints: balance,
          pointValuePaise: program.point_value_paise,
          maxRedeemablePoints,
          pointsUsed,
          discountPaise: pointsDiscount,
          earnPointsPer100: program.earn_points_per_100,
        }
      : null,
  };
}
