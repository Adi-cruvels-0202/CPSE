import crypto from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { inboundMessages, normalisePhone, send, toMetaMessage, verifySignature } from '../src/lib/whatsapp.js';

/** The Meta Cloud API adapter (src/lib/whatsapp.js): pure shapes and checks. */

describe('phone numbers', () => {
  it('writes them the way WhatsApp does', () => {
    expect(normalisePhone('+91 98765 43210')).toBe('919876543210');
    expect(normalisePhone('98765-43210')).toBe('919876543210');
    expect(normalisePhone('0091 98765 43210')).toBe('919876543210');
    expect(normalisePhone('+1 (415) 555-0100')).toBe('14155550100');
    expect(normalisePhone('12345')).toBeNull();
    expect(normalisePhone('')).toBeNull();
  });
});

describe('webhook signatures', () => {
  const body = '{"entry":[]}';
  const good = `sha256=${crypto.createHmac('sha256', 'secret-123').update(body).digest('hex')}`;
  it('accepts only Meta’s HMAC over the exact bytes', () => {
    expect(verifySignature(body, good, 'secret-123')).toBe(true);
    expect(verifySignature(`${body} `, good, 'secret-123')).toBe(false);
    expect(verifySignature(body, good, 'other-secret')).toBe(false);
    expect(verifySignature(body, 'sha1=abc', 'secret-123')).toBe(false);
    expect(verifySignature(body, undefined, 'secret-123')).toBe(false);
    expect(verifySignature(body, good, undefined)).toBe(false);
  });
});

describe('reading what Meta delivered', () => {
  it('flattens typed text and taps, and skips delivery receipts', () => {
    const payload = {
      entry: [{
        changes: [{
          value: {
            statuses: [{ id: 'wamid.status', status: 'delivered' }],
            messages: [
              { from: '919876543210', id: 'wamid.1', type: 'text', text: { body: 'orders' } },
              { from: '919876543210', id: 'wamid.2', type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: 'order:abc', title: '7UWQ4T' } } },
              { from: '919876543210', id: 'wamid.3', type: 'image', image: {} },
            ],
          },
        }],
      }],
    };
    expect(inboundMessages(payload)).toEqual([
      { from: '919876543210', id: 'wamid.1', text: 'orders', replyId: null },
      { from: '919876543210', id: 'wamid.2', text: '7UWQ4T', replyId: 'order:abc' },
      { from: '919876543210', id: 'wamid.3', text: '', replyId: null, unsupported: 'image' },
    ]);
    expect(inboundMessages({})).toEqual([]);
  });
});

describe("Meta's message shapes", () => {
  it('builds text, buttons, lists and templates within Meta’s limits', () => {
    expect(toMetaMessage('91', { text: 'hi' })).toMatchObject({ type: 'text', text: { body: 'hi' } });

    const buttons = toMetaMessage('91', { text: 'Order', buttons: [1, 2, 3, 4].map((n) => ({ id: `b${n}`, title: 'A very long button title indeed' })) });
    expect(buttons.interactive.action.buttons).toHaveLength(3);
    expect(buttons.interactive.action.buttons[0].reply.title.length).toBeLessThanOrEqual(20);

    const list = toMetaMessage('91', { text: 'Pick', list: { rows: Array.from({ length: 12 }, (_, i) => ({ id: `r${i}`, title: `Row ${i}` })) } });
    expect(list.interactive.type).toBe('list');
    expect(list.interactive.action.sections[0].rows).toHaveLength(10);

    const template = toMetaMessage('91', { template: { name: 'new_order', language: 'en', params: ['Shop', 'CPSE-1', '2 items'] } });
    expect(template.template).toEqual({
      name: 'new_order',
      language: { code: 'en' },
      components: [{ type: 'body', parameters: [{ type: 'text', text: 'Shop' }, { type: 'text', text: 'CPSE-1' }, { type: 'text', text: '2 items' }] }],
    });
  });

  it('sends nothing when WhatsApp is not configured, and says so', async () => {
    let called = false;
    const result = await send('919876543210', { text: 'hi' }, { fetchImpl: () => { called = true; } });
    expect(result).toEqual({ status: 'skipped', error: expect.stringContaining('not configured') });
    expect(called).toBe(false);
  });
});
