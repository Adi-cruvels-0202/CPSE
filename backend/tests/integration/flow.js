/**
 * The shared commerce flow as reusable steps, every one through the public
 * HTTP API against real Postgres (helpers/pgSupabase.js). Tests import these
 * so each one starts from a merchant with a published shop and a customer,
 * exactly as the two apps would produce them.
 */
import sharp from 'sharp';
import { api, url } from '../helpers/app.js';
import { authHeader, createMerchantUser, createUser, sql } from '../helpers/pgSupabase.js';

export const ALWAYS_OPEN = Object.fromEntries(
  ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((day) => [day, [{ open: '00:00', close: '23:59' }]]),
);

/** Fails the test with the response body when the status is not the one expected. */
export function expectStatus(response, status) {
  if (response.status !== status) {
    throw new Error(
      `Expected ${status}, got ${response.status} for ${response.req?.method} ${response.req?.path}: ${JSON.stringify(response.body)}`,
    );
  }
  return response.body?.data;
}

export const call = (method, path, auth, body, headers = {}) => {
  let request = api()[method](url(path));
  if (auth) request = request.set(auth);
  for (const [name, value] of Object.entries(headers)) request = request.set(name, value);
  return body === undefined ? request : request.send(body);
};

/** A merchant with a published, open shop that takes cash and online payment. */
export async function openShop({ name = 'Sharma Kirana', delivery = true, online = true, shopCategory = 'grocery', latitude = 30.9, longitude = 75.85 } = {}) {
  const merchantId = await createMerchantUser({ fullName: `${name} Owner` });
  const merchant = authHeader(merchantId);

  const { store } = expectStatus(
    await call('post', '/merchant/stores', merchant, {
      name,
      shopCategory,
      phone: '+919876500000',
      address: { line1: '12 Mall Road', city: 'Ludhiana', state: 'Punjab', postalCode: '141001' },
      latitude,
      longitude,
    }),
    201,
  );
  expectStatus(await call('put', `/merchant/stores/${store.id}/hours`, merchant, { openingHours: ALWAYS_OPEN }), 200);
  expectStatus(
    await call('put', `/merchant/stores/${store.id}/delivery`, merchant, {
      pickupEnabled: true,
      deliveryEnabled: delivery,
      deliveryFeePaise: 3000,
      minOrderPaise: 0,
      freeDeliveryThresholdPaise: 100000,
    }),
    200,
  );
  expectStatus(await call('put', `/merchant/stores/${store.id}/payments`, merchant, { cash: true, online }), 200);
  return { merchantId, merchant, store };
}

let photo = null;
/** A small real PNG, as a phone camera would upload one. */
export async function samplePhoto() {
  if (!photo) {
    photo = await sharp({ create: { width: 64, height: 48, channels: 3, background: { r: 200, g: 120, b: 40 } } })
      .png()
      .toBuffer();
  }
  return photo;
}

export const SAMPLE_PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');

export function uploadDocument(shop, docType, buffer, filename = 'doc.png') {
  return api()
    .post(url(`/merchant/stores/${shop.store.id}/verification/documents/${docType}`))
    .set(shop.merchant)
    .attach('file', buffer, filename);
}

/** A platform reviewer (migration 0039). */
export async function newAdmin() {
  const id = await createUser({ fullName: 'Platform Reviewer' });
  await sql('insert into platform_admins (id, email, full_name) select id, email, full_name from customers where id = $1', [id]);
  return { id, auth: authHeader(id) };
}

/** The merchant completes KYC and a reviewer approves it — all through the API. */
export async function verify(shop, { admin } = {}) {
  expectStatus(
    await call('put', `/merchant/stores/${shop.store.id}/verification`, shop.merchant, {
      legalName: `${shop.store.name} Traders`,
      businessType: 'proprietorship',
      ownerName: 'Ramesh Sharma',
      ownerPhone: '+919876500000',
    }),
    200,
  );
  const image = await samplePhoto();
  for (const type of ['shop_photo', 'identity_proof', 'address_proof']) {
    expectStatus(await uploadDocument(shop, type, image), 201);
  }
  expectStatus(await call('post', `/merchant/stores/${shop.store.id}/verification/submit`, shop.merchant, {}), 200);
  const reviewer = admin ?? (await newAdmin());
  expectStatus(await call('post', `/admin/verifications/${shop.store.id}/approve`, reviewer.auth, {}), 200);
  return reviewer;
}

export async function publish(shop) {
  const [{ verification_status: status }] = await sql('select verification_status from stores where id = $1', [shop.store.id]);
  if (status !== 'verified') await verify(shop);
  return expectStatus(await call('post', `/merchant/stores/${shop.store.id}/publish`, shop.merchant), 200);
}

/** Rice in 1 kg and 500 g packs — two SKUs of one base product. */
export async function addRice(shop, { stock1kg = 20, stock500g = 30, taxPercent = 5 } = {}) {
  const { product } = expectStatus(
    await call('post', `/merchant/stores/${shop.store.id}/products`, shop.merchant, {
      name: 'Basmati Rice',
      unit: 'kg',
      taxPercent,
      lowStockThreshold: 5,
      variants: [
        { name: '1 kg', sku: 'RICE-1KG', weightGrams: 1000, pricePaise: 12000, costPaise: 9000, openingQuantity: stock1kg },
        { name: '500 g', sku: 'RICE-500G', weightGrams: 500, pricePaise: 6500, costPaise: 4800, openingQuantity: stock500g },
      ],
    }),
    201,
  );
  const byName = Object.fromEntries(product.variants.map((variant) => [variant.name, variant]));
  return { product, kg: byName['1 kg'], halfKg: byName['500 g'] };
}

export async function addSimpleProduct(shop, { name = 'Toor Dal', pricePaise = 15000, stock = 10, taxPercent = 0, categoryId, unit = 'pcs', trackInventory = true } = {}) {
  const { product } = expectStatus(
    await call('post', `/merchant/stores/${shop.store.id}/products`, shop.merchant, {
      name,
      unit,
      taxPercent,
      trackInventory,
      ...(categoryId ? { categoryId } : {}),
      variants: [{ name: 'Default', pricePaise, openingQuantity: trackInventory ? stock : undefined }],
    }),
    201,
  );
  return { product, variant: product.variants[0] };
}

export async function newCustomer(fullName = 'Asha Verma') {
  const id = await createUser({ fullName, phone: '+919812345678' });
  return { id, auth: authHeader(id) };
}

export async function addAddress(customer) {
  const { address } = expectStatus(
    await call('post', '/addresses', customer.auth, {
      recipientName: 'Asha Verma',
      phone: '+919812345678',
      line1: '45 Model Town',
      city: 'Ludhiana',
      state: 'Punjab',
      postalCode: '141002',
      latitude: 30.91,
      longitude: 75.86,
    }),
    201,
  );
  return address;
}

export async function addToCart(customer, storeId, productId, variantId, quantity = 1) {
  return expectStatus(await call('post', '/cart/items', customer.auth, { storeId, productId, variantId, quantity }), 201);
}

let keyCounter = 0;
export async function placeOrder(customer, body, { idempotencyKey = `key-${Date.now()}-${++keyCounter}` } = {}) {
  const response = await call(
    'post',
    '/orders',
    customer.auth,
    { fulfilmentMode: 'pickup', paymentMethod: 'cash', ...body },
    { 'Idempotency-Key': idempotencyKey },
  );
  return response;
}

/** The merchant walks a pickup order all the way to completed. */
export async function fulfil(shop, orderId, mode = 'pickup') {
  const base = `/merchant/stores/${shop.store.id}/orders/${orderId}`;
  expectStatus(await call('post', `${base}/accept`, shop.merchant, {}), 200);
  expectStatus(await call('post', `${base}/status`, shop.merchant, { status: 'preparing' }), 200);
  expectStatus(
    await call('post', `${base}/status`, shop.merchant, { status: mode === 'delivery' ? 'out_for_delivery' : 'ready_for_pickup' }),
    200,
  );
  return expectStatus(await call('post', `${base}/complete`, shop.merchant, {}), 200);
}

/** Pays an online order through the provider's signed webhook. */
export async function payOnline(customer, orderId) {
  const { payment } = expectStatus(await call('post', `/payments/${orderId}/initiate`, customer.auth, {}), 200);
  return expectStatus(await call('post', `/payments/${orderId}/verify`, customer.auth, { providerRef: payment.providerRef, outcome: 'success' }), 200);
}
