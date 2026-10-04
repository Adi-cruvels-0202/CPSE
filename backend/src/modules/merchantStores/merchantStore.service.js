import { supabaseAdmin } from '../../lib/supabase.js';
import { conflict, internal, notFound, unprocessable, slugTaken, validationFailed } from '../../lib/errors.js';
import { resolveOpenState, localNow } from '../../lib/openingHours.js';
import { storeImage, removeStoredImage } from '../../lib/imageUpload.js';
import { slugify as slugifyBase, firstFreeSlug } from '../../lib/slug.js';
import { holidaysFor, holidaysByStore } from '../stores/store.service.js';
import { DAYS } from './merchantStore.schemas.js';

/**
 * A merchant's stores — MERCHANT_API.md, Stores; MERCHANT_RULES §2.
 *
 * Ownership is already settled when these run: requireStoreOwner has loaded
 * the caller's own store onto the request (or answered 404), so every
 * function here takes that row and never re-checks who owns it.
 */

/** The merchant's view of a store — includes what customers never see. */
export function toMerchantStore(row, { now = new Date(), holidays = [] } = {}) {
  const open = resolveOpenState(row.opening_hours, row.timezone, now, { holidays });
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description ?? null,
    shopCategory: row.shop_category ?? null,
    phone: row.phone ?? null,
    email: row.email ?? null,
    address: row.address_line1
      ? {
          line1: row.address_line1,
          line2: row.address_line2 ?? null,
          city: row.city ?? null,
          state: row.state ?? null,
          postalCode: row.postal_code ?? null,
          country: row.country ?? 'IN',
        }
      : null,
    latitude: row.latitude === null || row.latitude === undefined ? null : Number(row.latitude),
    longitude: row.longitude === null || row.longitude === undefined ? null : Number(row.longitude),
    logoUrl: row.logo_url ?? null,
    coverImageUrl: row.cover_image_url ?? null,
    timezone: row.timezone,
    openingHours: row.opening_hours ?? {},
    hours: { isOpen: open.isOpen, opensAt: open.opensAt ?? null },
    fulfilment: {
      pickupEnabled: row.pickup_enabled,
      deliveryEnabled: row.delivery_enabled,
      deliveryFeePaise: row.delivery_fee_paise,
      minOrderPaise: row.min_order_paise,
      freeDeliveryThresholdPaise: row.free_delivery_threshold_paise ?? null,
      deliveryRadiusKm:
        row.delivery_radius_km === null || row.delivery_radius_km === undefined
          ? null
          : Number(row.delivery_radius_km),
    },
    paymentMethods: { cash: row.accepts_cash, online: row.accepts_online },
    isPublished: row.is_published,
    // What the "share / QR code" button links to — the customer store page.
    publicPath: `/store/${row.slug}`,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const UNIQUE_VIOLATION = '23505';

/** Request fields → columns. Only what was sent; `address: null` clears it. */
function toColumns(input) {
  const row = {};
  if (input.name !== undefined) row.name = input.name;
  if (input.slug !== undefined) row.slug = input.slug;
  if (input.description !== undefined) row.description = input.description;
  if (input.shopCategory !== undefined) row.shop_category = input.shopCategory;
  if (input.phone !== undefined) row.phone = input.phone;
  if (input.email !== undefined) row.email = input.email;
  if (input.latitude !== undefined) row.latitude = input.latitude;
  if (input.longitude !== undefined) row.longitude = input.longitude;
  if (input.timezone !== undefined) row.timezone = input.timezone;
  if (input.address !== undefined) {
    const address = input.address;
    row.address_line1 = address?.line1 ?? null;
    row.address_line2 = address?.line2 ?? null;
    row.city = address?.city ?? null;
    row.state = address?.state ?? null;
    row.postal_code = address?.postalCode ?? null;
    row.country = address?.country ?? 'IN';
  }
  return row;
}

/** Store links fall back to "store" (MERCHANT_RULES S-4). */
export const slugify = (name) => slugifyBase(name, 'store');

async function slugExists(slug) {
  const { data, error } = await supabaseAdmin.from('stores').select('id').eq('slug', slug).maybeSingle();
  if (error) throw internal('Could not check the store link.');
  return Boolean(data);
}

const freeSlug = (base) => firstFreeSlug(base, slugExists);

/** `GET …/:storeId` — the store as it stands, with its holidays applied. */
export async function getStore(store) {
  return toMerchantStore(store, { holidays: await holidaysFor(store.id) });
}

/** `GET /merchant/stores` — the caller's stores, newest first. */
export async function listStores(merchant, now = new Date()) {
  const { data, error } = await supabaseAdmin
    .from('stores')
    .select('*')
    .eq('owner_id', merchant.id)
    .order('created_at', { ascending: false });

  if (error) throw internal('Could not load your stores.');
  const rows = data ?? [];
  const holidays = await holidaysByStore(rows.map((row) => row.id), now);
  return rows.map((row) => toMerchantStore(row, { now, holidays: holidays.get(row.id) }));
}

/**
 * `POST /merchant/stores`. Created unpublished, pickup on, delivery off, cash
 * only, no hours (MERCHANT_RULES S-6, S-7) — publishing asks for the rest.
 */
export async function createStore(merchant, input) {
  const requested = input.slug ?? null;
  if (requested && (await slugExists(requested))) throw slugTaken(requested);

  const base = { ...toColumns(input), owner_id: merchant.id, is_published: false };

  // A generated slug can lose a race to another store created at the same
  // moment; it is simply regenerated. A requested one is the merchant's choice,
  // so losing that race is a 409 like any other taken slug.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const slug = requested ?? (await freeSlug(slugify(input.name)));
    const { data, error } = await supabaseAdmin
      .from('stores')
      .insert({ ...base, slug })
      .select('*')
      .single();

    if (!error) return toMerchantStore(data);  // a new store has no holidays yet
    if (error.code !== UNIQUE_VIOLATION) throw internal('Could not create the store.');
    if (requested) throw slugTaken(requested);
  }
  throw internal('Could not create the store.');
}

async function writeStore(store, patch, message = 'Could not update the store.') {
  const { data, error } = await supabaseAdmin
    .from('stores')
    .update(patch)
    .eq('id', store.id)
    .select('*')
    .single();

  if (error?.code === UNIQUE_VIOLATION && patch.slug) throw slugTaken(patch.slug);
  if (error) throw internal(message);
  return toMerchantStore(data, { holidays: await holidaysFor(store.id) });
}

/**
 * `PATCH /merchant/stores/:storeId`. The slug may change only while the store
 * is unpublished: once published it is in shared links and printed QR codes,
 * and changing it would break every one (MERCHANT_RULES S-5).
 */
export async function updateStore(store, input) {
  const patch = toColumns(input);

  if (patch.slug !== undefined && patch.slug !== store.slug) {
    if (store.is_published) {
      throw conflict('The store link cannot change while the store is published. Unpublish it first.');
    }
    if (await slugExists(patch.slug)) throw slugTaken(patch.slug);
  } else {
    delete patch.slug;
  }

  return writeStore(store, patch);
}

/** What a store still needs before customers can see it (MERCHANT_RULES S-8). */
export function missingForPublish(store) {
  const missing = [];
  if (!store.address_line1 || !store.city) missing.push('address');
  if (!store.phone) missing.push('phone');
  const hours = store.opening_hours ?? {};
  if (!DAYS.some((day) => Array.isArray(hours[day]) && hours[day].length > 0)) missing.push('openingHours');
  if (!store.pickup_enabled && !store.delivery_enabled) missing.push('fulfilment');
  return missing;
}

/** `POST …/publish` — the customer store page shows all of these, so all are required. */
export async function publishStore(store) {
  if (store.is_published) throw conflict('This store is already published.');

  const missing = missingForPublish(store);
  if (missing.length > 0) {
    throw unprocessable(
      'STORE_INCOMPLETE',
      'Add the missing details before publishing the store.',
      { missing },
    );
  }

  return writeStore(store, { is_published: true }, 'Could not publish the store.');
}

/** `POST …/unpublish` — customers get a 404 again; existing orders carry on. */
export async function unpublishStore(store) {
  if (!store.is_published) throw conflict('This store is not published.');
  return writeStore(store, { is_published: false }, 'Could not unpublish the store.');
}

/**
 * `DELETE /merchant/stores/:storeId` — permanently, with everything in it
 * (MERCHANT_RULES S-19). The merchant types the store's name to confirm, so a
 * stray request cannot do it. Refused while an order is still in progress.
 * The rows go in one transaction (delete_store); the photos are removed after,
 * and a photo that fails to go is only logged.
 */
export async function deleteStore(store, { confirmName }) {
  if (confirmName.trim() !== store.name.trim()) {
    throw validationFailed({
      issues: [{ source: 'body', field: 'confirmName', message: 'Type the store name exactly as it is shown.' }],
    });
  }

  // The product photos to remove afterwards — read now, while the rows exist.
  const { data: products, error: productError } = await supabaseAdmin
    .from('products')
    .select('id')
    .eq('store_id', store.id);
  if (productError) throw internal('Could not delete the store.');
  let images = [];
  if (products?.length) {
    const { data, error: imageError } = await supabaseAdmin
      .from('product_images')
      .select('url')
      .in('product_id', products.map((product) => product.id));
    if (imageError) throw internal('Could not delete the store.');
    images = data ?? [];
  }

  const { error } = await supabaseAdmin.rpc('delete_store', { p_store_id: store.id });
  if (error?.message?.includes('ORDERS_IN_PROGRESS')) {
    throw conflict('This store still has orders in progress. Complete or cancel them first.');
  }
  if (error?.message?.includes('STORE_NOT_FOUND')) throw notFound('Store');
  if (error) throw internal('Could not delete the store.');

  const photos = [store.logo_url, store.cover_image_url, ...images.map((image) => image.url)];
  await Promise.all(photos.map((url) => removeStoredImage(url)));
}

/** `PUT …/hours` — replaces the whole week, in the format the customer side reads (D-8). */
export function setHours(store, { timezone, openingHours }) {
  return writeStore(store, { timezone, opening_hours: openingHours });
}

/** `PUT …/delivery` */
export function setDelivery(store, input) {
  return writeStore(store, {
    pickup_enabled: input.pickupEnabled,
    delivery_enabled: input.deliveryEnabled,
    delivery_fee_paise: input.deliveryFeePaise,
    min_order_paise: input.minOrderPaise,
    free_delivery_threshold_paise: input.freeDeliveryThresholdPaise,
    delivery_radius_km: input.deliveryRadiusKm,
  });
}

/** `PUT …/payments` */
export function setPayments(store, { cash, online }) {
  return writeStore(store, { accepts_cash: cash, accepts_online: online });
}

// ── Photos (P1, D-10) ────────────────────────────────────────────────────────

/**
 * `POST …/logo` and `…/cover`. The new photo is stored first and the row then
 * points at it; the photo it replaces is deleted afterwards, so a failure part
 * way never leaves the store pointing at nothing.
 */
export async function setStorePhoto(store, kind, file) {
  const column = kind === 'logo' ? 'logo_url' : 'cover_image_url';
  const url = await storeImage(file, `stores/${store.id}/${kind}`);
  const updated = await writeStore(store, { [column]: url }, 'Could not save the photo.');
  await removeStoredImage(store[column]);
  return updated;
}

// ── Holidays (P1, MERCHANT_RULES S-12) ──────────────────────────────────────

const toHoliday = (row) => ({ id: row.id, date: row.holiday_date, reason: row.reason ?? null, createdAt: row.created_at });

/** `GET …/holidays` — today's and later, in date order. Past ones are history. */
export async function listHolidays(store) {
  const today = localNow(store.timezone).date;
  const { data, error } = await supabaseAdmin
    .from('store_holidays')
    .select('id, holiday_date, reason, created_at')
    .eq('store_id', store.id)
    .gte('holiday_date', today)
    .order('holiday_date', { ascending: true });

  if (error) throw internal('Could not load the holidays.');
  return (data ?? []).map(toHoliday);
}

/** `POST …/holidays` — the store shows closed all that day. */
export async function addHoliday(store, { date, reason }) {
  if (date < localNow(store.timezone).date) {
    throw validationFailed({ issues: [{ source: 'body', field: 'date', message: 'Choose today or a later date.' }] });
  }

  const { data, error } = await supabaseAdmin
    .from('store_holidays')
    .insert({ store_id: store.id, holiday_date: date, reason: reason ?? null })
    .select('id, holiday_date, reason, created_at')
    .single();

  if (error?.code === UNIQUE_VIOLATION) throw conflict('That date is already a holiday.', { date });
  if (error) throw internal('Could not add the holiday.');
  return toHoliday(data);
}

/** `DELETE …/holidays/:holidayId` — another store's holiday is a 404 (S-18's lesson). */
export async function removeHoliday(store, holidayId) {
  const { data, error } = await supabaseAdmin
    .from('store_holidays')
    .delete()
    .eq('id', holidayId)
    .eq('store_id', store.id)
    .select('id')
    .maybeSingle();

  if (error) throw internal('Could not remove the holiday.');
  if (!data) throw notFound('Holiday');
}
