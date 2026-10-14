import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { verificationApi, type DocType, type Verification } from '../../api/ops';
import { errorMessage } from '../../api/client';
import { useActiveStore } from '../../hooks/useStore';
import { useToast } from '../../hooks/useToast';
import { ErrorState, NoStore, PageHeader, Spinner, formatDateTime } from '../../components/common/ui';
import './Tools.css';

/**
 * Store verification (roadmap §4 P1 KYC). A store is published only once
 * verified. Documents go to private storage: this screen shows their names
 * and opens them through a five-minute link — never a public URL.
 */

const STATUS_BADGE: Record<string, string> = {
  not_submitted: 'badge-neutral',
  pending: 'badge-warning',
  verified: 'badge-success',
  rejected: 'badge-danger',
};

const MISSING_LABELS: Record<string, string> = {
  legalName: 'Legal business name',
  businessType: 'Business type',
  ownerName: "Owner's name",
  ownerPhone: "Owner's phone",
  gstin: 'GSTIN',
};

const BUSINESS_TYPES = [
  ['individual', 'Individual'],
  ['proprietorship', 'Sole proprietorship'],
  ['partnership', 'Partnership'],
  ['llp', 'LLP'],
  ['private_limited', 'Private limited'],
  ['public_limited', 'Public limited'],
  ['other', 'Other'],
] as const;

const ALL_DOCS: { type: DocType; label: string }[] = [
  { type: 'shop_photo', label: 'Photo of the shop front' },
  { type: 'identity_proof', label: "Owner's identity proof" },
  { type: 'address_proof', label: 'Business address proof' },
  { type: 'gst_certificate', label: 'GST registration certificate' },
  { type: 'business_proof', label: 'Business proof (shop licence, Udyam…)' },
  { type: 'other', label: 'Other' },
];

export default function VerificationPage() {
  const { activeStoreId } = useActiveStore();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const query = useQuery({
    queryKey: ['verification', activeStoreId],
    queryFn: () => verificationApi.get(activeStoreId!),
    enabled: !!activeStoreId,
  });
  const set = (data: { verification: Verification }) => queryClient.setQueryData(['verification', activeStoreId], data);

  const submit = useMutation({
    mutationFn: () => verificationApi.submit(activeStoreId!),
    onSuccess: (data) => { set(data); showToast('Submitted for review. You will be told the outcome in your inbox.', 'success'); },
    onError: (err) => showToast(errorMessage(err), 'error'),
  });

  if (!activeStoreId) return <NoStore title="Verification" />;
  if (query.isLoading) return <Spinner large />;
  if (query.error || !query.data) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  const v = query.data.verification;

  return (
    <div>
      <PageHeader title="Verification" subtitle="Customers can only see a verified store. Collected for review only — never shown publicly." />

      <div className="card" style={{ marginBottom: 'var(--space-4)' }}>
        <div className="row-between">
          <strong>Status</strong>
          <span className={`badge ${STATUS_BADGE[v.status]}`}>{v.statusLabel}</span>
        </div>
        {v.status === 'rejected' && v.rejectionReason && (
          <div className="alert-strip alert-strip-danger" style={{ marginTop: 'var(--space-3)' }}>What to fix: {v.rejectionReason}</div>
        )}
        {v.status === 'pending' && <p className="muted" style={{ marginTop: 'var(--space-2)' }}>Under review. Details are locked until a decision is made.</p>}
        {v.status === 'verified' && <p className="muted" style={{ marginTop: 'var(--space-2)' }}>Verified. You can publish your store. To change verified details, contact support.</p>}
        {v.isEditable && v.missing.length > 0 && (
          <div className="alert-strip alert-strip-warning" style={{ marginTop: 'var(--space-3)' }}>
            Still needed: {v.missing.map((m) => (m.startsWith('document:') ? v.requiredDocuments.find((d) => `document:${d.docType}` === m)?.label ?? m : MISSING_LABELS[m] ?? m)).join(', ')}.
          </div>
        )}
      </div>

      <DetailsForm storeId={activeStoreId} verification={v} onSaved={set} />
      <Documents storeId={activeStoreId} verification={v} onChanged={set} />

      {v.isEditable && (
        <div style={{ margin: 'var(--space-4) 0' }}>
          <button type="button" className="btn btn-primary" disabled={v.missing.length > 0 || submit.isPending} onClick={() => submit.mutate()}>
            {submit.isPending ? 'Submitting…' : v.status === 'rejected' ? 'Resubmit for review' : 'Submit for review'}
          </button>
        </div>
      )}

      {v.events.length > 0 && (
        <section className="card">
          <h2 style={{ fontSize: 'var(--text-base)', marginBottom: 'var(--space-2)' }}>History</h2>
          <ol style={{ margin: 0, paddingLeft: 'var(--space-5)' }} className="muted">
            {v.events.map((event, index) => (
              <li key={index}>{formatDateTime(event.at)} — {event.label} ({event.actor === 'admin' ? 'reviewer' : event.actor}){event.reason ? `: ${event.reason}` : ''}</li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}

function DetailsForm({ storeId, verification, onSaved }: { storeId: string; verification: Verification; onSaved: (data: { verification: Verification }) => void }) {
  const { showToast } = useToast();
  const d = verification.details;
  const [form, setForm] = useState({
    legalName: d.legalName ?? '',
    businessType: d.businessType ?? '',
    gstApplicable: d.gstApplicable,
    gstin: d.gstin ?? '',
    ownerName: d.ownerName ?? '',
    ownerPhone: d.ownerPhone ?? '',
    ownerEmail: d.ownerEmail ?? '',
  });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    setForm({
      legalName: d.legalName ?? '', businessType: d.businessType ?? '', gstApplicable: d.gstApplicable, gstin: d.gstin ?? '',
      ownerName: d.ownerName ?? '', ownerPhone: d.ownerPhone ?? '', ownerEmail: d.ownerEmail ?? '',
    });
  }, [d.legalName, d.businessType, d.gstApplicable, d.gstin, d.ownerName, d.ownerPhone, d.ownerEmail]);

  const save = useMutation({
    mutationFn: () => verificationApi.save(storeId, {
      legalName: form.legalName.trim() || null,
      businessType: form.businessType || null,
      gstApplicable: form.gstApplicable,
      gstin: form.gstApplicable ? form.gstin.trim().toUpperCase() || null : null,
      ownerName: form.ownerName.trim() || null,
      ownerPhone: form.ownerPhone.trim() || null,
      ownerEmail: form.ownerEmail.trim() || null,
    }),
    onSuccess: (data) => { setFieldErrors({}); onSaved(data); showToast('Details saved', 'success'); },
    onError: (err: any) => { setFieldErrors(err?.fieldErrors ?? {}); showToast(errorMessage(err), 'error'); },
  });
  const disabled = !verification.isEditable;
  const field = (key: keyof typeof form, label: string, props: Record<string, unknown> = {}) => (
    <div className="input-wrapper">
      <label className="input-label" htmlFor={`kyc-${key}`}>{label}</label>
      <input id={`kyc-${key}`} className="input-field" disabled={disabled} value={form[key] as string}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })} aria-invalid={!!fieldErrors[key]} {...props} />
      {fieldErrors[key] && <span className="input-error">{fieldErrors[key]}</span>}
    </div>
  );

  return (
    <form className="card" style={{ marginBottom: 'var(--space-4)' }} onSubmit={(e: FormEvent) => { e.preventDefault(); save.mutate(); }}>
      <h2 style={{ fontSize: 'var(--text-base)', marginBottom: 'var(--space-3)' }}>Business details</h2>
      <div className="form-grid">
        <div className="form-row">
          {field('legalName', 'Legal business name *', { maxLength: 200 })}
          <div className="input-wrapper">
            <label className="input-label" htmlFor="kyc-type">Business type *</label>
            <select id="kyc-type" className="input-field" disabled={disabled} value={form.businessType} onChange={(e) => setForm({ ...form, businessType: e.target.value })}>
              <option value="">Choose…</option>
              {BUSINESS_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
        </div>
        <div className="form-row">
          {field('ownerName', "Owner's name *", { maxLength: 120 })}
          {field('ownerPhone', "Owner's phone *", { inputMode: 'tel', placeholder: '+91…' })}
        </div>
        {field('ownerEmail', "Owner's email", { type: 'email' })}
        <label style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
          <input type="checkbox" disabled={disabled} checked={form.gstApplicable} onChange={(e) => setForm({ ...form, gstApplicable: e.target.checked })} />
          My business is registered for GST
        </label>
        {form.gstApplicable && field('gstin', 'GSTIN *', { maxLength: 15, placeholder: '15 characters', style: { textTransform: 'uppercase' } })}
      </div>
      {!disabled && <button type="submit" className="btn btn-secondary" style={{ marginTop: 'var(--space-3)' }} disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save details'}</button>}
    </form>
  );
}

function Documents({ storeId, verification, onChanged }: { storeId: string; verification: Verification; onChanged: (data: { verification: Verification }) => void }) {
  const { showToast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const required = new Set(verification.requiredDocuments.map((d) => d.docType));

  const upload = async (type: DocType, file: File | undefined) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { showToast('Files can be at most 5 MB.', 'error'); return; }
    setBusy(type);
    try {
      onChanged(await verificationApi.upload(storeId, type, file));
      showToast('Uploaded', 'success');
    } catch (err) {
      showToast(errorMessage(err), 'error');
    } finally {
      setBusy(null);
    }
  };
  const view = async (documentId: string) => {
    try {
      const { url } = await verificationApi.link(storeId, documentId);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      showToast(errorMessage(err), 'error');
    }
  };
  const remove = async (documentId: string) => {
    try { onChanged(await verificationApi.remove(storeId, documentId)); } catch (err) { showToast(errorMessage(err), 'error'); }
  };

  return (
    <section className="card">
      <h2 style={{ fontSize: 'var(--text-base)', marginBottom: 'var(--space-1)' }}>Documents</h2>
      <p className="tiny" style={{ marginBottom: 'var(--space-3)' }}>JPEG, PNG, WebP or PDF, up to 5 MB. If you use an Aadhaar card, mask the first eight digits.</p>
      <div className="stack">
        {ALL_DOCS.map(({ type, label }) => {
          const current = verification.documents.find((doc) => doc.docType === type);
          return (
            <div key={type} className="row-between" style={{ borderBottom: '1px solid var(--color-border-subtle)', paddingBottom: 'var(--space-2)' }}>
              <div>
                <div>{label}{required.has(type) && <span style={{ color: 'var(--color-danger)' }}> *</span>}</div>
                <div className="tiny">{current ? `Uploaded ${formatDateTime(current.uploadedAt)} · ${(current.sizeBytes / 1024).toFixed(0)} KB` : 'Not uploaded'}</div>
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                {current && <button type="button" className="btn btn-ghost btn-sm" onClick={() => view(current.id)}>View</button>}
                {current && verification.isEditable && <button type="button" className="btn btn-ghost btn-sm" onClick={() => remove(current.id)}>Remove</button>}
                {verification.isEditable && (
                  <label className="btn btn-secondary btn-sm" style={{ cursor: 'pointer' }}>
                    {busy === type ? 'Uploading…' : current ? 'Replace' : 'Upload'}
                    <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" hidden disabled={busy !== null}
                      onChange={(e) => { upload(type, e.target.files?.[0]); e.target.value = ''; }} />
                  </label>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
