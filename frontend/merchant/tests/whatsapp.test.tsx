import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, click, byLabel, byText, fakeServer, render, text, type, waitFor } from './helpers/render';
import WhatsAppPage, { prettyPhone } from '../src/features/tools/WhatsAppPage';

/**
 * Linking WhatsApp from the shop app: enter a number, get a code to send from
 * it, and once linked, alerts on/off, the shop messages are about, unlinking.
 */

const STORES = { stores: [{ id: 's1', name: 'Sharma Kirana' }, { id: 's2', name: 'Sharma Sweets' }] };
const status = (link: Record<string, unknown> | null, configured = true) => ({
  whatsapp: { configured, businessNumber: '919000000001', chatLink: 'https://wa.me/919000000001', link },
});
const ACTIVE = { phone: '919812300001', status: 'active', notifyOrders: true, activeStoreId: 's1', linkedAt: '2026-11-20T10:00:00Z', lastMessageAt: null };

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

describe('WhatsApp', () => {
  it('writes Indian numbers the way people read them', () => {
    expect(prettyPhone('919812300001')).toBe('+91 98123 00001');
    expect(prettyPhone('14155550100')).toBe('+14155550100');
  });

  it('links a number: shows the code to send from it, with a ready-made WhatsApp link', async () => {
    const sent = fakeServer([
      ['GET', /^\/merchant\/whatsapp$/, () => ({ data: status(null) })],
      ['GET', /^\/merchant\/stores$/, () => ({ data: STORES })],
      ['POST', /^\/merchant\/whatsapp\/link$/, () => ({
        status: 201,
        data: { linking: { phone: '919812300001', code: '482913', message: 'LINK 482913', expiresAt: '2026-11-23T10:15:00Z', chatLink: 'https://wa.me/919000000001?text=LINK%20482913', status: status({ ...ACTIVE, status: 'pending' }).whatsapp } },
      })],
    ]);
    await render(<WhatsAppPage />);
    await waitFor(() => text().includes('Link your WhatsApp number'));
    await type(byLabel('WhatsApp number'), '98123 00001');
    await click(byText('button', 'Get my code'));
    await waitFor(() => text().includes('LINK 482913'));
    expect(sent.find((r) => r.method === 'POST')!.body).toEqual({ phone: '98123 00001' });
    expect(text()).toContain('+91 98123 00001');
    expect(text()).toContain('+91 90000 00001');
    expect((byText('a', 'Open WhatsApp with this message') as HTMLAnchorElement).href).toBe('https://wa.me/919000000001?text=LINK%20482913');
  });

  it('once linked: alerts can be turned off, and the shop chosen', async () => {
    const sent = fakeServer([
      ['GET', /^\/merchant\/whatsapp$/, () => ({ data: status(ACTIVE) })],
      ['GET', /^\/merchant\/stores$/, () => ({ data: STORES })],
      ['PATCH', /^\/merchant\/whatsapp$/, (req) => ({ data: status({ ...ACTIVE, ...req.body }) })],
    ]);
    await render(<WhatsAppPage />);
    await waitFor(() => text().includes('Linked to +91 98123 00001'));
    await click(byLabel(/Send me new orders on WhatsApp/));
    await waitFor(() => sent.some((r) => r.method === 'PATCH'));
    expect(sent.find((r) => r.method === 'PATCH')!.body).toEqual({ notifyOrders: false });
    await type(byLabel('Messages are about') as HTMLSelectElement, 's2');
    await waitFor(() => sent.filter((r) => r.method === 'PATCH').length === 2);
    expect(sent.filter((r) => r.method === 'PATCH')[1].body).toEqual({ activeStoreId: 's2' });
  });

  it('unlinking asks first', async () => {
    const sent = fakeServer([
      ['GET', /^\/merchant\/whatsapp$/, () => ({ data: status(ACTIVE) })],
      ['GET', /^\/merchant\/stores$/, () => ({ data: { stores: [STORES.stores[0]] } })],
      ['DELETE', /^\/merchant\/whatsapp\/link$/, () => ({ data: status(null) })],
    ]);
    await render(<WhatsAppPage />);
    await waitFor(() => text().includes('Linked to'));
    expect(text()).not.toContain('Messages are about');
    await click(byText('button', 'Unlink this number'));
    expect(sent.some((r) => r.method === 'DELETE')).toBe(false);
    await click(byText('button', 'Yes, unlink'));
    await waitFor(() => text().includes('Link your WhatsApp number'));
    expect(sent.some((r) => r.method === 'DELETE')).toBe(true);
  });

  it('says so when CPSE has not switched WhatsApp on yet', async () => {
    fakeServer([
      ['GET', /^\/merchant\/whatsapp$/, () => ({ data: status(null, false) })],
      ['GET', /^\/merchant\/stores$/, () => ({ data: STORES })],
    ]);
    await render(<WhatsAppPage />);
    await waitFor(() => text().includes("WhatsApp isn't switched on for CPSE yet"));
  });
});
