import crypto from 'node:crypto';
import { env } from '../config/env.js';

/**
 * Outbound channels beyond the app — SMS, WhatsApp, email. Roadmap Phase C
 * "Notification delivery and status tracking".
 *
 * No messaging vendor is configured in this repository. Two providers exist:
 *
 *   none     (default) — every attempt is recorded as `skipped` with the
 *            reason, so "why didn't I get a text?" has a true answer. Nothing
 *            is claimed as sent.
 *   webhook  — POSTs the message, HMAC-signed, to NOTIFY_WEBHOOK_URL: the
 *            seam for a real gateway or an integration relay. Delivery is
 *            `sent` only on a 2xx answer.
 *
 * Message text is sent; no credential, card or identity data ever is.
 */

export function channelProvider() {
  return env.NOTIFY_CHANNEL_PROVIDER;
}

export async function deliver(channel, message, { fetchImpl = fetch } = {}) {
  if (env.NOTIFY_CHANNEL_PROVIDER !== 'webhook' || !env.NOTIFY_WEBHOOK_URL) {
    return { status: 'skipped', error: `No ${channel} provider is configured.` };
  }
  const body = JSON.stringify({ channel, ...message });
  const signature = crypto.createHmac('sha256', env.NOTIFY_WEBHOOK_SECRET).update(body).digest('hex');
  try {
    const response = await fetchImpl(env.NOTIFY_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CPSE-Signature': signature },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return { status: 'failed', error: `The gateway answered ${response.status}.` };
    const reply = await response.json().catch(() => ({}));
    return { status: 'sent', providerRef: reply?.id ?? null };
  } catch (error) {
    return { status: 'failed', error: error?.name === 'TimeoutError' ? 'The gateway timed out.' : 'The gateway could not be reached.' };
  }
}
