import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { cleanup, click, byLabel, byText, fakeServer, render, submit, text, type, waitFor } from './helpers/render';
import AdminApp from '../src/admin/AdminApp';
import { readAdminSession, writeAdminSession } from '../src/admin/adminApi';
import { readSession } from '../src/lib/session';

/**
 * The reviewers' console (roadmap §4 P1 verification review, §5 P5 support
 * escalation): its own sign-in and session, approve/send back with reasons,
 * and replies on escalated conversations.
 */

const STORE = '11111111-1111-4111-8111-111111111111';
const DOC = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CONV = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const META = { page: 1, limit: 20, total: 1, totalPages: 1, hasNextPage: false };

const app = () => <Routes><Route path="/admin/*" element={<AdminApp />} /></Routes>;
const ME = ['GET', /^\/admin\/me$/, () => ({ data: { admin: { id: 'r1', email: 'reviewer@cpse.test', fullName: null } } })] as const;

const row = { storeId: STORE, name: 'Sharma Kirana', slug: 'sharma-kirana', city: 'Pune', legalName: 'Sharma Stores', status: 'pending', statusLabel: 'Under review', isPublished: false, submittedAt: '2026-10-10T10:00:00Z' };
const review = (over: Record<string, unknown> = {}) => ({
  store: { id: STORE, name: 'Sharma Kirana', slug: 'sharma-kirana', phone: '+9198xxxxxx00', email: null, address: 'MG Road, Pune', isPublished: false },
  verification: {
    status: 'pending', statusLabel: 'Under review', isEditable: false,
    details: { legalName: 'Sharma Stores', businessType: 'proprietorship', gstApplicable: true, gstin: '27ABCDE1234F1Z5', ownerName: 'R. Sharma', ownerPhone: '+9198xxxxxx00', ownerEmail: null, businessAddress: null },
    documents: [{ id: DOC, docType: 'shop_photo', label: 'Photo of the shop front', mimeType: 'image/jpeg', sizeBytes: 204800, uploadedAt: '2026-10-10T09:00:00Z' }],
    requiredDocuments: [], missing: [], rejectionReason: null, reviewNote: null, events: [], ...over,
  },
});

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

describe('reviewer sign-in', () => {
  it('signs in with its own session, leaving any shop session alone', async () => {
    const sent = fakeServer([
      ['POST', /^\/admin\/auth\/login$/, () => ({ data: { admin: { id: 'r1', email: 'reviewer@cpse.test', fullName: null }, session: { accessToken: 'admin-token', refreshToken: 'admin-refresh' }, roles: ['admin'] } })],
      [...ME],
      ['GET', /^\/admin\/verifications$/, () => ({ data: { stores: [] }, meta: { ...META, total: 0 } })],
    ]);
    await render(app(), { path: '/admin' });
    window.localStorage.removeItem('cpse.admin.session');
    expect(readSession()?.accessToken).toBe('token-1'); // the shop session render() created
    await type(byLabel('Email'), 'reviewer@cpse.test');
    await type(byLabel('Password'), 'not-a-real-password');
    await submit(document.querySelector('form')!);
    await waitFor(() => text().includes('Nothing to review'));
    expect(readAdminSession()?.accessToken).toBe('admin-token');
    expect(readSession()?.accessToken).toBe('token-1');
    expect(sent.find((r) => r.url === '/admin/me')!.headers.Authorization).toBe('Bearer admin-token');
  });

  it('shows the refusal for an account that cannot review', async () => {
    fakeServer([['POST', /^\/admin\/auth\/login$/, () => ({ status: 403, error: { code: 'FORBIDDEN', message: 'This account cannot review stores.' } })]]);
    await render(app(), { path: '/admin' });
    await type(byLabel('Email'), 'owner@shop.test');
    await type(byLabel('Password'), 'x');
    await submit(document.querySelector('form')!);
    await waitFor(() => text().includes('This account cannot review stores.'));
    expect(readAdminSession()).toBeNull();
  });

  it('drops a reviewer session the server no longer accepts', async () => {
    writeAdminSession({ accessToken: 'old', refreshToken: 'old-refresh' });
    fakeServer([
      ['GET', /^\/admin\/me$/, () => ({ status: 401, error: { code: 'UNAUTHORIZED', message: 'Sign in again.' } })],
      ['POST', /^\/auth\/refresh$/, () => ({ status: 401, error: { code: 'UNAUTHORIZED', message: 'Refresh token expired.' } })],
    ]);
    await render(app(), { path: '/admin/verifications' });
    await waitFor(() => text().includes('Platform review'));
    expect(readAdminSession()).toBeNull();
  });
});

describe('verification review', () => {
  beforeEach(() => writeAdminSession({ accessToken: 'admin-token', refreshToken: 'admin-refresh' }));

  it('approves a complete submission', async () => {
    const sent = fakeServer([
      [...ME],
      ['GET', /^\/admin\/verifications$/, () => ({ data: { stores: [row] }, meta: META })],
      ['GET', new RegExp(`^/admin/verifications/${STORE}$`), () => ({ data: review() })],
      ['GET', new RegExp(`^/admin/verifications/${STORE}/documents/${DOC}/url$`), () => ({ data: { url: 'https://storage.test/signed', expiresInSeconds: 300 } })],
      ['POST', new RegExp(`^/admin/verifications/${STORE}/approve$`), () => ({ data: review({ status: 'verified', statusLabel: 'Verified' }) })],
    ]);
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    await render(app(), { path: '/admin/verifications' });
    await waitFor(() => text().includes('Sharma Kirana'));
    expect(sent.find((r) => r.url === '/admin/verifications')!.params).toMatchObject({ status: 'pending' });
    await click(byText('button', 'Review'));
    await waitFor(() => text().includes('27ABCDE1234F1Z5'));
    await click(byText('button', 'Open'));
    expect(open).toHaveBeenCalledWith('https://storage.test/signed', '_blank', 'noopener,noreferrer');
    expect(byText('button', 'Send back').hasAttribute('disabled')).toBe(true);
    await click(byText('button', 'Approve'));
    expect(sent.find((r) => r.url.endsWith('/approve'))!.body).toEqual({});
    await waitFor(() => text().includes('Sharma Kirana is verified. The owner has been told.'));
  });

  it('sends back with a reason, and cannot approve an incomplete one', async () => {
    const sent = fakeServer([
      [...ME],
      ['GET', /^\/admin\/verifications$/, () => ({ data: { stores: [row] }, meta: META })],
      ['GET', new RegExp(`^/admin/verifications/${STORE}$`), () => ({ data: review({ missing: ['document:identity_proof'] }) })],
      ['POST', new RegExp(`^/admin/verifications/${STORE}/reject$`), () => ({ data: review({ status: 'rejected', statusLabel: 'Changes needed' }) })],
    ]);
    await render(app(), { path: '/admin/verifications' });
    await click(await waitFor(() => byText('button', 'Review')));
    await waitFor(() => text().includes('It cannot be approved yet.'));
    expect(byText('button', 'Approve').hasAttribute('disabled')).toBe(true);
    await type(byLabel(/Reason, if sending back/), 'Please upload the owner identity proof.');
    await click(byText('button', 'Send back'));
    expect(sent.find((r) => r.url.endsWith('/reject'))!.body).toEqual({ reason: 'Please upload the owner identity proof.' });
    await waitFor(() => text().includes('was sent back with your reason'));
  });
});

describe('escalated support', () => {
  beforeEach(() => writeAdminSession({ accessToken: 'admin-token', refreshToken: 'admin-refresh' }));

  it('replies to an escalated conversation and resolves it', async () => {
    const conversation = {
      id: CONV, kind: 'order', kindLabel: 'About an order', requestType: null, subject: 'Order not delivered', status: 'escalated', statusLabel: 'With support',
      customer: { id: 'c1', name: 'Asha' }, store: { id: STORE, name: 'Sharma Kirana' }, order: { id: 'o1', orderNumber: 'ORD-4' }, product: null,
      lastMessageAt: '2026-10-11T08:00:00Z', isUnread: true, createdAt: '2026-10-10T08:00:00Z',
      messages: [{ id: 'm1', from: 'customer', body: 'Still waiting since yesterday.', at: '2026-10-10T08:00:00Z' }, { id: 'm2', from: 'system', body: 'No reply from the shop in 24 hours — passed to support.', at: '2026-10-11T08:00:00Z' }],
    };
    const sent = fakeServer([
      [...ME],
      ['GET', /^\/admin\/verifications$/, () => ({ data: { stores: [] }, meta: META })],
      ['GET', /^\/admin\/support$/, () => ({ data: { conversations: [conversation] } })],
      ['GET', new RegExp(`^/admin/support/${CONV}$`), () => ({ data: { conversation } })],
      ['POST', new RegExp(`^/admin/support/${CONV}/messages$`), (req) => ({ status: 201, data: { conversation: { ...conversation, status: 'resolved', statusLabel: 'Resolved', messages: [...conversation.messages, { id: 'm3', from: 'admin', body: req.body.body, at: '2026-10-11T09:00:00Z' }] } } })],
    ]);
    await render(app(), { path: '/admin/support' });
    await waitFor(() => text().includes('Order not delivered'));
    expect(text()).toContain('Sharma Kirana');
    await click(byText('button', /Order not delivered/));
    await waitFor(() => text().includes('Still waiting since yesterday.'));
    await type(byLabel('Reply as platform support'), 'We have called the shop; it is on its way.');
    await click(byText('button', 'Reply & resolve'));
    expect(sent.find((r) => r.method === 'POST')!.body).toEqual({ body: 'We have called the shop; it is on its way.', resolve: true });
    await waitFor(() => text().includes('Replied and resolved.'));
  });
});
