import crypto from 'node:crypto';
import { env } from '../config/env.js';

/**
 * Meta's WhatsApp Cloud API — the transport for running a shop from WhatsApp
 * (src/modules/whatsapp). Three things live here and nothing else: checking
 * that a webhook call really came from Meta, turning our message shapes into
 * Meta's, and sending them.
 *
 * With WHATSAPP_PROVIDER=none nothing leaves the server: send() answers
 * `skipped` with the reason, and the caller records it like any other attempt.
 */

export const isConfigured = () => env.WHATSAPP_PROVIDER === 'meta';

/** Meta's limits on interactive messages; longer text is cut, never refused. */
export const LIMITS = { body: 1024, text: 4096, buttonTitle: 20, buttons: 3, rowTitle: 24, rowDescription: 72, rows: 10, id: 200 };

const cut = (value, max) => {
  const text = String(value ?? '');
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
};

/**
 * A phone number as WhatsApp writes it: country code and digits, no "+".
 * A bare 10-digit Indian mobile gets 91. Anything else that is not 8–15
 * digits is null.
 */
export function normalisePhone(input) {
  const digits = String(input ?? '').replace(/[^0-9]/g, '').replace(/^00/, '');
  const withCountry = digits.length === 10 && /^[6-9]/.test(digits) ? `91${digits}` : digits;
  return /^[1-9][0-9]{7,14}$/.test(withCountry) ? withCountry : null;
}

/**
 * X-Hub-Signature-256 is "sha256=" + HMAC-SHA256(app secret, the exact body
 * bytes). Compared in constant time; any missing piece is a refusal.
 */
export function verifySignature(rawBody, header, secret = env.WHATSAPP_APP_SECRET) {
  if (!secret || !header || typeof rawBody !== 'string') return false;
  const [scheme, given] = String(header).split('=');
  if (scheme !== 'sha256' || !given) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  const a = Buffer.from(given, 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * The messages Meta delivered in one webhook call, flattened: who sent it,
 * its id, and what they typed or tapped. Delivery receipts and anything we
 * cannot read are left out.
 */
export function inboundMessages(body) {
  const found = [];
  for (const entry of body?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      for (const message of change?.value?.messages ?? []) {
        const from = normalisePhone(message?.from);
        if (!from || !message?.id) continue;
        if (message.type === 'text') {
          found.push({ from, id: message.id, text: String(message.text?.body ?? ''), replyId: null });
        } else if (message.type === 'interactive') {
          const reply = message.interactive?.button_reply ?? message.interactive?.list_reply;
          found.push({ from, id: message.id, text: String(reply?.title ?? ''), replyId: reply?.id ? String(reply.id) : null });
        } else if (message.type === 'button') {
          found.push({ from, id: message.id, text: String(message.button?.text ?? ''), replyId: message.button?.payload ? String(message.button.payload) : null });
        } else {
          found.push({ from, id: message.id, text: '', replyId: null, unsupported: message.type ?? 'unknown' });
        }
      }
    }
  }
  return found;
}

/**
 * Our message shapes → Meta's request body.
 *   { text }
 *   { text, buttons: [{ id, title }] }                 up to 3 reply buttons
 *   { text, list: { button, rows: [{ id, title, description }] } }   up to 10 rows
 *   { template: { name, language, params: [string] } } outside the 24-hour window
 */
export function toMetaMessage(to, message) {
  const base = { messaging_product: 'whatsapp', recipient_type: 'individual', to };
  if (message.template) {
    return {
      ...base,
      type: 'template',
      template: {
        name: message.template.name,
        language: { code: message.template.language },
        components: [{ type: 'body', parameters: message.template.params.map((text) => ({ type: 'text', text: cut(text, 200) })) }],
      },
    };
  }
  if (message.buttons?.length) {
    return {
      ...base,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: cut(message.text, LIMITS.body) },
        action: {
          buttons: message.buttons.slice(0, LIMITS.buttons).map((b) => ({ type: 'reply', reply: { id: cut(b.id, LIMITS.id), title: cut(b.title, LIMITS.buttonTitle) } })),
        },
      },
    };
  }
  if (message.list?.rows?.length) {
    return {
      ...base,
      type: 'interactive',
      interactive: {
        type: 'list',
        body: { text: cut(message.text, LIMITS.body) },
        action: {
          button: cut(message.list.button ?? 'Choose', LIMITS.buttonTitle),
          sections: [{
            title: cut(message.list.title ?? 'Choose one', LIMITS.rowTitle),
            rows: message.list.rows.slice(0, LIMITS.rows).map((r) => ({
              id: cut(r.id, LIMITS.id),
              title: cut(r.title, LIMITS.rowTitle),
              ...(r.description ? { description: cut(r.description, LIMITS.rowDescription) } : {}),
            })),
          }],
        },
      },
    };
  }
  return { ...base, type: 'text', text: { preview_url: false, body: cut(message.text, LIMITS.text) } };
}

/** Sends one message. Never throws: the outcome is the answer. */
export async function send(to, message, { fetchImpl = fetch } = {}) {
  if (!isConfigured()) return { status: 'skipped', error: 'WhatsApp is not configured (WHATSAPP_PROVIDER=none).' };
  try {
    const response = await fetchImpl(`https://graph.facebook.com/${env.WHATSAPP_API_VERSION}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(toMetaMessage(to, message)),
      signal: AbortSignal.timeout(10_000),
    });
    const reply = await response.json().catch(() => ({}));
    if (!response.ok) return { status: 'failed', error: reply?.error?.message ? `Meta: ${reply.error.message}` : `Meta answered ${response.status}.` };
    return { status: 'sent', providerRef: reply?.messages?.[0]?.id ?? null };
  } catch (error) {
    return { status: 'failed', error: error?.name === 'TimeoutError' ? 'Meta timed out.' : 'Meta could not be reached.' };
  }
}
