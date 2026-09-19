import { supabaseAdmin } from '../../lib/supabase.js';
import { internal, notFound, unprocessable, conflict } from '../../lib/errors.js';
import { priceTotals, unitPriceOf, lineTotal } from '../../lib/pricing.js';
import {
  findActiveStoreById,
  findStoreProduct,
  findProductVariant,
} from '../stores/store.service.js';
import { MAX_QUANTITY } from './cart.schemas.js';

/**
 * Cart reads and writes — checklist 5.1 – 5.12.
 *
 * Two rules shape everything here:
 *
 *  - The cart is store-scoped (5.6). A customer shopping at two stores keeps
 *    two carts, and `carts_one_active_per_customer_store` makes that a database
 *    invariant rather than a convention.
 *  - The cart stores NO prices (migration 0010). Every read reprices from the
 *    live product row, so a merchant's price change is visible in the cart
 *    immediately; the snapshot happens at order time (D11).
 */

const fail = (error, message) => {
  if (error) throw internal(message);
};

const CART_COLUMNS = 'id, customer_id, store_id, checked_out_at, created_at, updated_at';
const CART_ITEM_COLUMNS = 'id, cart_id, product_id, variant_id, quantity, created_at, updated_at';

/** The active (not yet checked out) cart for one customer at one store. */
export async function findActiveCart(customerId, storeId) {
  const { data, error } = await supabaseAdmin
    .from('carts')
    .select(CART_COLUMNS)
    .eq('customer_id', customerId)
    .eq('store_id', storeId)
    .is('checked_out_at', null)
    .maybeSingle();

  fail(error, 'Could not load your cart.');
  return data ?? null;
}

async function createCart(customerId, storeId) {
  const { data, error } = await supabaseAdmin
    .from('carts')
    .insert({ customer_id: customerId, store_id: storeId })
    .select(CART_COLUMNS)
    .single();

  fail(error, 'Could not create your cart.');
  return data;
}

/**
 * Only the write paths create a cart. A GET never does, so browsing a store
 * while signed in does not litter the table with empty carts.
 */
export async function getOrCreateCart(customerId, storeId) {
  return (await findActiveCart(customerId, storeId)) ?? createCart(customerId, storeId);
}

async function listCartItems(cartId) {
  const { data, error } = await supabaseAdmin
    .from('cart_items')
    .select(CART_ITEM_COLUMNS)
    .eq('cart_id', cartId)
    .order('created_at', { ascending: true });

  fail(error, 'Could not load your cart.');
  return data ?? [];
}

async function loadProducts(productIds) {
  if (productIds.length === 0) return new Map();

  const { data, error } = await supabaseAdmin
    .from('products')
    .select('id, store_id, name, price_paise, mrp_paise, is_available, stock')
    .in('id', productIds);

  fail(error, 'Could not load the products in your cart.');
  return new Map((data ?? []).map((row) => [row.id, row]));
}

async function loadVariants(variantIds) {
  if (variantIds.length === 0) return new Map();

  const { data, error } = await supabaseAdmin
    .from('product_variants')
    .select('id, product_id, name, price_paise, stock, is_available')
    .in('id', variantIds);

  fail(error, 'Could not load the product variants in your cart.');
  return new Map((data ?? []).map((row) => [row.id, row]));
}

async function loadImages(productIds) {
  if (productIds.length === 0) return new Map();

  const { data, error } = await supabaseAdmin
    .from('product_images')
    .select('product_id, url, sort_order')
    .in('product_id', productIds)
    .order('sort_order', { ascending: true });

  fail(error, 'Could not load the product images.');

  const byProduct = new Map();
  for (const image of data ?? []) {
    if (!byProduct.has(image.product_id)) byProduct.set(image.product_id, image.url);
  }
  return byProduct;
}

/** How many units of this line the store can actually supply; null = untracked. */
export function availableStock(product, variant) {
  const source = variant ?? product;
  return source.stock ?? null;
}

/**
 * Turns one cart row into a priced, checked line. `issues` is the single place
 * that decides why a line cannot be ordered, so the cart screen (5.1), the
 * validate call (5.10) and order creation (7.16) all agree on the reason.
 */
export function buildLine(item, product, variant, imageUrl) {
  const issues = [];

  // The product row is gone entirely — a merchant deleted it under us.
  if (!product) {
    return {
      id: item.id,
      productId: item.product_id,
      variantId: item.variant_id ?? null,
      name: 'Unavailable item',
      variantName: null,
      imageUrl: null,
      unitPricePaise: 0,
      quantity: item.quantity,
      lineTotalPaise: 0,
      stock: 0,
      isPurchasable: false,
      issues: [{ code: 'PRODUCT_REMOVED', message: 'This item is no longer sold by this store.' }],
    };
  }

  if (!product.is_available) {
    issues.push({ code: 'PRODUCT_UNAVAILABLE', message: `${product.name} is currently unavailable.` });
  }

  if (item.variant_id && !variant) {
    issues.push({
      code: 'VARIANT_REMOVED',
      message: `The selected option for ${product.name} is no longer offered.`,
    });
  } else if (variant && !variant.is_available) {
    issues.push({
      code: 'VARIANT_UNAVAILABLE',
      message: `${product.name} (${variant.name}) is currently unavailable.`,
    });
  }

  const stock = availableStock(product, variant ?? null);
  if (stock !== null && stock <= 0) {
    issues.push({ code: 'OUT_OF_STOCK', message: `${product.name} is sold out.` });
  } else if (stock !== null && stock < item.quantity) {
    issues.push({
      code: 'INSUFFICIENT_STOCK',
      message: `Only ${stock} left of ${product.name}.`,
      available: stock,
    });
  }

  const unitPricePaise = unitPriceOf(product, variant ?? null);

  return {
    id: item.id,
    productId: product.id,
    variantId: variant?.id ?? null,
    name: product.name,
    variantName: variant?.name ?? null,
    imageUrl: imageUrl ?? null,
    unitPricePaise,
    mrpPaise: variant ? null : product.mrp_paise ?? null,
    quantity: item.quantity,
    lineTotalPaise: lineTotal(unitPricePaise, item.quantity),
    stock,
    isPurchasable: issues.length === 0,
    issues,
  };
}

/**
 * The whole cart, repriced from live rows. Shared by the cart screen, the
 * checkout quote and order creation, so all three price the same basket the
 * same way.
 */
export async function loadCart(customerId, storeId) {
  const store = await findActiveStoreById(storeId);
  const cart = await findActiveCart(customerId, storeId);

  if (!cart) {
    return {
      store,
      cart: null,
      lines: [],
      totals: priceTotals({ lines: [] }),
      issues: [],
    };
  }

  const items = await listCartItems(cart.id);
  const productIds = [...new Set(items.map((item) => item.product_id))];
  const variantIds = [...new Set(items.map((item) => item.variant_id).filter(Boolean))];

  const [products, variants, images] = await Promise.all([
    loadProducts(productIds),
    loadVariants(variantIds),
    loadImages(productIds),
  ]);

  const lines = items.map((item) => {
    const product = products.get(item.product_id) ?? null;
    // A product that has been moved to another store is as gone as a deleted
    // one, as far as this store's cart is concerned.
    const scoped = product && product.store_id === storeId ? product : null;
    const variant = item.variant_id ? variants.get(item.variant_id) ?? null : null;
    return buildLine(item, scoped, variant, images.get(item.product_id));
  });

  return {
    store,
    cart,
    lines,
    // Unavailable lines still contribute nothing: the cart total is what the
    // customer would actually be charged today.
    totals: priceTotals({ lines: lines.filter((line) => line.isPurchasable) }),
    issues: lines.flatMap((line) => line.issues.map((issue) => ({ itemId: line.id, ...issue }))),
  };
}

/** The payload shape every cart endpoint returns. */
export function toPublicCart({ store, cart, lines, totals, issues }) {
  return {
    storeId: store.id,
    storeName: store.name,
    cartId: cart?.id ?? null,
    lines,
    totals,
    issues,
    // One flag for the checkout button, same idea as isPurchasable on a product.
    isCheckoutReady: lines.length > 0 && issues.length === 0,
  };
}

/** Checklist 5.1 */
export async function getCart(customerId, storeId) {
  return toPublicCart(await loadCart(customerId, storeId));
}

/**
 * Checklist 5.2, 5.7 and 5.8. The same product with a different variant is a
 * separate line (5.7) — enforced by cart_items_unique_line, which treats a
 * null variant as its own value — while the same product+variant bumps the
 * existing line's quantity instead of creating a duplicate.
 */
export async function addItem(customerId, { storeId, productId, variantId, quantity }) {
  const store = await findActiveStoreById(storeId);
  const product = await findStoreProduct(store.id, productId);
  const variant = variantId ? await findProductVariant(product.id, variantId) : null;

  if (!product.is_available) {
    throw unprocessable('PRODUCT_UNAVAILABLE', `${product.name} is currently unavailable.`);
  }
  if (variant && !variant.is_available) {
    throw unprocessable(
      'VARIANT_UNAVAILABLE',
      `${product.name} (${variant.name}) is currently unavailable.`,
    );
  }

  const cart = await getOrCreateCart(customerId, storeId);
  const existing = await findLine(cart.id, productId, variantId ?? null);
  const nextQuantity = (existing?.quantity ?? 0) + quantity;

  assertQuantityAllowed(product, variant, nextQuantity);

  if (existing) {
    await updateQuantity(existing.id, nextQuantity);
  } else {
    const { error } = await supabaseAdmin.from('cart_items').insert({
      cart_id: cart.id,
      product_id: productId,
      variant_id: variantId ?? null,
      quantity,
    });
    fail(error, 'Could not add the item to your cart.');
  }

  return getCart(customerId, storeId);
}

/** Checklist 5.8. The stock ceiling; the integer/range checks live in the schema. */
function assertQuantityAllowed(product, variant, quantity) {
  if (quantity > MAX_QUANTITY) {
    throw unprocessable(
      'QUANTITY_TOO_LARGE',
      `You can order at most ${MAX_QUANTITY} of one item.`,
    );
  }

  const stock = availableStock(product, variant);
  if (stock === null) return;

  if (stock <= 0) {
    throw unprocessable('OUT_OF_STOCK', `${product.name} is sold out.`);
  }
  if (quantity > stock) {
    throw unprocessable(
      'INSUFFICIENT_STOCK',
      `Only ${stock} left of ${product.name}.`,
      { available: stock },
    );
  }
}

async function findLine(cartId, productId, variantId) {
  let query = supabaseAdmin
    .from('cart_items')
    .select(CART_ITEM_COLUMNS)
    .eq('cart_id', cartId)
    .eq('product_id', productId);

  query = variantId ? query.eq('variant_id', variantId) : query.is('variant_id', null);

  const { data, error } = await query.maybeSingle();
  fail(error, 'Could not load your cart.');
  return data ?? null;
}

async function updateQuantity(itemId, quantity) {
  const { error } = await supabaseAdmin
    .from('cart_items')
    .update({ quantity })
    .eq('id', itemId);

  fail(error, 'Could not update your cart.');
}

/**
 * Checklist 5.11. Every item route resolves the line through its cart and
 * compares the owner to the caller. Another customer's item is a 404, never a
 * 403 — a 403 would confirm the id exists.
 */
export async function findOwnedItem(customerId, itemId) {
  const { data: item, error } = await supabaseAdmin
    .from('cart_items')
    .select(CART_ITEM_COLUMNS)
    .eq('id', itemId)
    .maybeSingle();

  fail(error, 'Could not load the cart item.');
  if (!item) throw notFound('Cart item');

  const { data: cart, error: cartError } = await supabaseAdmin
    .from('carts')
    .select(CART_COLUMNS)
    .eq('id', item.cart_id)
    .maybeSingle();

  fail(cartError, 'Could not load the cart item.');
  if (!cart || cart.customer_id !== customerId) throw notFound('Cart item');
  // A checked-out cart is order history now; its lines are not editable.
  if (cart.checked_out_at) throw conflict('This cart has already been checked out.');

  return { item, cart };
}

/** Checklist 5.3 */
export async function updateItem(customerId, itemId, quantity) {
  const { item, cart } = await findOwnedItem(customerId, itemId);

  const product = await findStoreProduct(cart.store_id, item.product_id);
  const variant = item.variant_id ? await findProductVariant(item.product_id, item.variant_id) : null;

  assertQuantityAllowed(product, variant, quantity);
  await updateQuantity(itemId, quantity);

  return getCart(customerId, cart.store_id);
}

/** Checklist 5.4 */
export async function removeItem(customerId, itemId) {
  const { cart } = await findOwnedItem(customerId, itemId);

  const { error } = await supabaseAdmin.from('cart_items').delete().eq('id', itemId);
  fail(error, 'Could not remove the item from your cart.');

  return getCart(customerId, cart.store_id);
}

/**
 * Checklist 5.5. Empties the lines but keeps the cart row, so the
 * one-active-cart-per-store invariant needs no re-creation dance.
 */
export async function clearCart(customerId, storeId) {
  const cart = await findActiveCart(customerId, storeId);

  if (cart) {
    const { error } = await supabaseAdmin.from('cart_items').delete().eq('cart_id', cart.id);
    fail(error, 'Could not clear your cart.');
  }

  return getCart(customerId, storeId);
}

/**
 * Checklist 5.10. Re-checks the whole cart against live rows and reports what
 * changed, per item, instead of failing on the first problem — the customer
 * should see every issue at once rather than fixing them one refresh at a time.
 *
 * `expectations` carries the prices the client is displaying; a mismatch is a
 * PRICE_CHANGED issue rather than an error, because a price change is the
 * store's right and the customer's decision.
 */
export async function validateCart(customerId, { storeId, items = [] }) {
  const loaded = await loadCart(customerId, storeId);
  const expected = new Map(items.map((item) => [item.itemId, item.unitPricePaise]));

  const lines = loaded.lines.map((line) => {
    if (!expected.has(line.id)) return line;

    const wasPaise = expected.get(line.id);
    if (wasPaise === line.unitPricePaise) return line;

    const issue = {
      code: 'PRICE_CHANGED',
      message: `The price of ${line.name} has changed.`,
      previousUnitPricePaise: wasPaise,
      unitPricePaise: line.unitPricePaise,
    };
    // A price change does not make the line unorderable — it makes it
    // something the customer has to be shown before they pay.
    return { ...line, issues: [...line.issues, issue] };
  });

  const issues = lines.flatMap((line) =>
    line.issues.map((issue) => ({ itemId: line.id, ...issue })),
  );

  return {
    ...toPublicCart({ ...loaded, lines, issues }),
    isValid: issues.length === 0,
  };
}
