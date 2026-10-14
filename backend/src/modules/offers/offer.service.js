import { supabaseAdmin } from '../../lib/supabase.js';
import { conflict, internal, notFound, unprocessable } from '../../lib/errors.js';
import { offerEndReason, OFFER_END_LABELS, distanceKm } from '../../lib/offers.js';
import { localDate } from '../../lib/khataAgeing.js';
import { emitToStore } from '../notifications/merchantNotification.service.js';
import { OFFER_COLUMNS } from './offerPricing.js';
import { COUPON_COLUMNS, toPublicCoupon, couponsForCustomer } from '../benefits/benefits.service.js';

/**
 * Local offers and coupons — roadmap Phase C (expiry-based local offers,
 * location-based banner, automatic offer expiry) and §5 P3/P4 (merchant-
 * specific offers, coupons).
 *
 * An offer is shown, and priced, only while it is live: inside its window,
 * with units left, and short of its batch's safety cut-off. That is decided
 * on every read (and again by create_order) — never by a banner that might be
 * stale. The expiry job records why an offer ended and tells the merchant.
 */

const fail = (error, message) => {
  if (error) throw internal(message);
};

async function contextFor(offers, timeZone, now) {
  const batchIds = offers.map((o) => o.batch_id).filter(Boolean);
  const expiries = new Map();
  if (batchIds.length) {
    const { data, error } = await supabaseAdmin.from('inventory_batches').select('id, expires_on, quantity_remaining').in('id', batchIds);
    fail(error, 'Could not load offers.');
    for (const row of data ?? []) expiries.set(row.id, row);
  }
  const today = localDate(now, timeZone);
  return (offer) => ({ now, today, batchExpiresOn: offer.batch_id ? expiries.get(offer.batch_id)?.expires_on ?? null : null, batch: expiries.get(offer.batch_id) ?? null });
}

async function productNames(ids) {
  if (ids.length === 0) return new Map();
  const [products, variants] = await Promise.all([
    supabaseAdmin.from('products').select('id, name, slug').in('id', ids.map((i) => i.productId)),
    supabaseAdmin.from('product_variants').select('id, name, price_paise').in('id', ids.map((i) => i.variantId)),
  ]);
  fail(products.error || variants.error, 'Could not load offers.');
  return {
    products: new Map((products.data ?? []).map((row) => [row.id, row])),
    variants: new Map((variants.data ?? []).map((row) => [row.id, row])),
  };
}

function toOffer(row, { reason, product, variant, batch, store = null, distance = null }) {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    description: row.description ?? null,
    productId: row.product_id,
    productName: product?.name ?? null,
    variantId: row.variant_id,
    variantName: variant?.name ?? null,
    listPricePaise: variant?.price_paise ?? null,
    offerPricePaise: row.offer_price_paise,
    savingPaise: variant ? Math.max(variant.price_paise - row.offer_price_paise, 0) : null,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    quantityLimit: row.quantity_limit ?? null,
    quantitySold: row.quantity_sold,
    unitsLeft: row.quantity_limit === null ? null : row.quantity_limit - row.quantity_sold,
    batchExpiresOn: batch?.expires_on ?? null,
    expiryCutoffDays: row.expiry_cutoff_days,
    radiusKm: Number(row.radius_km),
    isLive: reason === null,
    status: reason === null ? 'live' : reason === 'not_started' ? 'scheduled' : 'ended',
    endReason: reason,
    endReasonLabel: reason ? OFFER_END_LABELS[reason] ?? reason : null,
    ...(store ? { store: { id: store.id, slug: store.slug, name: store.name, city: store.city ?? null } } : {}),
    ...(distance !== null ? { distanceKm: Math.round(distance * 10) / 10 } : {}),
  };
}

// ── Merchant ────────────────────────────────────────────────────────────────

export async function listStoreOffers(store, { status = 'all', now = new Date() } = {}) {
  const { data, error } = await supabaseAdmin
    .from('store_offers')
    .select(OFFER_COLUMNS)
    .eq('store_id', store.id)
    .order('created_at', { ascending: false });
  fail(error, 'Could not load offers.');
  const rows = data ?? [];
  const context = await contextFor(rows, store.timezone, now);
  const names = await productNames(rows.map((r) => ({ productId: r.product_id, variantId: r.variant_id })));
  let offers = rows.map((row) => {
    const ctx = context(row);
    return toOffer(row, {
      reason: offerEndReason(row, ctx),
      product: names.products?.get(row.product_id),
      variant: names.variants?.get(row.variant_id),
      batch: ctx.batch,
    });
  });
  if (status !== 'all') offers = offers.filter((offer) => offer.status === status);
  return offers;
}

export async function createOffer(store, merchant, input, { now = new Date() } = {}) {
  const { data: variant, error } = await supabaseAdmin
    .from('product_variants')
    .select('id, product_id, name, price_paise, store_id, is_available')
    .eq('id', input.variantId)
    .eq('store_id', store.id)
    .maybeSingle();
  fail(error, 'Could not load the product.');
  if (!variant) throw notFound('Product variant');
  const { data: product } = await supabaseAdmin
    .from('products')
    .select('id, name, archived_at, is_available, track_inventory')
    .eq('id', variant.product_id)
    .maybeSingle();
  if (!product || product.archived_at) throw notFound('Product variant');

  if (input.offerPricePaise >= variant.price_paise) {
    throw unprocessable('OFFER_NOT_LOWER', 'The offer price must be below the normal price.', { listPricePaise: variant.price_paise });
  }

  let quantityLimit = input.quantityLimit ?? null;
  let endsAt = new Date(input.endsAt);
  if (input.batchId) {
    const { data: batch } = await supabaseAdmin
      .from('inventory_batches')
      .select('id, variant_id, expires_on, quantity_remaining')
      .eq('id', input.batchId)
      .eq('store_id', store.id)
      .maybeSingle();
    if (!batch || batch.variant_id !== variant.id) throw notFound('Batch');
    if (batch.quantity_remaining <= 0) throw unprocessable('BATCH_EMPTY', 'Nothing is left of that batch.');
    quantityLimit = Math.min(quantityLimit ?? batch.quantity_remaining, batch.quantity_remaining);
    if (batch.expires_on) {
      const reason = offerEndReason(
        { is_active: true, ended_at: null, starts_at: now.toISOString(), ends_at: endsAt.toISOString(), quantity_limit: null, quantity_sold: 0, expiry_cutoff_days: input.expiryCutoffDays ?? 0 },
        { now, today: localDate(now, store.timezone), batchExpiresOn: batch.expires_on },
      );
      if (reason === 'expiry_cutoff') {
        throw unprocessable('PAST_EXPIRY_CUTOFF', 'This batch is already within its safety cut-off and cannot be sold on offer.');
      }
    }
  } else if (input.kind === 'expiry') {
    throw unprocessable('BATCH_REQUIRED', 'An expiry offer must name the batch it clears.');
  }

  const { data, error: insertError } = await supabaseAdmin
    .from('store_offers')
    .insert({
      store_id: store.id,
      product_id: variant.product_id,
      variant_id: variant.id,
      batch_id: input.batchId ?? null,
      kind: input.kind,
      title: input.title,
      description: input.description ?? null,
      offer_price_paise: input.offerPricePaise,
      starts_at: input.startsAt ?? now.toISOString(),
      ends_at: endsAt.toISOString(),
      quantity_limit: quantityLimit,
      radius_km: input.radiusKm ?? 5,
      expiry_cutoff_days: input.expiryCutoffDays ?? 0,
      created_by: merchant.id,
    })
    .select(OFFER_COLUMNS)
    .maybeSingle();
  if (insertError?.code === '23505') throw conflict('This product already has a live offer. End it first.');
  fail(insertError, 'Could not create the offer.');
  const [offer] = (await listStoreOffers(store, { now })).filter((o) => o.id === data.id);
  return offer;
}

export async function endOffer(store, offerId, reason = 'manual') {
  const { data, error } = await supabaseAdmin
    .from('store_offers')
    .update({ ended_at: new Date().toISOString(), end_reason: reason, is_active: false })
    .eq('id', offerId)
    .eq('store_id', store.id)
    .is('ended_at', null)
    .select('id')
    .maybeSingle();
  fail(error, 'Could not end the offer.');
  if (!data) {
    const { data: exists } = await supabaseAdmin.from('store_offers').select('id').eq('id', offerId).eq('store_id', store.id).maybeSingle();
    if (!exists) throw notFound('Offer');
  }
  const [offer] = (await listStoreOffers(store)).filter((o) => o.id === offerId);
  return offer;
}

/**
 * The automatic-expiry job: records the end of every offer that has stopped
 * being sellable (window over, sold out, past cut-off, out of stock) and tells
 * the merchant once. Displays never depended on this — it is the record.
 */
export async function expireOffers({ now = new Date() } = {}) {
  const { data, error } = await supabaseAdmin
    .from('store_offers')
    .select(OFFER_COLUMNS)
    .eq('is_active', true)
    .is('ended_at', null);
  fail(error, 'Could not load offers.');
  let ended = 0;
  const byStore = new Map();
  for (const row of data ?? []) {
    if (!byStore.has(row.store_id)) byStore.set(row.store_id, []);
    byStore.get(row.store_id).push(row);
  }
  for (const [storeId, rows] of byStore) {
    const { data: store } = await supabaseAdmin.from('stores').select('id, timezone').eq('id', storeId).maybeSingle();
    if (!store) continue;
    const context = await contextFor(rows, store.timezone, now);
    for (const row of rows) {
      const ctx = context(row);
      let reason = offerEndReason(row, ctx);
      if (reason === null && row.batch_id && ctx.batch && ctx.batch.quantity_remaining <= 0) reason = 'stock_unavailable';
      if (reason === null || reason === 'not_started') continue;
      const { data: updated } = await supabaseAdmin
        .from('store_offers')
        .update({ ended_at: now.toISOString(), end_reason: reason })
        .eq('id', row.id)
        .is('ended_at', null)
        .select('id')
        .maybeSingle();
      if (!updated) continue;
      ended += 1;
      await emitToStore(storeId, {
        type: 'offer_ended',
        title: `Offer ended: ${row.title}`,
        body: OFFER_END_LABELS[reason],
        payload: { offer_id: row.id },
        dedupeKey: `offer_ended:${row.id}`,
      });
    }
  }
  return ended;
}

// ── Coupons (merchant) ──────────────────────────────────────────────────────

export async function listCoupons(store) {
  const { data, error } = await supabaseAdmin
    .from('coupons')
    .select(COUPON_COLUMNS)
    .eq('store_id', store.id)
    .is('customer_id', null)
    .order('created_at', { ascending: false });
  fail(error, 'Could not load coupons.');
  const rows = data ?? [];
  const uses = new Map();
  if (rows.length) {
    const { data: redemptions } = await supabaseAdmin
      .from('coupon_redemptions')
      .select('coupon_id, discount_paise, waived_delivery_paise')
      .in('coupon_id', rows.map((r) => r.id))
      .eq('status', 'applied');
    for (const r of redemptions ?? []) {
      const entry = uses.get(r.coupon_id) ?? { count: 0, discountPaise: 0 };
      entry.count += 1;
      entry.discountPaise += r.discount_paise + r.waived_delivery_paise;
      uses.set(r.coupon_id, entry);
    }
  }
  return rows.map((row) => ({
    ...toPublicCoupon(row),
    isActive: row.is_active,
    maxUses: row.max_uses ?? null,
    maxUsesPerCustomer: row.max_uses_per_customer,
    timesUsed: uses.get(row.id)?.count ?? 0,
    totalDiscountPaise: uses.get(row.id)?.discountPaise ?? 0,
  }));
}

const couponRow = (input) => {
  const row = {};
  const map = {
    code: 'code', title: 'title', description: 'description', maxDiscountPaise: 'max_discount_paise',
    minOrderPaise: 'min_order_paise', startsAt: 'starts_at', endsAt: 'ends_at', maxUses: 'max_uses',
    maxUsesPerCustomer: 'max_uses_per_customer', audience: 'audience', stackableWithLoyalty: 'stackable_with_loyalty',
    isActive: 'is_active',
  };
  for (const [key, column] of Object.entries(map)) if (input[key] !== undefined) row[column] = input[key];
  if (input.discountType !== undefined) {
    row.discount_type = input.discountType;
    row.percent_off = input.discountType === 'percent' ? input.percentOff : null;
    row.amount_off_paise = input.discountType === 'flat' ? input.amountOffPaise : null;
  }
  return row;
};

export async function createCoupon(store, input) {
  const { data, error } = await supabaseAdmin
    .from('coupons')
    .insert({ store_id: store.id, ...couponRow(input) })
    .select(COUPON_COLUMNS)
    .maybeSingle();
  if (error?.code === '23505') throw conflict(`The code ${input.code} is already used at this store.`);
  if (error?.code === '23514') throw unprocessable('COUPON_INVALID_SETUP', 'Check the discount: a percent of 1–100, or an amount, and an end after the start.');
  fail(error, 'Could not create the coupon.');
  return (await listCoupons(store)).find((c) => c.id === data.id);
}

export async function updateCoupon(store, couponId, input) {
  const { data, error } = await supabaseAdmin
    .from('coupons')
    .update(couponRow(input))
    .eq('id', couponId)
    .eq('store_id', store.id)
    .is('customer_id', null)
    .select('id')
    .maybeSingle();
  if (error?.code === '23505') throw conflict(`The code ${input.code} is already used at this store.`);
  if (error?.code === '23514') throw unprocessable('COUPON_INVALID_SETUP', 'Check the discount: a percent of 1–100, or an amount, and an end after the start.');
  fail(error, 'Could not update the coupon.');
  if (!data) throw notFound('Coupon');
  return (await listCoupons(store)).find((c) => c.id === couponId);
}

// ── Customer / public ───────────────────────────────────────────────────────

async function publishedStoreBySlug(slug) {
  const { data, error } = await supabaseAdmin
    .from('stores')
    .select('id, slug, name, city, timezone, latitude, longitude, is_active, is_published')
    .eq('slug', slug)
    .maybeSingle();
  fail(error, 'Could not load the store.');
  if (!data || !data.is_active || !data.is_published) throw notFound('Store');
  return data;
}

async function liveOffersOf(stores, now) {
  if (stores.length === 0) return [];
  const { data, error } = await supabaseAdmin
    .from('store_offers')
    .select(OFFER_COLUMNS)
    .in('store_id', stores.map((s) => s.id))
    .eq('is_active', true)
    .is('ended_at', null);
  fail(error, 'Could not load offers.');
  const rows = data ?? [];
  const names = await productNames(rows.map((r) => ({ productId: r.product_id, variantId: r.variant_id })));
  const storeById = new Map(stores.map((s) => [s.id, s]));
  const result = [];
  for (const store of stores) {
    const mine = rows.filter((row) => row.store_id === store.id);
    const context = await contextFor(mine, store.timezone, now);
    for (const row of mine) {
      const ctx = context(row);
      const reason = offerEndReason(row, ctx);
      if (reason !== null) continue;
      if (ctx.batch && ctx.batch.quantity_remaining <= 0) continue;
      result.push({ row, ctx, store: storeById.get(row.store_id), product: names.products?.get(row.product_id), variant: names.variants?.get(row.variant_id) });
    }
  }
  return result;
}

/** A store's live offers and public coupons — what the store page shows. */
export async function storeOffersPublic(slug, customerId = null, { now = new Date() } = {}) {
  const store = await publishedStoreBySlug(slug);
  const live = await liveOffersOf([store], now);
  const offers = live.map(({ row, ctx, product, variant }) => toOffer(row, { reason: null, product, variant, batch: ctx.batch }));
  const coupons = customerId
    ? await couponsForCustomer(store, customerId, { now })
    : (await publicCoupons(store.id, now)).map(toPublicCoupon);
  return { offers, coupons };
}

async function publicCoupons(storeId, now) {
  const { data, error } = await supabaseAdmin
    .from('coupons')
    .select(COUPON_COLUMNS)
    .eq('store_id', storeId)
    .eq('is_active', true)
    .eq('audience', 'all')
    .is('customer_id', null);
  fail(error, 'Could not load coupons.');
  return (data ?? []).filter((c) => new Date(c.starts_at) <= now && (!c.ends_at || new Date(c.ends_at) > now));
}

/**
 * The location banner: live offers from published stores whose offer radius
 * covers where the customer is (or the area they picked), nearest first.
 */
export async function nearbyOffers({ latitude, longitude, now = new Date(), limit = 20 }) {
  const { data, error } = await supabaseAdmin
    .from('stores')
    .select('id, slug, name, city, timezone, latitude, longitude, is_active, is_published')
    .eq('is_active', true)
    .eq('is_published', true);
  fail(error, 'Could not load stores.');
  const located = (data ?? []).filter((s) => s.latitude !== null && s.longitude !== null);
  const live = await liveOffersOf(located, now);
  return live
    .map(({ row, ctx, store, product, variant }) => ({
      row, ctx, store, product, variant,
      distance: distanceKm(latitude, longitude, Number(store.latitude), Number(store.longitude)),
    }))
    .filter(({ row, distance }) => distance <= Number(row.radius_km))
    .sort((a, b) => a.distance - b.distance || new Date(a.row.ends_at) - new Date(b.row.ends_at))
    .slice(0, limit)
    .map(({ row, ctx, store, product, variant, distance }) => toOffer(row, { reason: null, product, variant, batch: ctx.batch, store, distance }));
}
