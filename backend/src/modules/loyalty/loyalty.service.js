import { supabaseAdmin } from '../../lib/supabase.js';
import { conflict, internal, notFound, unprocessable } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import * as notifications from '../notifications/notification.service.js';
import { PROGRAM_COLUMNS, COUPON_COLUMNS, toPublicCoupon, loyaltyProgram, loyaltyBalance } from '../benefits/benefits.service.js';

/**
 * Merchant loyalty — roadmap §4 P3 (rules, rewards, history) and §5 P4
 * (points & rewards history), §6 Loyalty flow.
 *
 * Points move only through post_loyalty_points (migration 0042), which locks
 * the account, refuses to go below zero and writes an immutable ledger row
 * with the balance after it. Earning and returning points happen in the order
 * trigger, so no caller can forget them. A merchant's correction is an
 * 'adjust' entry with a reason — never an edit.
 */

const LEDGER_COLUMNS = 'id, store_id, customer_id, order_id, reward_id, kind, points, points_after, note, created_by_type, created_at';
const REWARD_COLUMNS = 'id, store_id, name, description, points_cost, discount_type, percent_off, amount_off_paise, is_active, created_at';

const fail = (error, message) => {
  if (error) throw internal(message);
};

const KIND_LABELS = {
  earn: 'Earned',
  bonus: 'Welcome bonus',
  redeem: 'Used on an order',
  reverse_redeem: 'Returned (order cancelled)',
  reward: 'Redeemed for a reward',
  adjust: 'Adjusted by the store',
  expire: 'Expired',
};

export const toProgram = (row) =>
  row
    ? {
        isActive: row.is_active,
        earnPointsPer100: row.earn_points_per_100,
        pointValuePaise: row.point_value_paise,
        minOrderPaiseToEarn: row.min_order_paise_to_earn,
        minRedeemPoints: row.min_redeem_points,
        maxRedeemPercent: row.max_redeem_percent,
        welcomeBonusPoints: row.welcome_bonus_points,
        pointsExpireDays: row.points_expire_days ?? null,
        // In words, for both apps.
        summary: `Earn ${row.earn_points_per_100} point${row.earn_points_per_100 === 1 ? '' : 's'} for every ₹100. Each point is worth ₹${(row.point_value_paise / 100).toFixed(2)}.`,
      }
    : null;

export const toLedgerEntry = (row) => ({
  id: row.id,
  kind: row.kind,
  label: KIND_LABELS[row.kind] ?? row.kind,
  points: row.points,
  pointsAfter: row.points_after,
  orderId: row.order_id ?? null,
  rewardId: row.reward_id ?? null,
  note: row.note ?? null,
  by: row.created_by_type,
  at: row.created_at,
});

export const toReward = (row) => ({
  id: row.id,
  name: row.name,
  description: row.description ?? null,
  pointsCost: row.points_cost,
  discountType: row.discount_type,
  percentOff: row.percent_off ?? null,
  amountOffPaise: row.amount_off_paise ?? null,
  isActive: row.is_active,
});

// ── Merchant ────────────────────────────────────────────────────────────────

export async function getProgram(store) {
  return toProgram(await loyaltyProgram(store.id));
}

export async function saveProgram(store, input) {
  const row = { store_id: store.id };
  const map = {
    isActive: 'is_active', earnPointsPer100: 'earn_points_per_100', pointValuePaise: 'point_value_paise',
    minOrderPaiseToEarn: 'min_order_paise_to_earn', minRedeemPoints: 'min_redeem_points',
    maxRedeemPercent: 'max_redeem_percent', welcomeBonusPoints: 'welcome_bonus_points', pointsExpireDays: 'points_expire_days',
  };
  for (const [key, column] of Object.entries(map)) if (input[key] !== undefined) row[column] = input[key];
  const { error } = await supabaseAdmin.from('loyalty_programs').upsert(row, { onConflict: 'store_id' });
  fail(error, 'Could not save the loyalty programme.');
  return getProgram(store);
}

export async function listRewards(storeId, { activeOnly = false } = {}) {
  let query = supabaseAdmin.from('loyalty_rewards').select(REWARD_COLUMNS).eq('store_id', storeId);
  if (activeOnly) query = query.eq('is_active', true);
  const { data, error } = await query.order('points_cost', { ascending: true });
  fail(error, 'Could not load the rewards.');
  return (data ?? []).map(toReward);
}

const rewardRow = (input) => ({
  ...(input.name !== undefined ? { name: input.name } : {}),
  ...(input.description !== undefined ? { description: input.description } : {}),
  ...(input.pointsCost !== undefined ? { points_cost: input.pointsCost } : {}),
  ...(input.discountType !== undefined
    ? {
        discount_type: input.discountType,
        percent_off: input.discountType === 'percent' ? input.percentOff : null,
        amount_off_paise: input.discountType === 'flat' ? input.amountOffPaise : null,
      }
    : {}),
  ...(input.isActive !== undefined ? { is_active: input.isActive } : {}),
});

export async function createReward(store, input) {
  const { data, error } = await supabaseAdmin
    .from('loyalty_rewards')
    .insert({ store_id: store.id, ...rewardRow(input) })
    .select(REWARD_COLUMNS)
    .maybeSingle();
  if (error?.code === '23514') throw unprocessable('REWARD_INVALID', 'Give a percent (1–100) or an amount, matching the reward type.');
  fail(error, 'Could not save the reward.');
  return toReward(data);
}

export async function updateReward(store, rewardId, input) {
  const { data, error } = await supabaseAdmin
    .from('loyalty_rewards')
    .update(rewardRow(input))
    .eq('id', rewardId)
    .eq('store_id', store.id)
    .select(REWARD_COLUMNS)
    .maybeSingle();
  if (error?.code === '23514') throw unprocessable('REWARD_INVALID', 'Give a percent (1–100) or an amount, matching the reward type.');
  fail(error, 'Could not save the reward.');
  if (!data) throw notFound('Reward');
  return toReward(data);
}

/** Every member's balance at the store, highest first. */
export async function listMembers(store, { page = 1, limit = 50 }) {
  const from = (page - 1) * limit;
  const { data, count, error } = await supabaseAdmin
    .from('loyalty_accounts')
    .select('customer_id, current_points, lifetime_earned, lifetime_redeemed, updated_at', { count: 'exact' })
    .eq('store_id', store.id)
    .order('current_points', { ascending: false })
    .range(from, from + limit - 1);
  fail(error, 'Could not load the members.');
  const rows = data ?? [];
  const names = new Map();
  if (rows.length) {
    const { data: customers } = await supabaseAdmin.from('customers').select('id, full_name').in('id', rows.map((r) => r.customer_id));
    for (const c of customers ?? []) names.set(c.id, c.full_name);
  }
  return {
    members: rows.map((row) => ({
      customerId: row.customer_id,
      name: names.get(row.customer_id) ?? null,
      points: row.current_points,
      lifetimeEarned: row.lifetime_earned,
      lifetimeRedeemed: row.lifetime_redeemed,
      updatedAt: row.updated_at,
    })),
    total: count ?? 0,
  };
}

export async function ledgerFor(storeId, customerId, { limit = 50 } = {}) {
  const { data, error } = await supabaseAdmin
    .from('loyalty_ledger')
    .select(LEDGER_COLUMNS)
    .eq('store_id', storeId)
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })
    .limit(limit);
  fail(error, 'Could not load the points history.');
  return (data ?? []).map(toLedgerEntry);
}

async function assertCustomerOfStore(store, customerId) {
  const { data, error } = await supabaseAdmin
    .from('orders')
    .select('id')
    .eq('store_id', store.id)
    .eq('customer_id', customerId)
    .limit(1);
  fail(error, 'Could not load the customer.');
  const { data: account } = await supabaseAdmin
    .from('loyalty_accounts')
    .select('customer_id')
    .eq('store_id', store.id)
    .eq('customer_id', customerId)
    .maybeSingle();
  if ((data ?? []).length === 0 && !account) throw notFound('Customer');
}

/** A merchant's correction: a signed adjustment with a reason. */
export async function adjustPoints(store, merchant, customerId, { points, reason }) {
  await assertCustomerOfStore(store, customerId);
  const { data, error } = await supabaseAdmin.rpc('post_loyalty_points', {
    p_store_id: store.id,
    p_customer_id: customerId,
    p_kind: 'adjust',
    p_points: points,
    p_order_id: null,
    p_reward_id: null,
    p_note: reason,
    p_created_by_type: 'merchant',
    p_created_by_id: merchant.id,
  });
  if (error) {
    if ((error.message ?? '').includes('INSUFFICIENT_POINTS')) {
      throw unprocessable('INSUFFICIENT_POINTS', 'That would take the balance below zero.');
    }
    logger.error('post_loyalty_points failed', { message: error.message });
    throw internal('Could not adjust the points.');
  }
  await notifications.emit(customerId, {
    type: 'loyalty_updated',
    title: `${store.name} ${points > 0 ? 'added' : 'removed'} ${Math.abs(points)} points`,
    body: reason,
    payload: { store_id: store.id },
  });
  return { balance: Number(data), history: await ledgerFor(store.id, customerId) };
}

// ── Customer ────────────────────────────────────────────────────────────────

async function publicStore(storeId) {
  const { data, error } = await supabaseAdmin
    .from('stores')
    .select('id, slug, name, logo_url, is_active, is_published')
    .eq('id', storeId)
    .maybeSingle();
  fail(error, 'Could not load the store.');
  if (!data || !data.is_active || !data.is_published) throw notFound('Store');
  return data;
}

/** The customer's points and rewards at one store. */
export async function myLoyalty(customerId, storeId) {
  const store = await publicStore(storeId);
  const program = await loyaltyProgram(storeId);
  const balance = await loyaltyBalance(storeId, customerId);
  const [history, rewards] = await Promise.all([
    ledgerFor(storeId, customerId),
    program?.is_active ? listRewards(storeId, { activeOnly: true }) : [],
  ]);
  return {
    store: { id: store.id, slug: store.slug, name: store.name },
    program: program?.is_active ? toProgram(program) : null,
    balance: {
      points: balance.current_points,
      valuePaise: program?.is_active ? balance.current_points * program.point_value_paise : 0,
      lifetimeEarned: balance.lifetime_earned,
      lifetimeRedeemed: balance.lifetime_redeemed,
    },
    rewards: rewards.map((reward) => ({ ...reward, canRedeem: balance.current_points >= reward.pointsCost })),
    history,
  };
}

/** Every store where the customer has points. */
export async function myLoyaltyAccounts(customerId) {
  const { data, error } = await supabaseAdmin
    .from('loyalty_accounts')
    .select('store_id, current_points, lifetime_earned, updated_at')
    .eq('customer_id', customerId)
    .order('updated_at', { ascending: false });
  fail(error, 'Could not load your points.');
  const rows = data ?? [];
  const stores = new Map();
  if (rows.length) {
    const { data: storeRows } = await supabaseAdmin.from('stores').select('id, slug, name, logo_url').in('id', rows.map((r) => r.store_id));
    for (const row of storeRows ?? []) stores.set(row.id, row);
  }
  return rows.map((row) => ({
    store: stores.get(row.store_id) ? { id: row.store_id, slug: stores.get(row.store_id).slug, name: stores.get(row.store_id).name } : null,
    points: row.current_points,
    lifetimeEarned: row.lifetime_earned,
  }));
}

/** Points for a reward: a personal single-use coupon, in one transaction. */
export async function redeemReward(customerId, storeId, rewardId) {
  await publicStore(storeId);
  const { data, error } = await supabaseAdmin.rpc('redeem_loyalty_reward', {
    p_store_id: storeId,
    p_customer_id: customerId,
    p_reward_id: rewardId,
  });
  if (error) {
    const message = error.message ?? '';
    if (message.includes('REWARD_NOT_FOUND')) throw notFound('Reward');
    if (message.includes('PROGRAM_INACTIVE')) throw conflict('This store’s loyalty programme is paused.');
    if (message.includes('INSUFFICIENT_POINTS')) throw unprocessable('INSUFFICIENT_POINTS', 'You do not have enough points for this reward yet.');
    logger.error('redeem_loyalty_reward failed', { message });
    throw internal('Could not redeem the reward.');
  }
  const couponId = Array.isArray(data) ? data[0] : data;
  const { data: coupon, error: couponError } = await supabaseAdmin.from('coupons').select(COUPON_COLUMNS).eq('id', couponId).maybeSingle();
  fail(couponError, 'Could not load the reward coupon.');
  return { coupon: toPublicCoupon(coupon), ...(await myLoyalty(customerId, storeId)) };
}
