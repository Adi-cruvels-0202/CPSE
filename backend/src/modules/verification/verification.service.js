import { supabaseAdmin } from '../../lib/supabase.js';
import { conflict, internal, notFound, unprocessable } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { storeDocument, signedDocumentUrl, removeDocument } from '../../lib/documentUpload.js';
import { emitToStore } from '../notifications/merchantNotification.service.js';

/**
 * Store verification (KYC) — roadmap §4 P1 and the critical addition
 * "Merchant onboarding verification". Migration 0039 holds the rules: the
 * status moves only through set_verification_status, every move is an event
 * with a snapshot, and a store cannot be published until it is verified.
 *
 * Collect only what is needed: business details, owner contact, a GSTIN when
 * GST applies, and documents. No identity number is ever asked for as text.
 */

export const DOC_TYPES = ['gst_certificate', 'shop_photo', 'identity_proof', 'business_proof', 'address_proof', 'other'];

export const DOC_LABELS = {
  gst_certificate: 'GST registration certificate',
  shop_photo: 'Photo of the shop front',
  identity_proof: "Owner's identity proof (mask the Aadhaar number if you use Aadhaar)",
  business_proof: 'Business proof (shop licence, Udyam, or registration)',
  address_proof: 'Business address proof',
  other: 'Other supporting document',
};

export const STATUS_LABELS = {
  not_submitted: 'Not submitted',
  pending: 'Under review',
  verified: 'Verified',
  rejected: 'Needs changes',
};

const DETAIL_COLUMNS = `
  store_id, legal_name, business_type, gst_applicable, gstin, owner_name, owner_phone, owner_email,
  business_address, submitted_at, reviewed_at, reviewed_by, rejection_reason, review_note, created_at, updated_at
`;
const DOC_COLUMNS = 'id, store_id, doc_type, mime_type, size_bytes, sha256, is_current, created_at';

const fail = (error, message) => {
  if (error) throw internal(message);
};

/** What must be present before submission. GST paperwork only when GST applies. */
export function missingForSubmission(details, documents) {
  const missing = [];
  if (!details?.legal_name) missing.push('legalName');
  if (!details?.business_type) missing.push('businessType');
  if (!details?.owner_name) missing.push('ownerName');
  if (!details?.owner_phone) missing.push('ownerPhone');
  if (details?.gst_applicable && !details?.gstin) missing.push('gstin');

  const have = new Set(documents.filter((d) => d.is_current).map((d) => d.doc_type));
  const required = ['shop_photo', 'identity_proof', 'address_proof'];
  if (details?.gst_applicable) required.push('gst_certificate');
  for (const type of required) if (!have.has(type)) missing.push(`document:${type}`);
  return missing;
}

const toDocument = (row) => ({
  id: row.id,
  docType: row.doc_type,
  label: DOC_LABELS[row.doc_type],
  mimeType: row.mime_type,
  sizeBytes: row.size_bytes,
  sha256: row.sha256,
  isCurrent: row.is_current,
  uploadedAt: row.created_at,
});

const toEvent = (row) => ({
  fromStatus: row.from_status ?? null,
  toStatus: row.to_status,
  label: STATUS_LABELS[row.to_status],
  actor: row.actor_type,
  reason: row.reason ?? null,
  at: row.created_at,
});

const toDetails = (row) => ({
  legalName: row?.legal_name ?? null,
  businessType: row?.business_type ?? null,
  gstApplicable: row?.gst_applicable ?? false,
  gstin: row?.gstin ?? null,
  ownerName: row?.owner_name ?? null,
  ownerPhone: row?.owner_phone ?? null,
  ownerEmail: row?.owner_email ?? null,
  businessAddress: row?.business_address ?? null,
});

async function loadParts(storeId) {
  const [details, documents, events] = await Promise.all([
    supabaseAdmin.from('store_verifications').select(DETAIL_COLUMNS).eq('store_id', storeId).maybeSingle(),
    supabaseAdmin.from('verification_documents').select(DOC_COLUMNS).eq('store_id', storeId).order('created_at', { ascending: true }),
    supabaseAdmin
      .from('verification_events')
      .select('id, from_status, to_status, actor_type, reason, created_at')
      .eq('store_id', storeId)
      .order('created_at', { ascending: true }),
  ]);
  fail(details.error || documents.error || events.error, 'Could not load the verification.');
  return { details: details.data ?? null, documents: documents.data ?? [], events: events.data ?? [] };
}

async function currentStatus(storeId) {
  const { data, error } = await supabaseAdmin.from('stores').select('verification_status').eq('id', storeId).maybeSingle();
  fail(error, 'Could not load the store.');
  return data?.verification_status ?? 'not_submitted';
}

export async function verificationView(storeId) {
  const [status, parts] = await Promise.all([currentStatus(storeId), loadParts(storeId)]);
  const current = parts.documents.filter((d) => d.is_current);
  return {
    status,
    statusLabel: STATUS_LABELS[status],
    isEditable: status === 'not_submitted' || status === 'rejected',
    details: toDetails(parts.details),
    documents: current.map(toDocument),
    requiredDocuments: ['shop_photo', 'identity_proof', 'address_proof', ...(parts.details?.gst_applicable ? ['gst_certificate'] : [])].map(
      (type) => ({ docType: type, label: DOC_LABELS[type], provided: current.some((d) => d.doc_type === type) }),
    ),
    missing: missingForSubmission(parts.details, parts.documents),
    submittedAt: parts.details?.submitted_at ?? null,
    reviewedAt: parts.details?.reviewed_at ?? null,
    rejectionReason: parts.details?.rejection_reason ?? null,
    reviewNote: parts.details?.review_note ?? null,
    events: parts.events.map(toEvent),
  };
}

function assertEditable(status) {
  if (status === 'pending') throw conflict('The verification is under review and cannot be changed now.');
  if (status === 'verified') throw conflict('This store is verified. Contact support to change verified details.');
}

// ── Merchant ────────────────────────────────────────────────────────────────

export async function saveDetails(store, input) {
  assertEditable(await currentStatus(store.id));
  const row = { store_id: store.id };
  if (input.legalName !== undefined) row.legal_name = input.legalName;
  if (input.businessType !== undefined) row.business_type = input.businessType;
  if (input.gstApplicable !== undefined) row.gst_applicable = input.gstApplicable;
  if (input.gstin !== undefined) row.gstin = input.gstin;
  if (input.ownerName !== undefined) row.owner_name = input.ownerName;
  if (input.ownerPhone !== undefined) row.owner_phone = input.ownerPhone;
  if (input.ownerEmail !== undefined) row.owner_email = input.ownerEmail;
  if (input.businessAddress !== undefined) row.business_address = input.businessAddress;

  const { error } = await supabaseAdmin.from('store_verifications').upsert(row, { onConflict: 'store_id' });
  fail(error, 'Could not save the verification details.');
  return verificationView(store.id);
}

export async function addDocument(store, merchant, docType, file) {
  assertEditable(await currentStatus(store.id));
  const stored = await storeDocument(file, `stores/${store.id}`);

  // One current document per type: the previous one stays, for the record.
  const { error: supersedeError } = await supabaseAdmin
    .from('verification_documents')
    .update({ is_current: false })
    .eq('store_id', store.id)
    .eq('doc_type', docType)
    .eq('is_current', true);
  fail(supersedeError, 'Could not save the document.');

  const { error } = await supabaseAdmin.from('verification_documents').insert({
    store_id: store.id,
    doc_type: docType,
    storage_path: stored.storagePath,
    mime_type: stored.mimeType,
    size_bytes: stored.sizeBytes,
    sha256: stored.sha256,
    uploaded_by: merchant.id,
  });
  if (error) {
    await removeDocument(stored.storagePath);
    throw internal('Could not save the document.');
  }
  return verificationView(store.id);
}

async function findDocument(storeId, documentId) {
  const { data, error } = await supabaseAdmin
    .from('verification_documents')
    .select(`${DOC_COLUMNS}, storage_path`)
    .eq('id', documentId)
    .eq('store_id', storeId)
    .maybeSingle();
  fail(error, 'Could not load the document.');
  if (!data) throw notFound('Document');
  return data;
}

/** Withdraws an uploaded document before submission. Never-submitted files are deleted outright. */
export async function removeDocumentFromStore(store, documentId) {
  assertEditable(await currentStatus(store.id));
  const doc = await findDocument(store.id, documentId);

  const { data: submitted } = await supabaseAdmin
    .from('verification_events')
    .select('id')
    .eq('store_id', store.id)
    .eq('to_status', 'pending')
    .limit(1);

  if ((submitted ?? []).length === 0) {
    const { error } = await supabaseAdmin.from('verification_documents').delete().eq('id', doc.id);
    fail(error, 'Could not remove the document.');
    await removeDocument(doc.storage_path);
  } else {
    // A document a reviewer may already have seen stays on record.
    const { error } = await supabaseAdmin.from('verification_documents').update({ is_current: false }).eq('id', doc.id);
    fail(error, 'Could not remove the document.');
  }
  return verificationView(store.id);
}

export async function documentUrl(storeId, documentId) {
  const doc = await findDocument(storeId, documentId);
  return { document: toDocument(doc), ...(await signedDocumentUrl(doc.storage_path)) };
}

async function setStatus(storeId, toStatus, { actorType, actorId, reason = null, reviewNote = null }) {
  const { error } = await supabaseAdmin.rpc('set_verification_status', {
    payload: { store_id: storeId, to_status: toStatus, actor_type: actorType, actor_id: actorId, reason, review_note: reviewNote },
  });
  if (error) {
    const message = error.message ?? '';
    if (message.includes('ILLEGAL_TRANSITION')) {
      const [, from] = message.split(':');
      throw conflict(`A verification that is ${STATUS_LABELS[from]?.toLowerCase() ?? from} cannot become ${STATUS_LABELS[toStatus].toLowerCase()}.`);
    }
    if (message.includes('REASON_REQUIRED')) throw unprocessable('REASON_REQUIRED', 'Give the merchant a reason (3 characters or more).');
    if (message.includes('STORE_NOT_FOUND')) throw notFound('Store');
    logger.error('set_verification_status failed', { code: error.code, message });
    throw internal('Could not update the verification.');
  }
}

export async function submit(store, merchant) {
  const status = await currentStatus(store.id);
  assertEditable(status);
  const parts = await loadParts(store.id);
  const missing = missingForSubmission(parts.details, parts.documents);
  if (missing.length > 0) {
    throw unprocessable('VERIFICATION_INCOMPLETE', 'Add the missing details and documents before submitting.', { missing });
  }
  await setStatus(store.id, 'pending', { actorType: 'merchant', actorId: merchant.id });
  return verificationView(store.id);
}

// ── Reviewer (platform admin) ───────────────────────────────────────────────

export async function listForReview({ status = ['pending'], page = 1, limit = 20 }) {
  const from = (page - 1) * limit;
  const { data, count, error } = await supabaseAdmin
    .from('stores')
    .select('id, name, slug, city, owner_id, verification_status, is_published, created_at', { count: 'exact' })
    .in('verification_status', status)
    .order('updated_at', { ascending: true })
    .range(from, from + limit - 1);
  fail(error, 'Could not load the review queue.');

  const ids = (data ?? []).map((row) => row.id);
  const submitted = new Map();
  if (ids.length) {
    const { data: rows } = await supabaseAdmin.from('store_verifications').select('store_id, legal_name, submitted_at').in('store_id', ids);
    for (const row of rows ?? []) submitted.set(row.store_id, row);
  }
  return {
    stores: (data ?? []).map((row) => ({
      storeId: row.id,
      name: row.name,
      slug: row.slug,
      city: row.city ?? null,
      legalName: submitted.get(row.id)?.legal_name ?? null,
      status: row.verification_status,
      statusLabel: STATUS_LABELS[row.verification_status],
      isPublished: row.is_published,
      submittedAt: submitted.get(row.id)?.submitted_at ?? null,
    })),
    total: count ?? 0,
  };
}

async function storeFor(storeId) {
  const { data, error } = await supabaseAdmin
    .from('stores')
    .select('id, name, slug, phone, email, address_line1, address_line2, city, state, postal_code, owner_id, is_published')
    .eq('id', storeId)
    .maybeSingle();
  fail(error, 'Could not load the store.');
  if (!data) throw notFound('Store');
  return data;
}

export async function reviewView(storeId) {
  const store = await storeFor(storeId);
  const view = await verificationView(storeId);
  return {
    store: {
      id: store.id,
      name: store.name,
      slug: store.slug,
      phone: store.phone ?? null,
      email: store.email ?? null,
      address: [store.address_line1, store.address_line2, store.city, store.state, store.postal_code].filter(Boolean).join(', '),
      isPublished: store.is_published,
    },
    verification: view,
  };
}

export async function decide(storeId, admin, { decision, reason = null, note = null }) {
  const store = await storeFor(storeId);
  const toStatus = decision === 'approve' ? 'verified' : 'rejected';
  await setStatus(storeId, toStatus, { actorType: 'admin', actorId: admin.id, reason, reviewNote: note });

  await emitToStore(store.id, {
    type: 'verification_update',
    title: toStatus === 'verified' ? `${store.name} is verified` : `${store.name} needs changes before it can be verified`,
    body: toStatus === 'verified' ? 'You can publish your store now.' : reason,
    payload: { store_id: store.id, status: toStatus },
  });
  return reviewView(storeId);
}
