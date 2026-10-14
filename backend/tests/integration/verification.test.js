/**
 * Store verification (KYC) against real Postgres (migration 0039).
 * Roadmap §4 P1 "Merchant Store Verification / KYC"; critical addition
 * "Merchant onboarding verification"; §6 Store publishing.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../src/lib/supabase.js', async () => {
  const { createPgSupabase } = await import('../helpers/pgSupabase.js');
  return createPgSupabase();
});

const { resetDatabase, sql, storage } = await import('../helpers/pgSupabase.js');
const flow = await import('./flow.js');
const { call, expectStatus } = flow;

beforeEach(async () => {
  await resetDatabase();
});

const verificationOf = async (shop) =>
  expectStatus(await call('get', `/merchant/stores/${shop.store.id}/verification`, shop.merchant), 200).verification;

describe('a store cannot be published until it is verified', () => {
  it('lists verification as missing, and the database refuses a direct publish', async () => {
    const shop = await flow.openShop();
    const response = await call('post', `/merchant/stores/${shop.store.id}/publish`, shop.merchant);
    expect(response.status).toBe(422);
    expect(response.body.error).toMatchObject({ code: 'STORE_INCOMPLETE', details: { missing: ['verification'] } });

    await expect(sql('update stores set is_published = true where id = $1', [shop.store.id])).rejects.toThrow(/STORE_NOT_VERIFIED/);
  });

  it('walks not_submitted → pending → verified, then publishes, and customers can open it', async () => {
    const shop = await flow.openShop();
    expect((await verificationOf(shop)).status).toBe('not_submitted');

    await flow.verify(shop);
    const verified = await verificationOf(shop);
    expect(verified.status).toBe('verified');
    expect(verified.events.map((e) => [e.fromStatus, e.toStatus, e.actor])).toEqual([
      ['not_submitted', 'pending', 'merchant'],
      ['pending', 'verified', 'admin'],
    ]);

    await flow.publish(shop);
    expectStatus(await call('get', `/stores/${shop.store.slug}`), 200);
  });
});

describe('submission rules', () => {
  it('refuses to submit until the required details and documents are present', async () => {
    const shop = await flow.openShop();
    const early = await call('post', `/merchant/stores/${shop.store.id}/verification/submit`, shop.merchant, {});
    expect(early.status).toBe(422);
    expect(early.body.error.code).toBe('VERIFICATION_INCOMPLETE');
    expect(early.body.error.details.missing).toEqual(
      expect.arrayContaining(['legalName', 'businessType', 'ownerName', 'ownerPhone', 'document:shop_photo', 'document:identity_proof', 'document:address_proof']),
    );
  });

  it('requires a valid GSTIN and the GST certificate when GST applies', async () => {
    const shop = await flow.openShop();
    const bad = await call('put', `/merchant/stores/${shop.store.id}/verification`, shop.merchant, { gstApplicable: true, gstin: '12345' });
    expect(bad.status).toBe(422);

    expectStatus(
      await call('put', `/merchant/stores/${shop.store.id}/verification`, shop.merchant, {
        gstApplicable: true,
        gstin: '03abcde1234f1z5',
        legalName: 'Sharma Traders',
        businessType: 'proprietorship',
        ownerName: 'Ramesh',
        ownerPhone: '+919876500000',
      }),
      200,
    );
    const view = await verificationOf(shop);
    expect(view.details.gstin).toBe('03ABCDE1234F1Z5');
    expect(view.missing).toContain('document:gst_certificate');
    expect(view.requiredDocuments.map((d) => d.docType)).toContain('gst_certificate');

    expectStatus(await flow.uploadDocument(shop, 'gst_certificate', flow.SAMPLE_PDF, 'gst.pdf'), 201);
    expect((await verificationOf(shop)).missing).not.toContain('document:gst_certificate');
  });

  it('refuses a file that is not an image or a PDF, whatever its name says', async () => {
    const shop = await flow.openShop();
    const response = await flow.uploadDocument(shop, 'shop_photo', Buffer.from('<html>not a photo</html>'), 'photo.png');
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('DOCUMENT_INVALID');
  });

  it('keeps documents private: stored in the private bucket, read only through a short-lived link', async () => {
    const shop = await flow.openShop();
    const uploaded = expectStatus(await flow.uploadDocument(shop, 'identity_proof', await flow.samplePhoto()), 201).verification;
    const doc = uploaded.documents[0];
    expect(doc).not.toHaveProperty('storagePath');
    expect(JSON.stringify(uploaded)).not.toMatch(/storage\/v1\/object\/public/);
    expect([...storage.keys()].some((key) => key.startsWith(`kyc/stores/${shop.store.id}/`))).toBe(true);

    const link = expectStatus(await call('get', `/merchant/stores/${shop.store.id}/verification/documents/${doc.id}/url`, shop.merchant), 200);
    expect(link.url).toMatch(/\/object\/sign\/kyc\//);
    expect(link.expiresInSeconds).toBe(300);

    // Nothing public carries it.
    await flow.publish(shop);
    const page = await call('get', `/stores/${shop.store.slug}`);
    expect(JSON.stringify(page.body)).not.toMatch(/kyc|identity_proof|verification/);
  });

  it('locks the details while under review', async () => {
    const shop = await flow.openShop();
    await flow.verify(shop);
    const response = await call('put', `/merchant/stores/${shop.store.id}/verification`, shop.merchant, { ownerName: 'Someone Else' });
    expect(response.status).toBe(409);
  });
});

describe('review', () => {
  async function submitted() {
    const shop = await flow.openShop();
    expectStatus(
      await call('put', `/merchant/stores/${shop.store.id}/verification`, shop.merchant, {
        legalName: 'Sharma Traders',
        businessType: 'proprietorship',
        ownerName: 'Ramesh Sharma',
        ownerPhone: '+919876500000',
      }),
      200,
    );
    for (const type of ['shop_photo', 'identity_proof', 'address_proof']) {
      expectStatus(await flow.uploadDocument(shop, type, await flow.samplePhoto()), 201);
    }
    expectStatus(await call('post', `/merchant/stores/${shop.store.id}/verification/submit`, shop.merchant, {}), 200);
    return shop;
  }

  it('a rejection needs a reason, reaches the merchant, and lets them fix and resubmit', async () => {
    const shop = await submitted();
    const admin = await flow.newAdmin();

    const queue = expectStatus(await call('get', '/admin/verifications?status=pending', admin.auth), 200);
    expect(queue.stores.map((s) => s.storeId)).toContain(shop.store.id);

    const detail = expectStatus(await call('get', `/admin/verifications/${shop.store.id}`, admin.auth), 200);
    expect(detail.verification.documents).toHaveLength(3);
    const link = expectStatus(
      await call('get', `/admin/verifications/${shop.store.id}/documents/${detail.verification.documents[0].id}/url`, admin.auth),
      200,
    );
    expect(link.url).toMatch(/sign\/kyc/);

    expect((await call('post', `/admin/verifications/${shop.store.id}/reject`, admin.auth, {})).status).toBe(422);
    expectStatus(
      await call('post', `/admin/verifications/${shop.store.id}/reject`, admin.auth, { reason: 'The shop photo is blurred.' }),
      200,
    );

    const view = await verificationOf(shop);
    expect(view).toMatchObject({ status: 'rejected', isEditable: true, rejectionReason: 'The shop photo is blurred.' });
    const inbox = expectStatus(await call('get', `/merchant/stores/${shop.store.id}/notifications`, shop.merchant), 200);
    expect(inbox.notifications[0]).toMatchObject({ type: 'verification_update' });

    expectStatus(await flow.uploadDocument(shop, 'shop_photo', await flow.samplePhoto()), 201);
    expectStatus(await call('post', `/merchant/stores/${shop.store.id}/verification/submit`, shop.merchant, {}), 200);
    expectStatus(await call('post', `/admin/verifications/${shop.store.id}/approve`, admin.auth, { note: 'Clear now' }), 200);

    const events = (await verificationOf(shop)).events.map((e) => e.toStatus);
    expect(events).toEqual(['pending', 'rejected', 'pending', 'verified']);
    // The replaced photo is kept on record, no longer current.
    expect(await sql(`select count(*)::int as n from verification_documents where store_id = $1 and doc_type = 'shop_photo'`, [shop.store.id])).toEqual([{ n: 2 }]);
  });

  it('revoking a verification unpublishes the store at once', async () => {
    const shop = await flow.openShop();
    const admin = await flow.verify(shop);
    await flow.publish(shop);

    expectStatus(await call('post', `/admin/verifications/${shop.store.id}/reject`, admin.auth, { reason: 'GST registration cancelled' }), 200);
    expect((await call('get', `/stores/${shop.store.slug}`)).status).toBe(404);
    expect((await call('post', `/merchant/stores/${shop.store.id}/publish`, shop.merchant)).status).toBe(422);
  });

  it('records each decision with the reviewer and a snapshot of what was reviewed, immutably', async () => {
    const shop = await submitted();
    const admin = await flow.newAdmin();
    expectStatus(await call('post', `/admin/verifications/${shop.store.id}/approve`, admin.auth, {}), 200);

    const [event] = await sql(`select actor_id, snapshot from verification_events where store_id = $1 and to_status = 'verified'`, [shop.store.id]);
    expect(event.actor_id).toBe(admin.id);
    expect(event.snapshot.details.legal_name).toBe('Sharma Traders');
    expect(event.snapshot.documents).toHaveLength(3);
    await expect(sql('update verification_events set reason = $1', ['x'])).rejects.toThrow(/immutable/);
  });

  it('only reviewers can review; a merchant cannot approve their own store', async () => {
    const shop = await submitted();
    expect((await call('post', `/admin/verifications/${shop.store.id}/approve`, shop.merchant, {})).status).toBe(403);
    const customer = await flow.newCustomer();
    expect((await call('get', '/admin/verifications', customer.auth)).status).toBe(403);
    expect((await call('get', `/merchant/stores/${shop.store.id}/verification`, customer.auth)).status).toBe(403);
  });

  it('another merchant cannot see this store’s documents', async () => {
    const shop = await submitted();
    const other = await flow.openShop({ name: 'Other' });
    const [{ id }] = await sql('select id from verification_documents where store_id = $1 limit 1', [shop.store.id]);
    expect((await call('get', `/merchant/stores/${shop.store.id}/verification`, other.merchant)).status).toBe(404);
    expect((await call('get', `/merchant/stores/${other.store.id}/verification/documents/${id}/url`, other.merchant)).status).toBe(404);
  });

  it('cannot approve what was never submitted', async () => {
    const shop = await flow.openShop();
    const admin = await flow.newAdmin();
    expect((await call('post', `/admin/verifications/${shop.store.id}/approve`, admin.auth, {})).status).toBe(409);
  });
});
