import crypto from 'node:crypto';
import { env } from '../../config/env.js';
import { supabaseAdmin } from '../../lib/supabase.js';
import { AppError, internal, notFound, validationFailed } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import * as wa from '../../lib/whatsapp.js';

/**
 * A shop owner's WhatsApp link (migration 0048) and every message in and out.
 *
 * Linking proves the number is the owner's: the dashboard shows a one-time
 * code, and only a message carrying that code *from that number* to the CPSE
 * business number completes the link. Until then nothing sent from the
 * number is acted on.
 */

const CODE_TTL_MS = 15 * 60_000;
const MAX_CODE_ATTEMPTS = 5;
/** Free-form messages are allowed for 24 hours after the owner last wrote. */
const SERVICE_WINDOW_MS = 24 * 60 * 60_000;

const phoneTaken = () => new AppError(409, 'PHONE_TAKEN', 'This WhatsApp number is already linked to another CPSE account.');

const fail = (error, message) => {
  if (error) throw internal(message);
};

const hashCode = (code) => crypto.createHash('sha256').update(`cpse-wa-link:${code}`).digest('hex');
const newCode = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');

export const businessNumber = () => env.WHATSAPP_BUSINESS_NUMBER ?? null;

/** The wa.me link that opens a chat with CPSE, with the message ready to send. */
export function chatLink(text) {
  const number = businessNumber();
  if (!number) return null;
  return `https://wa.me/${number}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}

const toLink = (row) =>
  row && {
    phone: row.phone,
    status: row.status,
    notifyOrders: row.notify_orders,
    activeStoreId: row.active_store_id ?? null,
    linkedAt: row.linked_at ?? null,
    lastMessageAt: row.last_inbound_at ?? null,
  };

async function linkRow(merchantId) {
  const { data, error } = await supabaseAdmin.from('merchant_whatsapp_links').select('*').eq('merchant_id', merchantId).maybeSingle();
  fail(error, 'Could not load the WhatsApp link.');
  return data ?? null;
}

// ── The dashboard side ──────────────────────────────────────────────────────

export async function getStatus(merchant) {
  return {
    configured: wa.isConfigured(),
    businessNumber: businessNumber(),
    chatLink: chatLink(),
    link: toLink(await linkRow(merchant.id)),
  };
}

/**
 * Starts (or restarts) linking a number: a fresh code, valid 15 minutes.
 * A number another account has already linked is refused — one number, one
 * shop owner.
 */
export async function startLink(merchant, { phone }) {
  const number = wa.normalisePhone(phone);
  if (!number) {
    throw validationFailed({ issues: [{ source: 'body', field: 'phone', message: 'Enter a WhatsApp number with country code, e.g. +91 98765 43210.' }] });
  }
  const { data: taken, error } = await supabaseAdmin
    .from('merchant_whatsapp_links')
    .select('merchant_id')
    .eq('phone', number)
    .neq('merchant_id', merchant.id)
    .maybeSingle();
  fail(error, 'Could not check the number.');
  if (taken) throw phoneTaken();

  const code = newCode();
  const expiresAt = new Date(Date.now() + CODE_TTL_MS).toISOString();
  const { data: stores } = await supabaseAdmin.from('stores').select('id').eq('owner_id', merchant.id).order('created_at').limit(1);
  const { error: upsertError } = await supabaseAdmin.from('merchant_whatsapp_links').upsert(
    {
      merchant_id: merchant.id,
      phone: number,
      status: 'pending',
      link_code_hash: hashCode(code),
      link_code_expires_at: expiresAt,
      link_attempts: 0,
      linked_at: null,
      active_store_id: stores?.[0]?.id ?? null,
    },
    { onConflict: 'merchant_id' },
  );
  if (upsertError?.code === '23505') throw phoneTaken();
  fail(upsertError, 'Could not start linking.');

  const message = `LINK ${code}`;
  return { phone: number, code, message, expiresAt, chatLink: chatLink(message), status: await getStatus(merchant) };
}

export async function updateSettings(merchant, { notifyOrders, activeStoreId }) {
  const row = await linkRow(merchant.id);
  if (!row) throw notFound('WhatsApp link');
  const patch = {};
  if (notifyOrders !== undefined) patch.notify_orders = notifyOrders;
  if (activeStoreId !== undefined) {
    const { data: store, error } = await supabaseAdmin.from('stores').select('id').eq('id', activeStoreId).eq('owner_id', merchant.id).maybeSingle();
    fail(error, 'Could not check the store.');
    if (!store) throw notFound('Store');
    patch.active_store_id = activeStoreId;
  }
  const { error } = await supabaseAdmin.from('merchant_whatsapp_links').update(patch).eq('merchant_id', merchant.id);
  fail(error, 'Could not save the WhatsApp settings.');
  return getStatus(merchant);
}

export async function unlink(merchantId) {
  const { error } = await supabaseAdmin.from('merchant_whatsapp_links').delete().eq('merchant_id', merchantId);
  fail(error, 'Could not unlink WhatsApp.');
}

// ── The WhatsApp side ───────────────────────────────────────────────────────

/** The link for a number that wrote in, active or pending. */
export async function linkForPhone(phone) {
  const { data, error } = await supabaseAdmin.from('merchant_whatsapp_links').select('*').eq('phone', phone).maybeSingle();
  fail(error, 'Could not load the WhatsApp link.');
  return data ?? null;
}

/**
 * "LINK 123456" from a number with a pending link. Right code, in time, from
 * that number → active. Five wrong tries end the attempt; a new code is needed.
 */
export async function completeLink(row, code) {
  if (row.status === 'active') return { ok: true, already: true };
  const expired = !row.link_code_expires_at || new Date(row.link_code_expires_at) < new Date();
  if (expired || row.link_attempts >= MAX_CODE_ATTEMPTS) return { ok: false, reason: 'expired' };
  if (!row.link_code_hash || hashCode(code) !== row.link_code_hash) {
    await supabaseAdmin.from('merchant_whatsapp_links').update({ link_attempts: row.link_attempts + 1 }).eq('merchant_id', row.merchant_id);
    return { ok: false, reason: 'wrong' };
  }
  const { error } = await supabaseAdmin
    .from('merchant_whatsapp_links')
    .update({ status: 'active', link_code_hash: null, link_code_expires_at: null, link_attempts: 0, linked_at: new Date().toISOString() })
    .eq('merchant_id', row.merchant_id);
  fail(error, 'Could not finish linking.');
  return { ok: true };
}

export async function touchInbound(merchantId) {
  await supabaseAdmin.from('merchant_whatsapp_links').update({ last_inbound_at: new Date().toISOString() }).eq('merchant_id', merchantId);
}

export async function setActiveStore(merchantId, storeId) {
  const { error } = await supabaseAdmin.from('merchant_whatsapp_links').update({ active_store_id: storeId }).eq('merchant_id', merchantId);
  fail(error, 'Could not switch the shop.');
}

/**
 * Records an incoming message. False when WhatsApp delivered this one before
 * (same message id): it has been handled and must not be acted on twice.
 */
export async function recordInbound({ phone, merchantId = null, waMessageId, kind, body }) {
  const { error } = await supabaseAdmin
    .from('whatsapp_messages')
    .insert({ direction: 'in', phone, merchant_id: merchantId, wa_message_id: waMessageId, kind, body, status: 'received' });
  if (error?.code === '23505') return false;
  if (error) logger.warn('could not record a WhatsApp message', { reason: error.message });
  return true;
}

/** Sends one message and records the attempt, whatever happened. */
export async function sendMessage(phone, message, { merchantId = null, kind = 'reply' } = {}) {
  const result = await wa.send(phone, message);
  const body = message.template ? `[template ${message.template.name}] ${message.template.params.join(' | ')}` : message.text;
  const { error } = await supabaseAdmin.from('whatsapp_messages').insert({
    direction: 'out',
    phone,
    merchant_id: merchantId,
    wa_message_id: result.providerRef ?? null,
    kind,
    body: [body, ...(message.buttons ?? []).map((b) => `[${b.title}]`), ...(message.list?.rows ?? []).map((r) => `• ${r.title}`)].join('\n'),
    status: result.status,
    error: result.error ?? null,
  });
  if (error) logger.warn('could not record a WhatsApp message', { reason: error.message });
  if (result.status === 'failed') logger.warn('WhatsApp message failed', { kind, reason: result.error });
  return result;
}

// ── Alerts ──────────────────────────────────────────────────────────────────

const rupees = (paise) => `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/**
 * A new order, on the owner's phone, with buttons to act on it. Inside the
 * 24-hour window that is a normal message; outside it WhatsApp only allows an
 * approved template (WHATSAPP_ORDER_TEMPLATE), and without one the alert is
 * recorded as skipped with that reason. Never throws: an alert must not break
 * the order that caused it.
 */
export async function alertNewOrder(storeId, merchantId, { orderId, orderNumber }) {
  try {
    const row = await linkRow(merchantId);
    if (!row || row.status !== 'active' || !row.notify_orders) return null;

    const [{ data: order }, { data: store }, { count }] = await Promise.all([
      supabaseAdmin.from('orders').select('id, order_number, total_paise, fulfilment_mode, status').eq('id', orderId).maybeSingle(),
      supabaseAdmin.from('stores').select('id, name').eq('id', storeId).maybeSingle(),
      supabaseAdmin.from('order_items').select('id', { count: 'exact', head: true }).eq('order_id', orderId),
    ]);
    if (!order || !store) return null;
    const items = count ?? 0;
    const summary = `${items} item${items === 1 ? '' : 's'} · ${rupees(order.total_paise)} · ${order.fulfilment_mode === 'delivery' ? 'Delivery' : 'Pickup'}`;

    const inWindow = row.last_inbound_at && Date.now() - new Date(row.last_inbound_at).getTime() < SERVICE_WINDOW_MS;
    let message;
    if (inWindow) {
      message = {
        text: `🛎 New order ${orderNumber ?? order.order_number} at ${store.name}\n${summary}`,
        buttons: [
          { id: `act:accept:${order.id}`, title: 'Accept' },
          { id: `ask:reject:${order.id}`, title: 'Reject' },
          { id: `order:${order.id}`, title: 'View order' },
        ],
      };
    } else if (env.WHATSAPP_ORDER_TEMPLATE) {
      message = {
        template: {
          name: env.WHATSAPP_ORDER_TEMPLATE,
          language: env.WHATSAPP_TEMPLATE_LANGUAGE,
          params: [store.name, orderNumber ?? order.order_number, summary],
        },
      };
    } else {
      const { error } = await supabaseAdmin.from('whatsapp_messages').insert({
        direction: 'out', phone: row.phone, merchant_id: merchantId, kind: 'order_alert',
        body: `New order ${orderNumber ?? order.order_number}`, status: 'skipped',
        error: 'Outside the 24-hour window and no WHATSAPP_ORDER_TEMPLATE is set.',
      });
      if (error) logger.warn('could not record a WhatsApp message', { reason: error.message });
      return { status: 'skipped' };
    }
    return await sendMessage(row.phone, message, { merchantId, kind: 'order_alert' });
  } catch (error) {
    logger.warn('could not send the WhatsApp order alert', { storeId, reason: error?.message ?? String(error) });
    return null;
  }
}
