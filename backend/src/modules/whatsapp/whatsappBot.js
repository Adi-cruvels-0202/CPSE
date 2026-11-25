import { supabaseAdmin } from '../../lib/supabase.js';
import { logger } from '../../lib/logger.js';
import { localNow } from '../../lib/openingHours.js';
import { escapeSearchTerm } from '../stores/store.service.js';
import * as orders from '../merchantOrders/merchantOrder.service.js';
import { getDashboard } from '../merchantDashboard/dashboard.service.js';
import { recordMovement } from '../merchantInventory/inventory.service.js';
import { addHoliday, listHolidays, removeHoliday } from '../merchantStores/merchantStore.service.js';
import * as links from './whatsapp.service.js';

/**
 * The shop on WhatsApp: a message from a linked number, answered as that
 * shop owner. Short words and taps, no AI — every reply is predictable.
 *
 * Everything goes through the same services the dashboard uses (orders through
 * transitionOrder, stock through the ledger), so the same rules, customer
 * notifications and history apply. Button and list ids are ours, but they are
 * never trusted: each one is checked against the owner's active shop again.
 *
 *   help · orders · order <code> · accept|preparing|ready|dispatch|done <code>
 *   reject|cancel <code> [reason] (asks first) · sales [today|yesterday|week]
 *   stock <name> · low stock · add <qty> <name> · close today · open today
 *   shop (switch shop) · unlink
 */

const NOT_REVENUE = ['pending_payment', 'cancelled', 'rejected'];
const OPEN = ['placed', 'accepted', 'preparing', 'ready_for_pickup', 'out_for_delivery'];

/** Words for the shop owner (the customer-facing ones say "by the store"). */
const STATUS_LABELS = {
  pending_payment: 'Awaiting payment', placed: 'New', accepted: 'Accepted', preparing: 'Preparing',
  ready_for_pickup: 'Ready for pickup', out_for_delivery: 'Out for delivery', completed: 'Completed',
  cancelled: 'Cancelled', rejected: 'Rejected',
};
const label = (status) => STATUS_LABELS[status] ?? status;

const rupees = (paise) => `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
/** "CPSE-261114-7UWQ4T" → "7UWQ4T": what the owner types back. */
export const shortCode = (orderNumber) => String(orderNumber).split('-').pop();

const HELP = [
  'Here is what you can send:',
  '• *orders* – open orders',
  '• *order 7UWQ4T* – one order, with buttons to act',
  '• *accept 7UWQ4T* · *ready 7UWQ4T* · *done 7UWQ4T*',
  '• *reject 7UWQ4T* · *cancel 7UWQ4T out of stock*',
  '• *missing 7UWQ4T* – an item you cannot pack',
  '• *sales* · *sales yesterday* · *sales week*',
  '• *stock rice* – what is left',
  '• *low stock* – what is running out',
  '• *add 10 rice* – stock received',
  '• *close today* · *open today*',
  '• *shop* – switch shop · *unlink* – stop using WhatsApp',
].join('\n');

const MENU = {
  button: 'Menu',
  title: 'What do you need?',
  rows: [
    { id: 'cmd:orders', title: 'Open orders', description: 'See and act on new and running orders' },
    { id: 'cmd:sales', title: "Today's sales", description: 'Orders and counter sales today' },
    { id: 'cmd:low', title: 'Low stock', description: 'Items running out' },
    { id: 'cmd:help', title: 'All commands', description: 'Everything you can type' },
  ],
};

// ── Entry point ─────────────────────────────────────────────────────────────

/**
 * Handles one inbound message: { from, id, text, replyId }. Returns nothing;
 * replies are sent and recorded. A message WhatsApp delivers twice is handled
 * once.
 */
export async function handleInbound(message) {
  const link = await links.linkForPhone(message.from);
  const fresh = await links.recordInbound({
    phone: message.from,
    merchantId: link?.status === 'active' ? link.merchant_id : null,
    waMessageId: message.id,
    kind: message.replyId ? 'tap' : 'text',
    body: message.replyId ? `${message.text} [${message.replyId}]` : message.text,
  });
  if (!fresh) return;

  const reply = (msg, kind) => links.sendMessage(message.from, msg, { merchantId: link?.merchant_id ?? null, kind });
  const text = message.text.trim();

  // 1. Linking: the only thing an unknown or pending number can do.
  const linkCode = /^link\s+(\d{6})$/i.exec(text);
  if (!link || link.status !== 'active') {
    if (link && linkCode) {
      const done = await links.completeLink(link, linkCode[1]);
      if (done.ok) {
        await links.touchInbound(link.merchant_id);
        return reply({ text: `✅ WhatsApp linked to your CPSE shop.\n\n${HELP}`, list: MENU }, 'linked');
      }
      return reply({
        text: done.reason === 'expired'
          ? 'That code has expired. Open CPSE → More → WhatsApp and press "Link again" for a new one.'
          : 'That code is not right. Check the code on your CPSE screen and send LINK followed by the 6 digits.',
      }, 'link_failed');
    }
    return reply({
      text: 'This number is not linked to a CPSE shop yet. Open the CPSE shop app → More → WhatsApp, enter this number, and send the code it shows.',
    }, 'not_linked');
  }

  await links.touchInbound(link.merchant_id);

  try {
    const ctx = await context(link);
    if (!ctx.ok) return reply({ text: ctx.message }, 'blocked');
    const answer = message.replyId ? await onTap(ctx, message.replyId) : await onText(ctx, text);
    if (answer) await reply(answer, ctx.kind ?? 'reply');
  } catch (error) {
    const known = error?.isOperational;
    if (!known) logger.error('WhatsApp command failed', { reason: error?.message ?? String(error) });
    await reply({ text: known ? `⚠️ ${error.message}` : '⚠️ Something went wrong. Please try again, or use the CPSE app.' }, 'error');
  }
}

/** Who is writing and which shop they mean. A suspended account gets nothing. */
async function context(link) {
  const [{ data: account }, { data: merchant }, { data: stores }] = await Promise.all([
    supabaseAdmin.from('customers').select('id, suspended_at').eq('id', link.merchant_id).maybeSingle(),
    supabaseAdmin.from('merchants').select('id, email, full_name').eq('id', link.merchant_id).maybeSingle(),
    supabaseAdmin.from('stores').select('*').eq('owner_id', link.merchant_id).order('created_at'),
  ]);
  if (account?.suspended_at) return { ok: false, message: 'This CPSE account is suspended. Contact CPSE support.' };
  if (!merchant) return { ok: false, message: 'This number is not linked to a shop account any more.' };
  if (!stores?.length) return { ok: false, message: 'You have no shop on CPSE yet. Create one in the CPSE shop app first.' };
  const store = stores.find((s) => s.id === link.active_store_id) ?? stores[0];
  if (store.id !== link.active_store_id) await links.setActiveStore(link.merchant_id, store.id);
  return { ok: true, link, merchant, stores, store };
}

// ── Typed words ─────────────────────────────────────────────────────────────

async function onText(ctx, text) {
  const t = text.toLowerCase().replace(/\s+/g, ' ').trim();
  let m;
  if (/^(hi|hello|hey|help|menu|start|\?)$/.test(t)) return { text: `${ctx.store.name}\n\n${HELP}`, list: MENU };
  if (/^orders?$/.test(t) || t === 'new orders' || t === 'open orders') return listOpenOrders(ctx);
  if ((m = /^order #?([a-z0-9-]{4,})$/.exec(t))) return showOrder(ctx, await findOrder(ctx, m[1]));
  if ((m = /^(?:item )?missing #?([a-z0-9-]{4,})$/.exec(t))) return pickMissing(ctx, await findOrder(ctx, m[1]));
  if ((m = /^(accept|preparing|prepare|ready|dispatch|out|done|complete|completed|delivered|picked up) #?([a-z0-9-]{4,})$/.exec(t))) {
    return act(ctx, verbToAction(m[1]), await findOrder(ctx, m[2]));
  }
  if ((m = /^(reject|cancel) #?([a-z0-9-]{4,})(?: (.{3,300}))?$/.exec(t))) {
    const order = await findOrder(ctx, m[2]);
    return confirmStop(ctx, m[1], order, m[3] ?? null);
  }
  if ((m = /^sales(?: (today|yesterday|week|this week|7 days))?$/.exec(t))) return sales(ctx, m[1] ?? 'today');
  if (/^(low|low stock|running out)$/.test(t)) return lowStock(ctx);
  if ((m = /^stock (.{2,60})$/.exec(t))) return stockFor(ctx, m[1]);
  if ((m = /^(?:add|received|receive) (\d{1,5}) (.{2,60})$/.exec(t))) return addStockPick(ctx, Number(m[1]), m[2]);
  if ((m = /^(close|open) today$/.exec(t))) return m[1] === 'close' ? closeToday(ctx) : openToday(ctx);
  if (/^(shop|shops|store|stores|switch)$/.test(t)) return chooseShop(ctx);
  if (/^(unlink|stop)$/.test(t)) {
    return { text: 'Stop managing your shop from this WhatsApp number?', buttons: [{ id: 'unlink:yes', title: 'Yes, unlink' }, { id: 'cmd:help', title: 'No' }] };
  }
  if (/^link \d{6}$/.test(t)) return { text: '✅ This number is already linked.' };
  return { text: `Sorry, I didn't understand "${text.slice(0, 60)}".\n\n${HELP}`, list: MENU };
}

const verbToAction = (verb) =>
  ({ accept: 'accept', preparing: 'preparing', prepare: 'preparing', ready: 'ready', dispatch: 'ready', out: 'ready' })[verb] ?? 'complete';

// ── Taps (button and list ids we sent) ──────────────────────────────────────

async function onTap(ctx, id) {
  const [kind, a, b, c] = id.split(':');
  switch (kind) {
    case 'cmd':
      if (a === 'orders') return listOpenOrders(ctx);
      if (a === 'sales') return sales(ctx, 'today');
      if (a === 'low') return lowStock(ctx);
      return { text: `${ctx.store.name}\n\n${HELP}` };
    case 'order':
      return showOrder(ctx, await findOrderById(ctx, a));
    case 'act':
      return act(ctx, a, await findOrderById(ctx, b));
    case 'ask':
      return confirmStop(ctx, a, await findOrderById(ctx, b), null);
    case 'stop':
      return stopOrder(ctx, a, await findOrderById(ctx, b), c ? decodeURIComponent(c) : null);
    case 'miss':
      return pickMissing(ctx, await findOrderById(ctx, a));
    case 'missitem':
      return askHowMany(ctx, await findOrderById(ctx, a), b);
    case 'short':
      return markMissing(ctx, await findOrderById(ctx, a), b, Number(c));
    case 'stockin':
      return addStock(ctx, a, Number(b));
    case 'shop':
      return switchShop(ctx, a);
    case 'unlink':
      await links.unlink(ctx.link.merchant_id);
      ctx.kind = 'unlinked';
      return { text: 'Unlinked. This number can no longer manage your shop. You can link it again from the CPSE app any time.' };
    default:
      return { text: HELP, list: MENU };
  }
}

// ── Orders ──────────────────────────────────────────────────────────────────

async function findOrder(ctx, code) {
  const term = escapeSearchTerm(code.toUpperCase());
  const { data, error } = await supabaseAdmin
    .from('orders')
    .select('id, order_number')
    .eq('store_id', ctx.store.id)
    .ilike('order_number', `%${term}`)
    .order('placed_at', { ascending: false })
    .limit(2);
  if (error) throw error;
  if (!data?.length) return null;
  return data[0];
}

async function findOrderById(ctx, orderId) {
  if (!/^[0-9a-f-]{36}$/i.test(orderId ?? '')) return null;
  const { data } = await supabaseAdmin.from('orders').select('id, order_number').eq('id', orderId).eq('store_id', ctx.store.id).maybeSingle();
  return data ?? null;
}

const NOT_FOUND = { text: `I couldn't find that order in this shop. Send *orders* to see the open ones.` };

async function listOpenOrders(ctx) {
  const { data, error } = await supabaseAdmin
    .from('orders')
    .select('id, order_number, status, total_paise, fulfilment_mode, placed_at')
    .eq('store_id', ctx.store.id)
    .in('status', OPEN)
    .order('placed_at', { ascending: true })
    .limit(10);
  if (error) throw error;
  if (!data?.length) return { text: `No open orders at ${ctx.store.name} right now. 🎉` };
  const lines = data.map((o) => `• *${shortCode(o.order_number)}* · ${label(o.status)} · ${rupees(o.total_paise)} · ${o.fulfilment_mode === 'delivery' ? 'Delivery' : 'Pickup'}`);
  return {
    text: `Open orders at ${ctx.store.name} (${data.length}${data.length === 10 ? '+' : ''}):\n${lines.join('\n')}\n\nTap one to act on it.`,
    list: {
      button: 'Open an order',
      title: 'Open orders',
      rows: data.map((o) => ({ id: `order:${o.id}`, title: shortCode(o.order_number), description: `${label(o.status)} · ${rupees(o.total_paise)}` })),
    },
  };
}

const ACTION_BUTTON = {
  accept: { title: 'Accept', id: (o) => `act:accept:${o.id}` },
  reject: { title: 'Reject', id: (o) => `ask:reject:${o.id}` },
  'status:preparing': { title: 'Start preparing', id: (o) => `act:preparing:${o.id}` },
  'status:ready_for_pickup': { title: 'Ready for pickup', id: (o) => `act:ready:${o.id}` },
  'status:out_for_delivery': { title: 'Out for delivery', id: (o) => `act:ready:${o.id}` },
  complete: { title: 'Mark completed', id: (o) => `act:complete:${o.id}` },
  cancel: { title: 'Cancel order', id: (o) => `ask:cancel:${o.id}` },
};

async function showOrder(ctx, found, prefix = '') {
  if (!found) return NOT_FOUND;
  const order = await orders.getOrder(ctx.store, found.id);
  const items = (order.items ?? []).filter((i) => i.isActive !== false);
  const lines = items.slice(0, 15).map((i) => `• ${i.quantity} × ${itemName(i)} – ${rupees(i.lineTotalPaise)}${(i.orderedQuantity ?? i.quantity) > i.quantity ? ` _(${i.unavailableQuantity} of ${i.orderedQuantity} not available)_` : ''}`);
  if (items.length > 15) lines.push(`…and ${items.length - 15} more`);
  for (const gone of order.unavailableItems ?? []) lines.push(`• ~${gone.orderedQuantity ?? gone.quantity} × ${itemName(gone)}~ _not available_`);
  const who = [order.customer?.name, order.customer?.phone].filter(Boolean).join(' · ');
  const text = [
    prefix,
    `*Order ${shortCode(order.orderNumber)}* · ${label(order.status)}`,
    `${order.fulfilmentMode === 'delivery' ? 'Delivery' : 'Pickup'}${who ? ` · ${who}` : ''}`,
    '',
    ...lines,
    '',
    `Total ${rupees(order.totals.totalPaise)} · ${order.paymentMethod === 'cash' ? 'Cash' : 'Online'} (${order.paymentStatus})`,
    order.customerNote ? `Note: ${order.customerNote}` : '',
  ].filter((line, i) => line !== '' || i > 0).join('\n').trim();
  // WhatsApp allows three buttons: the next step, "Item missing" while the
  // order can still change, then reject or cancel. Everything else can be typed.
  const all = order.allowedActions.map((a) => ACTION_BUTTON[a] && { action: a, id: ACTION_BUTTON[a].id(order), title: ACTION_BUTTON[a].title }).filter(Boolean);
  const forward = all.filter((b) => b.action !== 'reject' && b.action !== 'cancel');
  const stop = all.filter((b) => b.action === 'reject' || b.action === 'cancel');
  const buttons = (order.canChangeItems
    ? [forward[0], { id: `miss:${order.id}`, title: 'Item missing' }, stop[0]]
    : [...forward, ...stop]
  ).filter(Boolean).slice(0, 3).map(({ id, title }) => ({ id, title }));
  return buttons.length ? { text, buttons } : { text };
}

const itemName = (i) => `${i.productName}${i.variantName && i.variantName !== 'Default' ? ` (${i.variantName})` : ''}`;

/** "Item missing": which line can the shop not pack? */
async function pickMissing(ctx, found) {
  if (!found) return NOT_FOUND;
  const order = await orders.getOrder(ctx.store, found.id);
  if (!order.canChangeItems) {
    return { text: `Order ${shortCode(order.orderNumber)} is ${label(order.status).toLowerCase()}; its items can only be changed before it is ready.` };
  }
  const items = (order.items ?? []).filter((i) => i.isActive !== false);
  return {
    text: `Which item in order ${shortCode(order.orderNumber)} can you not pack? The rest of the order goes ahead, and the customer is told.`,
    list: {
      button: 'Choose item',
      title: 'Items in this order',
      rows: items.slice(0, 10).map((i) => ({ id: `missitem:${order.id}:${i.id}`, title: itemName(i), description: `${i.quantity} ordered · ${rupees(i.lineTotalPaise)}` })),
    },
  };
}

/** None of it, or one fewer — the common cases, as buttons. */
async function askHowMany(ctx, found, itemId) {
  if (!found) return NOT_FOUND;
  const order = await orders.getOrder(ctx.store, found.id);
  const item = (order.items ?? []).find((i) => i.id === itemId && i.isActive !== false);
  if (!item) return { text: 'That item is no longer in this order.' };
  const buttons = [{ id: `short:${order.id}:${item.id}:0`, title: item.quantity === 1 ? 'Remove it' : 'None available' }];
  if (item.quantity > 1) buttons.push({ id: `short:${order.id}:${item.id}:${item.quantity - 1}`, title: `Only ${item.quantity - 1}` });
  buttons.push({ id: `order:${order.id}`, title: 'Keep it' });
  return {
    text: `${item.quantity} × ${itemName(item)} in order ${shortCode(order.orderNumber)}. How many can you pack?${item.quantity > 2 ? '\nFor another number, change it in the CPSE app.' : ''}`,
    buttons,
  };
}

/** Applies it through the same rules as the app: bill, stock, refund, customer told. */
async function markMissing(ctx, found, itemId, quantityLeft) {
  if (!found) return NOT_FOUND;
  if (!Number.isInteger(quantityLeft) || quantityLeft < 0) return { text: 'That quantity is not valid.' };
  const before = await orders.getOrder(ctx.store, found.id);
  const item = (before.items ?? []).find((i) => i.id === itemId && i.isActive !== false);
  if (!item) return { text: 'That item is no longer in this order.' };
  const after = await orders.markItemUnavailable(ctx.store, found.id, itemId, { quantityLeft });
  if (['cancelled', 'rejected'].includes(after.status)) {
    return { text: `Nothing was left to pack, so order ${shortCode(after.orderNumber)} is now *${label(after.status)}*. The customer has been told${after.paymentStatus === 'paid' ? ' and will be refunded' : ''}.` };
  }
  const what = quantityLeft === 0 ? `${itemName(item)} removed` : `${itemName(item)}: packing ${quantityLeft} of ${item.quantity}`;
  return showOrder(ctx, { id: after.id }, `✅ ${what}. New total *${rupees(after.totals.totalPaise)}*. The customer has been told and can cancel if they don't want it now.\n`);
}

/** Moves an order on. Each step is checked against what the order allows now. */
async function act(ctx, action, found) {
  if (!found) return NOT_FOUND;
  const current = await orders.getOrder(ctx.store, found.id);
  const allowed = current.allowedActions;
  let done;
  if (action === 'accept') done = await orders.acceptOrder(ctx.store, found.id);
  else if (action === 'preparing') done = await orders.setOrderStatus(ctx.store, found.id, { status: 'preparing' });
  else if (action === 'ready') {
    const next = allowed.find((a) => a === 'status:ready_for_pickup' || a === 'status:out_for_delivery');
    if (!next && allowed.includes('status:preparing')) {
      await orders.setOrderStatus(ctx.store, found.id, { status: 'preparing' });
      const after = await orders.getOrder(ctx.store, found.id);
      const step = after.allowedActions.find((a) => a.startsWith('status:') && a !== 'status:preparing');
      done = await orders.setOrderStatus(ctx.store, found.id, { status: step.slice('status:'.length) });
    } else {
      done = await orders.setOrderStatus(ctx.store, found.id, { status: (next ?? 'status:ready_for_pickup').slice('status:'.length) });
    }
  } else if (action === 'complete') done = await orders.completeOrder(ctx.store, found.id);
  else return { text: HELP };
  return showOrder(ctx, { id: done.id }, `✅ Order ${shortCode(done.orderNumber)} is now *${label(done.status)}*. The customer has been told.\n`);
}

/** Rejecting or cancelling tells the customer no — so it always asks first. */
async function confirmStop(ctx, verb, found, reason) {
  if (!found) return NOT_FOUND;
  const code = shortCode(found.order_number);
  const why = reason ?? (verb === 'reject' ? '' : 'Cancelled by the shop');
  return {
    text: `${verb === 'reject' ? 'Reject' : 'Cancel'} order ${code}?${why ? `\nReason given to the customer: "${why}"` : ''}\nTo give a different reason, send: ${verb} ${code} <reason>`,
    buttons: [
      { id: `stop:${verb}:${found.id}${why ? `:${encodeURIComponent(why).slice(0, 120)}` : ''}`, title: verb === 'reject' ? 'Yes, reject' : 'Yes, cancel' },
      { id: `order:${found.id}`, title: 'No, keep it' },
    ],
  };
}

async function stopOrder(ctx, verb, found, reason) {
  if (!found) return NOT_FOUND;
  const done = verb === 'reject'
    ? await orders.rejectOrder(ctx.store, found.id, reason ? { reason } : {})
    : await orders.cancelOrder(ctx.store, found.id, { reason: reason && reason.length >= 3 ? reason : 'Cancelled by the shop' });
  return { text: `Order ${shortCode(done.orderNumber)} is now *${label(done.status)}*. The customer has been told.` };
}

// ── Sales ───────────────────────────────────────────────────────────────────

const localDate = (instant, timezone) => localNow(timezone, new Date(instant)).date;

function daysBack(timezone, n) {
  const dates = [];
  for (let i = 0; i < n; i += 1) dates.push(localNow(timezone, new Date(Date.now() - i * 86_400_000)).date);
  return dates;
}

async function sales(ctx, period) {
  const tz = ctx.store.timezone;
  const span = period === 'today' ? 1 : period === 'yesterday' ? 2 : 7;
  const wanted = new Set(period === 'yesterday' ? [daysBack(tz, 2)[1]] : daysBack(tz, span));
  const since = new Date(Date.now() - (span + 1) * 86_400_000).toISOString();
  const [o, s] = await Promise.all([
    supabaseAdmin.from('orders').select('status, total_paise, placed_at').eq('store_id', ctx.store.id).gte('placed_at', since),
    supabaseAdmin.from('sales').select('total_paise, created_at').eq('store_id', ctx.store.id).gte('created_at', since),
  ]);
  if (o.error || s.error) throw o.error ?? s.error;
  const orderRows = (o.data ?? []).filter((r) => !NOT_REVENUE.includes(r.status) && wanted.has(localDate(r.placed_at, tz)));
  const saleRows = (s.data ?? []).filter((r) => wanted.has(localDate(r.created_at, tz)));
  const sum = (rows) => rows.reduce((t, r) => t + r.total_paise, 0);
  const title = period === 'today' ? 'Today' : period === 'yesterday' ? 'Yesterday' : 'Last 7 days';
  const total = sum(orderRows) + sum(saleRows);
  let open = '';
  if (period === 'today') {
    const d = await getDashboard(ctx.store);
    const waiting = d.openOrders.placed;
    open = `\n\nOpen orders: ${waiting} new · ${d.openOrders.accepted + d.openOrders.preparing} in progress · ${d.openOrders.ready} ready`;
  }
  return {
    text: `📊 *${title}* at ${ctx.store.name}\nOnline orders: ${orderRows.length} · ${rupees(sum(orderRows))}\nCounter sales: ${saleRows.length} · ${rupees(sum(saleRows))}\n*Total: ${rupees(total)}*${open}`,
    ...(period === 'today' ? { buttons: [{ id: 'cmd:orders', title: 'Open orders' }, { id: 'cmd:low', title: 'Low stock' }] } : {}),
  };
}

// ── Stock ───────────────────────────────────────────────────────────────────

async function lowStock(ctx) {
  const d = await getDashboard(ctx.store);
  if (!d.lowStock.length) return { text: `Nothing is running low at ${ctx.store.name}. 👍` };
  const lines = d.lowStock.slice(0, 15).map((l) => `• ${l.productName}${l.variantName !== 'Default' ? ` (${l.variantName})` : ''}: *${l.availableQuantity}* left`);
  return { text: `⚠️ Running low at ${ctx.store.name}:\n${lines.join('\n')}\n\nGot more in? Send e.g. *add 10 ${d.lowStock[0].productName.toLowerCase()}*` };
}

async function variantsMatching(ctx, query) {
  const term = escapeSearchTerm(query.trim());
  const { data: products, error } = await supabaseAdmin
    .from('products')
    .select('id, name, track_inventory')
    .eq('store_id', ctx.store.id)
    .is('archived_at', null)
    .ilike('name', `%${term}%`)
    .order('name')
    .limit(10);
  if (error) throw error;
  if (!products?.length) return [];
  const { data: variants, error: vError } = await supabaseAdmin
    .from('product_variants')
    .select('id, product_id, name, quantity_on_hand, reserved_quantity, is_available')
    .in('product_id', products.map((p) => p.id));
  if (vError) throw vError;
  const byId = new Map(products.map((p) => [p.id, p]));
  return (variants ?? [])
    .map((v) => ({ ...v, product: byId.get(v.product_id) }))
    .sort((a, b) => a.product.name.localeCompare(b.product.name) || a.name.localeCompare(b.name));
}

const variantLabel = (v) => `${v.product.name}${v.name !== 'Default' ? ` (${v.name})` : ''}`;

async function stockFor(ctx, query) {
  const found = await variantsMatching(ctx, query);
  if (!found.length) return { text: `No product matching "${query}" at ${ctx.store.name}.` };
  const lines = found.slice(0, 20).map((v) =>
    v.product.track_inventory
      ? `• ${variantLabel(v)}: *${v.quantity_on_hand - v.reserved_quantity}* can sell${v.reserved_quantity ? ` (${v.quantity_on_hand} on shelf, ${v.reserved_quantity} held)` : ''}`
      : `• ${variantLabel(v)}: stock not counted`);
  return { text: `📦 Stock at ${ctx.store.name}:\n${lines.join('\n')}` };
}

async function addStockPick(ctx, quantity, query) {
  if (quantity < 1) return { text: 'Send a quantity of 1 or more, e.g. *add 10 rice*.' };
  const found = (await variantsMatching(ctx, query)).filter((v) => v.product.track_inventory);
  if (!found.length) return { text: `No product matching "${query}" that counts stock at ${ctx.store.name}.` };
  if (found.length === 1) {
    const v = found[0];
    return {
      text: `Add *${quantity}* to ${variantLabel(v)}? It has ${v.quantity_on_hand} on the shelf now.`,
      buttons: [{ id: `stockin:${v.id}:${quantity}`, title: `Yes, add ${quantity}` }, { id: 'cmd:help', title: 'No' }],
    };
  }
  return {
    text: `Which one got ${quantity} more?`,
    list: {
      button: 'Choose product',
      title: 'Matching products',
      rows: found.slice(0, 10).map((v) => ({ id: `stockin:${v.id}:${quantity}`, title: variantLabel(v), description: `${v.quantity_on_hand} on the shelf now` })),
    },
  };
}

async function addStock(ctx, variantId, quantity) {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100_000) return { text: 'That quantity is not valid.' };
  if (!/^[0-9a-f-]{36}$/i.test(variantId ?? '')) return { text: 'That product is not in this shop.' };
  const { data: variant } = await supabaseAdmin.from('product_variants').select('id, store_id').eq('id', variantId).maybeSingle();
  if (!variant || variant.store_id !== ctx.store.id) return { text: 'That product is not in this shop.' };
  const { variant: after } = await recordMovement(ctx.store, ctx.merchant, 'stock_in', { variantId, quantity, notes: 'Received (WhatsApp)' });
  const name = after?.productName ? `${after.productName}${after.name && after.name !== 'Default' ? ` (${after.name})` : ''}` : 'the product';
  return { text: `✅ Added ${quantity} to ${name}. On the shelf now: *${after?.quantityOnHand ?? '—'}*.` };
}

// ── Shop ────────────────────────────────────────────────────────────────────

async function closeToday(ctx) {
  const today = localNow(ctx.store.timezone).date;
  const existing = (await listHolidays(ctx.store)).find((h) => h.date === today);
  if (existing) return { text: `${ctx.store.name} is already marked closed today. Send *open today* to reopen.` };
  await addHoliday(ctx.store, { date: today, reason: 'Closed today' });
  return { text: `🔒 ${ctx.store.name} shows as *closed today* to customers. Send *open today* to reopen.` };
}

async function openToday(ctx) {
  const today = localNow(ctx.store.timezone).date;
  const existing = (await listHolidays(ctx.store)).find((h) => h.date === today);
  if (!existing) return { text: `${ctx.store.name} is not marked closed today. Your usual opening hours apply.` };
  await removeHoliday(ctx.store, existing.id);
  return { text: `🔓 ${ctx.store.name} is open again today, on its usual hours.` };
}

function chooseShop(ctx) {
  if (ctx.stores.length === 1) return { text: `You have one shop: ${ctx.store.name}.` };
  return {
    text: `Messages are about *${ctx.store.name}*. Choose a shop:`,
    list: { button: 'Choose shop', title: 'Your shops', rows: ctx.stores.slice(0, 10).map((s) => ({ id: `shop:${s.id}`, title: s.name, description: s.id === ctx.store.id ? 'Current' : s.city ?? '' })) },
  };
}

async function switchShop(ctx, storeId) {
  const store = ctx.stores.find((s) => s.id === storeId);
  if (!store) return { text: 'That shop is not yours.' };
  await links.setActiveStore(ctx.link.merchant_id, store.id);
  return { text: `Switched to *${store.name}*. Everything you send now is about this shop.`, list: MENU };
}
