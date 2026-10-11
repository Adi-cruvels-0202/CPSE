import { supabaseAdmin } from '../../lib/supabase.js';
import { conflict, internal, notFound } from '../../lib/errors.js';
import * as notifications from '../notifications/notification.service.js';
import { emitToStore } from '../notifications/merchantNotification.service.js';

/**
 * Talking to the shop — roadmap §5 P3 "Ask the shop", "Special requests",
 * "Order messaging"; P5 "Customer support" with a clear escalation path.
 *
 * Every conversation is between one customer and one store (and, for an
 * order, that order). The customer reaches it through their own id; the
 * merchant through their own store; a platform reviewer only once the
 * customer escalates it. Messages are never edited.
 */

const CONVERSATION_COLUMNS = `
  id, store_id, customer_id, order_id, product_id, kind, request_type, subject, status,
  escalated_at, escalation_reason, resolved_at, last_message_at, customer_read_at, merchant_read_at, created_at
`;

const fail = (error, message) => {
  if (error) throw internal(message);
};

export const KIND_LABELS = {
  question: 'Question',
  special_request: 'Special request',
  order: 'About an order',
  support: 'Problem with an order',
};

const STATUS_LABELS = {
  awaiting_store: 'Waiting for the store',
  awaiting_customer: 'Waiting for you',
  resolved: 'Resolved',
  escalated: 'Escalated to CPSE support',
};

async function messagesOf(conversationId) {
  const { data, error } = await supabaseAdmin
    .from('messages')
    .select('id, sender_type, body, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });
  fail(error, 'Could not load the messages.');
  return (data ?? []).map((m) => ({ id: m.id, from: m.sender_type, body: m.body, at: m.created_at }));
}

async function context(rows) {
  const storeIds = [...new Set(rows.map((r) => r.store_id))];
  const orderIds = [...new Set(rows.map((r) => r.order_id).filter(Boolean))];
  const productIds = [...new Set(rows.map((r) => r.product_id).filter(Boolean))];
  const customerIds = [...new Set(rows.map((r) => r.customer_id))];
  const [stores, orders, products, customers] = await Promise.all([
    storeIds.length ? supabaseAdmin.from('stores').select('id, slug, name').in('id', storeIds) : { data: [] },
    orderIds.length ? supabaseAdmin.from('orders').select('id, order_number, status').in('id', orderIds) : { data: [] },
    productIds.length ? supabaseAdmin.from('products').select('id, name').in('id', productIds) : { data: [] },
    customerIds.length ? supabaseAdmin.from('customers').select('id, full_name').in('id', customerIds) : { data: [] },
  ]);
  const map = (result) => new Map((result.data ?? []).map((row) => [row.id, row]));
  return { stores: map(stores), orders: map(orders), products: map(products), customers: map(customers) };
}

function toConversation(row, ctx, viewer) {
  const lastRead = viewer === 'customer' ? row.customer_read_at : viewer === 'merchant' ? row.merchant_read_at : null;
  return {
    id: row.id,
    kind: row.kind,
    kindLabel: KIND_LABELS[row.kind],
    requestType: row.request_type ?? null,
    subject: row.subject,
    status: row.status,
    statusLabel: STATUS_LABELS[row.status],
    store: ctx.stores.get(row.store_id) ? { id: row.store_id, slug: ctx.stores.get(row.store_id).slug, name: ctx.stores.get(row.store_id).name } : null,
    customer: viewer === 'customer' ? undefined : { id: row.customer_id, name: ctx.customers.get(row.customer_id)?.full_name ?? null },
    order: row.order_id ? { id: row.order_id, orderNumber: ctx.orders.get(row.order_id)?.order_number ?? null } : null,
    product: row.product_id ? { id: row.product_id, name: ctx.products.get(row.product_id)?.name ?? null } : null,
    escalatedAt: row.escalated_at ?? null,
    escalationReason: row.escalation_reason ?? null,
    resolvedAt: row.resolved_at ?? null,
    lastMessageAt: row.last_message_at,
    isUnread: viewer ? !lastRead || new Date(lastRead) < new Date(row.last_message_at) : false,
    createdAt: row.created_at,
  };
}

async function postMessage(conversation, senderType, senderId, body) {
  const now = new Date().toISOString();
  const { error } = await supabaseAdmin.from('messages').insert({ conversation_id: conversation.id, sender_type: senderType, sender_id: senderId, body });
  fail(error, 'Could not send the message.');
  const patch = { last_message_at: now };
  if (senderType === 'customer') Object.assign(patch, { customer_read_at: now, status: conversation.status === 'escalated' ? 'escalated' : 'awaiting_store' });
  if (senderType === 'merchant') Object.assign(patch, { merchant_read_at: now, status: conversation.status === 'escalated' ? 'escalated' : 'awaiting_customer' });
  if (senderType === 'admin') Object.assign(patch, { status: 'escalated' });
  const { error: updateError } = await supabaseAdmin.from('conversations').update(patch).eq('id', conversation.id);
  fail(updateError, 'Could not send the message.');
}

async function visibleStore(storeId) {
  const { data, error } = await supabaseAdmin.from('stores').select('id, name, is_active, is_published').eq('id', storeId).maybeSingle();
  fail(error, 'Could not load the store.');
  if (!data || !data.is_active || !data.is_published) throw notFound('Store');
  return data;
}

// ── Customer ────────────────────────────────────────────────────────────────

export async function startConversation(customerId, input) {
  let storeId = input.storeId ?? null;
  if (input.orderId) {
    const { data: order, error } = await supabaseAdmin
      .from('orders')
      .select('id, store_id, order_number')
      .eq('id', input.orderId)
      .eq('customer_id', customerId)
      .maybeSingle();
    fail(error, 'Could not load the order.');
    if (!order) throw notFound('Order');
    storeId = order.store_id;
  } else {
    await visibleStore(storeId);
  }
  if (input.productId) {
    const { data: product } = await supabaseAdmin.from('products').select('id, store_id').eq('id', input.productId).is('archived_at', null).maybeSingle();
    if (!product || product.store_id !== storeId) throw notFound('Product');
  }

  const { data, error } = await supabaseAdmin
    .from('conversations')
    .insert({
      store_id: storeId,
      customer_id: customerId,
      order_id: input.orderId ?? null,
      product_id: input.productId ?? null,
      kind: input.kind,
      request_type: input.kind === 'special_request' ? input.requestType ?? 'other' : null,
      subject: input.subject,
    })
    .select(CONVERSATION_COLUMNS)
    .maybeSingle();
  fail(error, 'Could not start the conversation.');
  await postMessage(data, 'customer', customerId, input.message);

  const typeByKind = { special_request: 'special_request', support: 'support_ticket' };
  await emitToStore(storeId, {
    type: typeByKind[input.kind] ?? 'message',
    title: `${KIND_LABELS[input.kind]}: ${input.subject}`,
    body: input.message.slice(0, 200),
    payload: { conversation_id: data.id, order_id: input.orderId ?? null },
  });
  return getCustomerConversation(customerId, data.id);
}

async function findCustomerConversation(customerId, conversationId) {
  const { data, error } = await supabaseAdmin
    .from('conversations')
    .select(CONVERSATION_COLUMNS)
    .eq('id', conversationId)
    .eq('customer_id', customerId)
    .maybeSingle();
  fail(error, 'Could not load the conversation.');
  if (!data) throw notFound('Conversation');
  return data;
}

export async function listCustomerConversations(customerId, { orderId } = {}) {
  let query = supabaseAdmin.from('conversations').select(CONVERSATION_COLUMNS).eq('customer_id', customerId);
  if (orderId) query = query.eq('order_id', orderId);
  const { data, error } = await query.order('last_message_at', { ascending: false });
  fail(error, 'Could not load your conversations.');
  const rows = data ?? [];
  const ctx = await context(rows);
  return rows.map((row) => toConversation(row, ctx, 'customer'));
}

export async function getCustomerConversation(customerId, conversationId) {
  const row = await findCustomerConversation(customerId, conversationId);
  await supabaseAdmin.from('conversations').update({ customer_read_at: new Date().toISOString() }).eq('id', row.id);
  const ctx = await context([row]);
  return { ...toConversation({ ...row, customer_read_at: new Date().toISOString() }, ctx, 'customer'), messages: await messagesOf(row.id) };
}

export async function customerReply(customerId, conversationId, body) {
  const row = await findCustomerConversation(customerId, conversationId);
  if (row.status === 'resolved') {
    // Writing again reopens it: the customer still has something to say.
    await supabaseAdmin.from('conversations').update({ status: 'awaiting_store', resolved_at: null }).eq('id', row.id);
    row.status = 'awaiting_store';
  }
  await postMessage(row, 'customer', customerId, body);
  await emitToStore(row.store_id, {
    type: row.kind === 'support' ? 'support_ticket' : 'message',
    title: `New reply: ${row.subject}`,
    body: body.slice(0, 200),
    payload: { conversation_id: row.id },
  });
  return getCustomerConversation(customerId, conversationId);
}

/** The escalation path: the customer hands an order problem to the platform. */
export async function escalate(customerId, conversationId, { reason }) {
  const row = await findCustomerConversation(customerId, conversationId);
  if (row.kind !== 'support' && row.kind !== 'order') {
    throw conflict('Only a conversation about an order can be escalated.');
  }
  if (row.status === 'escalated') return getCustomerConversation(customerId, conversationId);
  const { error } = await supabaseAdmin
    .from('conversations')
    .update({ status: 'escalated', escalated_at: new Date().toISOString(), escalation_reason: reason, kind: 'support' })
    .eq('id', row.id);
  fail(error, 'Could not escalate.');
  await supabaseAdmin.from('messages').insert({
    conversation_id: row.id,
    sender_type: 'system',
    body: `Escalated to CPSE support: ${reason}`,
  });
  await emitToStore(row.store_id, {
    type: 'support_ticket',
    title: `Escalated to CPSE support: ${row.subject}`,
    body: reason,
    payload: { conversation_id: row.id },
  });
  return getCustomerConversation(customerId, conversationId);
}

export async function resolveByCustomer(customerId, conversationId) {
  const row = await findCustomerConversation(customerId, conversationId);
  const { error } = await supabaseAdmin.from('conversations').update({ status: 'resolved', resolved_at: new Date().toISOString() }).eq('id', row.id);
  fail(error, 'Could not close the conversation.');
  return getCustomerConversation(customerId, conversationId);
}

// ── Merchant ────────────────────────────────────────────────────────────────

async function findStoreConversation(store, conversationId) {
  const { data, error } = await supabaseAdmin
    .from('conversations')
    .select(CONVERSATION_COLUMNS)
    .eq('id', conversationId)
    .eq('store_id', store.id)
    .maybeSingle();
  fail(error, 'Could not load the conversation.');
  if (!data) throw notFound('Conversation');
  return data;
}

export async function listStoreConversations(store, { status, kind }) {
  let query = supabaseAdmin.from('conversations').select(CONVERSATION_COLUMNS).eq('store_id', store.id);
  if (status) query = query.eq('status', status);
  if (kind) query = query.eq('kind', kind);
  const { data, error } = await query.order('last_message_at', { ascending: false });
  fail(error, 'Could not load conversations.');
  const rows = data ?? [];
  const ctx = await context(rows);
  return rows.map((row) => toConversation(row, ctx, 'merchant'));
}

export async function getStoreConversation(store, conversationId) {
  const row = await findStoreConversation(store, conversationId);
  const now = new Date().toISOString();
  await supabaseAdmin.from('conversations').update({ merchant_read_at: now }).eq('id', row.id);
  const ctx = await context([row]);
  return { ...toConversation({ ...row, merchant_read_at: now }, ctx, 'merchant'), messages: await messagesOf(row.id) };
}

export async function merchantReply(store, merchant, conversationId, body, { resolve = false } = {}) {
  const row = await findStoreConversation(store, conversationId);
  await postMessage(row, 'merchant', merchant.id, body);
  if (resolve && row.status !== 'escalated') {
    await supabaseAdmin.from('conversations').update({ status: 'resolved', resolved_at: new Date().toISOString() }).eq('id', row.id);
  }
  await notifications.emit(row.customer_id, {
    type: 'message',
    title: `${store.name} replied: ${row.subject}`,
    body: body.slice(0, 200),
    payload: { conversation_id: row.id, store_id: store.id, order_id: row.order_id ?? null },
  });
  return getStoreConversation(store, conversationId);
}

// ── Platform support (escalated only) ───────────────────────────────────────

export async function listEscalated() {
  const { data, error } = await supabaseAdmin
    .from('conversations')
    .select(CONVERSATION_COLUMNS)
    .eq('status', 'escalated')
    .order('escalated_at', { ascending: true });
  fail(error, 'Could not load escalations.');
  const rows = data ?? [];
  const ctx = await context(rows);
  return rows.map((row) => toConversation(row, ctx, null));
}

async function findEscalated(conversationId) {
  const { data: row, error } = await supabaseAdmin
    .from('conversations')
    .select(CONVERSATION_COLUMNS)
    .eq('id', conversationId)
    .maybeSingle();
  fail(error, 'Could not load the conversation.');
  // A reviewer sees a conversation only once a customer has escalated it.
  if (!row || !row.escalated_at) throw notFound('Conversation');
  return row;
}

export async function getEscalated(conversationId) {
  const row = await findEscalated(conversationId);
  const ctx = await context([row]);
  return { ...toConversation(row, ctx, null), messages: await messagesOf(row.id) };
}

export async function adminReply(admin, conversationId, body, { resolve = false } = {}) {
  const row = await findEscalated(conversationId);
  await postMessage(row, 'admin', admin.id, body);
  if (resolve) {
    await supabaseAdmin.from('conversations').update({ status: 'resolved', resolved_at: new Date().toISOString() }).eq('id', row.id);
  }
  await notifications.emit(row.customer_id, {
    type: 'support_update',
    title: `CPSE support replied: ${row.subject}`,
    body: body.slice(0, 200),
    payload: { conversation_id: row.id },
  });
  return getEscalated(conversationId);
}
