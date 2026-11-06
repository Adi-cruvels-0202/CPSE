import { createContext, useContext, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  adminApi, readAdminSession, writeAdminSession,
  type AdminAccount, type AdminAction, type AdminMe, type AdminStoreRow, type ReviewRow,
} from './adminApi';
import { ApiError, errorMessage } from '../api/client';
import { useToast } from '../hooks/useToast';
import Logo from '../components/brand/Logo';
import { EmptyState, ErrorState, Modal, PageHeader, Pagination, Spinner, SubTabs, formatDateTime } from '../components/common/ui';
import { IconCheck, IconClipboard, IconDashboard, IconHistory, IconLogOut, IconSearch, IconStore, IconUser } from '../components/icons/Icons';
import '../features/auth/Auth.css';
import '../features/tools/Tools.css';
import './Admin.css';

/**
 * The CPSE admin portal, its own app at /admin (migrations 0039, 0045): an
 * overview, store verification, every store and account, escalated support,
 * the admins themselves and the log of what they did. Every call goes to
 * /admin, which checks the admin's role on each request; the console only
 * shows what that role allows, so nothing here is the real gate.
 */

const AdminContext = createContext<AdminMe | null>(null);
const useAdmin = () => useContext(AdminContext)!;

const NAV: { to: string; label: string; icon: ReactNode }[] = [
  { to: '/admin/overview', label: 'Overview', icon: <IconDashboard size={18} /> },
  { to: '/admin/verifications', label: 'Store verification', icon: <IconCheck size={18} /> },
  { to: '/admin/stores', label: 'Stores', icon: <IconStore size={18} /> },
  { to: '/admin/accounts', label: 'Accounts', icon: <IconUser size={18} /> },
  { to: '/admin/support', label: 'Escalated support', icon: <IconClipboard size={18} /> },
  { to: '/admin/log', label: 'Activity log', icon: <IconHistory size={18} /> },
];

export default function AdminApp() {
  const [signedIn, setSignedIn] = useState(() => readAdminSession() !== null);
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: ['admin-me'], queryFn: () => adminApi.me(), enabled: signedIn, retry: false });

  useEffect(() => {
    // A token that is no longer an admin's (or expired past refresh) signs out here only.
    if (me.error instanceof ApiError && (me.error.status === 401 || me.error.status === 403)) {
      writeAdminSession(null);
      setSignedIn(false);
    }
  }, [me.error]);

  const signOut = async () => {
    try { await adminApi.logout(); } catch { /* local sign-out is what matters */ }
    writeAdminSession(null);
    queryClient.removeQueries({ queryKey: ['admin-me'] });
    setSignedIn(false);
  };

  if (!signedIn) return <AdminLogin onSignedIn={() => setSignedIn(true)} />;
  if (me.isLoading) return <div className="admin-loading"><Spinner large /></div>;
  if (me.error || !me.data) return <div className="admin-loading"><ErrorState error={me.error} onRetry={() => me.refetch()} /></div>;
  const admin = me.data.admin;

  return (
    <AdminContext.Provider value={admin}>
      <div className="admin">
        <aside className="admin__side">
          <div className="admin__brand"><Logo size="md" tagline="admin" /></div>
          <nav className="admin__nav" aria-label="Admin">
            {NAV.map((item) => (
              <NavLink key={item.to} to={item.to} className={({ isActive }) => `admin__link${isActive ? ' is-active' : ''}`}>
                {item.icon}<span>{item.label}</span>
              </NavLink>
            ))}
          </nav>
          <div className="admin__me">
            <span className="admin__email" title={admin.email}>{admin.email}</span>
            <button type="button" className="btn btn-ghost btn-sm admin__signout" onClick={signOut}><IconLogOut size={16} /> Sign out</button>
          </div>
        </aside>
        <main className="admin__main" id="main">
          <div className="admin__content">
            <Routes>
              <Route path="overview" element={<OverviewPage />} />
              <Route path="verifications" element={<VerificationQueue />} />
              <Route path="stores" element={<StoresPage />} />
              <Route path="accounts" element={<AccountsPage />} />
              <Route path="support" element={<SupportQueue />} />
              <Route path="log" element={<LogPage />} />
              <Route path="*" element={<Navigate to="/admin/overview" replace />} />
            </Routes>
          </div>
        </main>
      </div>
    </AdminContext.Provider>
  );
}

function AdminLogin({ onSignedIn }: { onSignedIn: () => void }) {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { session } = await adminApi.login(email.trim(), password);
      writeAdminSession(session);
      onSignedIn();
      navigate('/admin/overview', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="auth-page">
      <div className="auth-form-panel" style={{ margin: '0 auto' }}>
        <div className="auth-form-container">
          <div className="auth-mobile-logo" style={{ display: 'block' }}><Logo size="lg" tagline="admin" /></div>
          <div className="auth-form-header">
            <h2 className="auth-form-title">CPSE admin</h2>
            <p className="auth-form-subtitle">Admin sign-in.</p>
          </div>
          <form className="auth-form" onSubmit={submit}>
            {error && <div className="auth-error" role="alert">{error}</div>}
            <div className="input-wrapper">
              <label className="input-label" htmlFor="admin-email">Email</label>
              <input id="admin-email" type="email" className="input-field" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="input-wrapper">
              <label className="input-label" htmlFor="admin-password">Password</label>
              <input id="admin-password" type="password" className="input-field" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <button type="submit" className="btn btn-primary btn-lg auth-submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          </form>
        </div>
      </div>
    </div>
  );
}

// ── Shared ──────────────────────────────────────────────────────────────────

const STATUS_BADGE: Record<string, string> = { pending: 'badge-warning', verified: 'badge-success', rejected: 'badge-danger', not_submitted: 'badge-neutral' };
const ACCOUNT_TYPE: Record<AdminAccount['type'], string> = { customer: 'Customer', merchant: 'Shop owner', admin: 'Admin' };
const ACTION_LABELS: Record<string, string> = {
  store_approved: 'Approved store', store_rejected: 'Sent store back', store_verification_revoked: 'Revoked verification',
  store_unpublished: 'Took store off CPSE', account_suspended: 'Suspended account', account_reinstated: 'Reinstated account',
  admin_added: 'Made admin', admin_removed: 'Removed admin',
};

function actionDetail(a: AdminAction) {
  if (a.action === 'store_approved' && a.details.published) return 'and published it';
  return '';
}

function ActionList({ actions, empty = 'Nothing yet.' }: { actions: AdminAction[]; empty?: string }) {
  if (actions.length === 0) return <p className="muted">{empty}</p>;
  return (
    <ul className="admin-log">
      {actions.map((a) => (
        <li key={a.id}>
          <div><strong>{ACTION_LABELS[a.action] ?? a.action}</strong>{a.target.label ? ` · ${a.target.label}` : ''} {actionDetail(a) && <span className="muted">{actionDetail(a)}</span>}</div>
          {a.reason && <div className="admin-log__reason">“{a.reason}”</div>}
          <div className="tiny">{a.admin.email} · {formatDateTime(a.at)}</div>
        </li>
      ))}
    </ul>
  );
}

/** A reason box and a confirm button, inside the dialog — no browser prompts. */
function ReasonForm({ id, label, placeholder, submitLabel, danger = true, busy, onSubmit }: {
  id: string; label: string; placeholder?: string; submitLabel: string; danger?: boolean; busy: boolean; onSubmit: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  return (
    <form className="admin-reason" onSubmit={(e) => { e.preventDefault(); if (reason.trim().length >= 3) onSubmit(reason.trim()); }}>
      <label className="input-label" htmlFor={id}>{label}</label>
      <textarea id={id} className="input-field" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={placeholder} />
      <div><button type="submit" className={`btn ${danger ? 'btn-danger' : 'btn-primary'} btn-sm`} disabled={busy || reason.trim().length < 3}>{busy ? 'Working…' : submitLabel}</button></div>
    </form>
  );
}

// ── Overview ────────────────────────────────────────────────────────────────

function OverviewPage() {
  const query = useQuery({ queryKey: ['admin-overview'], queryFn: () => adminApi.overview(), refetchInterval: 60_000 });
  const o = query.data?.overview;
  const Tile = ({ label, value, to, tone }: { label: string; value: number; to?: string; tone?: 'warn' }) => {
    const inner = <><div className="metric__label">{label}</div><div className={`metric__value${tone && value > 0 ? ' admin-warn' : ''}`}>{value}</div></>;
    return to ? <NavLink to={to} className="metric-tile admin-tile-link">{inner}</NavLink> : <div className="metric-tile">{inner}</div>;
  };
  return (
    <div>
      <PageHeader title="Overview" subtitle="What needs your attention, and the platform at a glance." />
      {query.isLoading ? <Spinner large /> : query.error || !o ? <ErrorState error={query.error} onRetry={() => query.refetch()} /> : (
        <div className="stack">
          <section>
            <h2 className="admin-section-title">Needs attention</h2>
            <div className="metric-grid">
              <Tile label="Stores waiting for review" value={o.stores.waitingForReview} to="/admin/verifications" tone="warn" />
              <Tile label="Owners who pressed Publish" value={o.stores.waitingToPublish} to="/admin/verifications" />
              <Tile label="Escalated conversations" value={o.support.escalated} to="/admin/support" tone="warn" />
            </div>
          </section>
          <section>
            <h2 className="admin-section-title">Platform</h2>
            <div className="metric-grid">
              <Tile label="Stores" value={o.stores.total} to="/admin/stores" />
              <Tile label="Live stores" value={o.stores.published} to="/admin/stores" />
              <Tile label="Shop owners" value={o.accounts.merchants} to="/admin/accounts" />
              <Tile label="Customers" value={o.accounts.customers} to="/admin/accounts" />
              <Tile label="Suspended accounts" value={o.accounts.suspended} to="/admin/accounts" />
            </div>
          </section>
          <section>
            <h2 className="admin-section-title">Recent admin actions</h2>
            <ActionList actions={o.recentActions} empty="No admin actions yet." />
          </section>
        </div>
      )}
    </div>
  );
}

// ── Verification ────────────────────────────────────────────────────────────

function VerificationQueue() {
  const [status, setStatus] = useState('pending');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<{ storeId: string; name: string } | null>(null);
  const query = useQuery({ queryKey: ['admin-queue', status, page], queryFn: () => adminApi.queue({ status, page }) });
  const rows = query.data?.data.stores ?? [];
  return (
    <div>
      <PageHeader title="Store verification" subtitle="Check each shop's details and documents. A shop goes live only once verified — and goes live at once on approval if its owner already pressed Publish." />
      <SubTabs value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={[
        { value: 'pending', label: 'Waiting for review' }, { value: 'rejected', label: 'Sent back' }, { value: 'verified', label: 'Verified' }, { value: 'not_submitted', label: 'Not submitted' },
      ]} />
      {query.isLoading ? <Spinner large /> : query.error ? <ErrorState error={query.error} onRetry={() => query.refetch()} /> : rows.length === 0 ? (
        <EmptyState icon={<IconCheck size={32} />} title="Nothing here" description={status === 'pending' ? 'Shops appear here when their owner sends them for verification.' : 'No shops in this state.'} />
      ) : (
        <div className="table-container">
          <table className="table">
            <thead><tr><th>Shop</th><th>Legal name</th><th>City</th><th>Submitted</th><th>Status</th><th /></tr></thead>
            <tbody>{rows.map((r: ReviewRow) => (
              <tr key={r.storeId}>
                <td>{r.name}<div className="tiny mono">{r.slug}</div></td>
                <td>{r.legalName ?? '—'}</td>
                <td>{r.city ?? '—'}</td>
                <td className="tiny">{r.submittedAt ? formatDateTime(r.submittedAt) : '—'}</td>
                <td><span className={`badge ${STATUS_BADGE[r.status]}`}>{r.statusLabel}</span></td>
                <td><button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpen({ storeId: r.storeId, name: r.name })}>Review</button></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <Pagination meta={query.data?.meta} onPage={setPage} />
      {open && <ReviewModal storeId={open.storeId} name={open.name} onClose={() => setOpen(null)} />}
    </div>
  );
}

function ReviewModal({ storeId, name, onClose }: { storeId: string; name: string; onClose: () => void }) {
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ['admin-review', storeId], queryFn: () => adminApi.review(storeId) });
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const refresh = () => {
    for (const key of ['admin-queue', 'admin-stores', 'admin-store', 'admin-overview']) queryClient.invalidateQueries({ queryKey: [key] });
  };
  const decide = useMutation({
    mutationFn: (decision: 'approve' | 'reject') => (decision === 'approve' ? adminApi.approve(storeId, note.trim() || undefined) : adminApi.reject(storeId, reason.trim(), note.trim() || undefined)),
    onSuccess: (data) => {
      queryClient.setQueryData(['admin-review', storeId], data);
      refresh();
      showToast(
        data.verification.status === 'verified'
          ? data.published ? `${name} is verified and now live. The owner has been told.` : `${name} is verified. The owner has been told.`
          : `${name} was sent back with your reason.`,
        'success',
      );
      onClose();
    },
    onError: (err) => showToast(errorMessage(err), 'error'),
  });
  const revoke = useMutation({
    mutationFn: (why: string) => adminApi.reject(storeId, why),
    onSuccess: (data) => { queryClient.setQueryData(['admin-review', storeId], data); refresh(); showToast(`${name} is no longer verified and was taken off CPSE.`, 'success'); },
    onError: (err) => showToast(errorMessage(err), 'error'),
  });
  const openDocument = async (documentId: string) => {
    try {
      const { url } = await adminApi.documentUrl(storeId, documentId);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      showToast(errorMessage(err), 'error');
    }
  };
  const v = query.data?.verification;
  const canDecide = v?.status === 'pending';
  return (
    <Modal title={`Review ${name}`} size="lg" onClose={onClose} busy={decide.isPending || revoke.isPending}
      footer={canDecide ? (
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>
          <button type="button" className="btn btn-danger" disabled={decide.isPending || reason.trim().length < 3} onClick={() => decide.mutate('reject')}>Send back</button>
          <button type="button" className="btn btn-primary" disabled={decide.isPending || (v?.missing.length ?? 0) > 0} onClick={() => decide.mutate('approve')}>
            {query.data?.store.publishRequestedAt ? 'Approve and publish' : 'Approve'}
          </button>
        </>
      ) : undefined}>
      {query.isLoading ? <Spinner /> : query.error ? <ErrorState error={query.error} onRetry={() => query.refetch()} /> : v && query.data && (
        <div className="stack">
          {canDecide && query.data.store.publishRequestedAt && (
            <div className="alert-strip alert-strip-info">The owner already pressed Publish ({formatDateTime(query.data.store.publishRequestedAt)}). Approving puts the store live straight away.</div>
          )}
          <dl className="kv">
            <dt>Status</dt><dd><span className={`badge ${STATUS_BADGE[v.status]}`}>{v.statusLabel}</span></dd>
            <dt>Shop</dt><dd>{query.data.store.name} · {query.data.store.address || 'no address'}</dd>
            <dt>Contact</dt><dd>{[query.data.store.phone, query.data.store.email].filter(Boolean).join(' · ') || '—'}</dd>
            <dt>Legal name</dt><dd>{v.details.legalName ?? '—'}</dd>
            <dt>Business type</dt><dd>{v.details.businessType ?? '—'}</dd>
            <dt>Owner</dt><dd>{[v.details.ownerName, v.details.ownerPhone, v.details.ownerEmail].filter(Boolean).join(' · ') || '—'}</dd>
            <dt>GST</dt><dd>{v.details.gstApplicable ? v.details.gstin ?? 'GSTIN missing' : 'Not registered'}</dd>
          </dl>
          {v.missing.length > 0 && <div className="alert-strip alert-strip-warning">Incomplete: {v.missing.join(', ')}. It cannot be approved yet.</div>}
          <section>
            <h3 className="admin-section-title">Documents</h3>
            {v.documents.length === 0 ? <p className="muted">None uploaded.</p> : (
              <ul className="stack" style={{ listStyle: 'none', padding: 0 }}>
                {v.documents.map((d) => (
                  <li key={d.id} className="row-between">
                    <span>{d.label} <span className="tiny">({d.mimeType}, {Math.round(d.sizeBytes / 1024)} KB)</span></span>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDocument(d.id)}>Open</button>
                  </li>
                ))}
              </ul>
            )}
            <p className="tiny">Links are private and expire after a few minutes.</p>
          </section>
          {canDecide && (
            <div className="form-grid">
              <div className="input-wrapper"><label className="input-label" htmlFor="rv-reason">Reason, if sending back (the owner sees this)</label>
                <textarea id="rv-reason" className="input-field" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. The shop photo does not show the sign board." /></div>
              <div className="input-wrapper"><label className="input-label" htmlFor="rv-note">Internal note (optional)</label>
                <input id="rv-note" className="input-field" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></div>
            </div>
          )}
          {v.status === 'verified' && (
            <ReasonForm id="rv-revoke" label="Revoke verification — the store is taken off CPSE until it is verified again (the owner sees this)" placeholder="e.g. The licence shown has expired."
              submitLabel="Revoke verification" busy={revoke.isPending} onSubmit={(why) => revoke.mutate(why)} />
          )}
          {v.events.length > 0 && (
            <section>
              <h3 className="admin-section-title">History</h3>
              <ol className="tiny">{v.events.map((e, i) => <li key={i}>{formatDateTime(e.at)} — {e.label} ({e.actor}){e.reason ? `: ${e.reason}` : ''}</li>)}</ol>
            </section>
          )}
        </div>
      )}
    </Modal>
  );
}

// ── Stores ──────────────────────────────────────────────────────────────────

function SearchBox({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div className="input-wrapper" style={{ flex: 1, minWidth: 220 }}>
      <label className="input-label" htmlFor={id}>{label}</label>
      <div className="input-with-icon"><IconSearch size={16} /><input id={id} className="input-field" value={value} onChange={(e) => onChange(e.target.value)} /></div>
    </div>
  );
}

function StoresPage() {
  const [search, setSearch] = useState('');
  const [verification, setVerification] = useState('');
  const [published, setPublished] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ['admin-stores', search.trim(), verification, published, page],
    queryFn: () => adminApi.stores({ search: search.trim() || undefined, verification: verification || undefined, published: published || undefined, page }),
  });
  const rows = query.data?.data.stores ?? [];
  return (
    <div>
      <PageHeader title="Stores" subtitle="Every store on CPSE, live or not." />
      <div className="filters-bar">
        <SearchBox id="st-search" label="Name, link or city" value={search} onChange={(v) => { setSearch(v); setPage(1); }} />
        <div className="input-wrapper">
          <label className="input-label" htmlFor="st-ver">Verification</label>
          <select id="st-ver" className="input-field" value={verification} onChange={(e) => { setVerification(e.target.value); setPage(1); }}>
            <option value="">Any</option><option value="pending">Waiting for review</option><option value="verified">Verified</option><option value="rejected">Sent back</option><option value="not_submitted">Not submitted</option>
          </select>
        </div>
        <div className="input-wrapper">
          <label className="input-label" htmlFor="st-pub">Live</label>
          <select id="st-pub" className="input-field" value={published} onChange={(e) => { setPublished(e.target.value); setPage(1); }}>
            <option value="">Any</option><option value="yes">Live</option><option value="no">Not live</option>
          </select>
        </div>
      </div>
      {query.isLoading ? <Spinner large /> : query.error ? <ErrorState error={query.error} onRetry={() => query.refetch()} /> : rows.length === 0 ? (
        <EmptyState icon={<IconStore size={32} />} title="No stores match" />
      ) : (
        <div className="table-container table-scroll">
          <table className="table">
            <thead><tr><th>Store</th><th>Owner</th><th>City</th><th>Verification</th><th>Live</th><th /></tr></thead>
            <tbody>{rows.map((r: AdminStoreRow) => (
              <tr key={r.id}>
                <td>{r.name}<div className="tiny mono">{r.slug}</div></td>
                <td>{r.owner?.email ?? '—'}{r.owner?.isSuspended && <div><span className="badge badge-danger">Suspended</span></div>}</td>
                <td>{r.city ?? '—'}</td>
                <td><span className={`badge ${STATUS_BADGE[r.verificationStatus]}`}>{r.verificationLabel}</span>{r.publishRequestedAt && !r.isPublished && <div className="tiny">Goes live on approval</div>}</td>
                <td>{r.isPublished ? <span className="badge badge-success">Live</span> : <span className="badge badge-neutral">Not live</span>}</td>
                <td><button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpen(r.id)}>Open</button></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <Pagination meta={query.data?.meta} onPage={setPage} />
      {open && <StoreModal storeId={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

const MISSING_LABELS: Record<string, string> = { address: 'address', phone: 'phone', openingHours: 'opening hours', fulfilment: 'pickup or delivery', verification: 'verification' };

function StoreModal({ storeId, onClose }: { storeId: string; onClose: () => void }) {
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [reviewing, setReviewing] = useState(false);
  const [account, setAccount] = useState<string | null>(null);
  const query = useQuery({ queryKey: ['admin-store', storeId], queryFn: () => adminApi.store(storeId) });
  const unpublish = useMutation({
    mutationFn: (reason: string) => adminApi.unpublishStore(storeId, reason),
    onSuccess: (data) => {
      queryClient.setQueryData(['admin-store', storeId], data);
      for (const key of ['admin-stores', 'admin-overview', 'admin-log']) queryClient.invalidateQueries({ queryKey: [key] });
      showToast(`${data.store.name} was taken off CPSE. The owner has been told why.`, 'success');
    },
    onError: (err) => showToast(errorMessage(err), 'error'),
  });
  const d = query.data;
  return (
    <Modal title={d ? d.store.name : 'Store'} size="lg" onClose={onClose} busy={unpublish.isPending}>
      {query.isLoading ? <Spinner /> : query.error || !d ? <ErrorState error={query.error} onRetry={() => query.refetch()} /> : (
        <div className="stack">
          <dl className="kv">
            <dt>Link</dt><dd className="mono">/store/{d.store.slug}</dd>
            <dt>Live</dt><dd>{d.store.isPublished ? <span className="badge badge-success">Live</span> : <span className="badge badge-neutral">Not live</span>}</dd>
            <dt>Verification</dt><dd><span className={`badge ${STATUS_BADGE[d.store.verificationStatus]}`}>{d.store.verificationLabel}</span></dd>
            <dt>Owner</dt><dd>{d.store.owner ? <button type="button" className="btn-link" onClick={() => setAccount(d.store.owner!.id)}>{d.store.owner.email}</button> : '—'}{d.store.owner?.isSuspended && <> <span className="badge badge-danger">Suspended</span></>}</dd>
            <dt>Contact</dt><dd>{[d.store.phone, d.store.email].filter(Boolean).join(' · ') || '—'}</dd>
            <dt>Address</dt><dd>{d.store.address || '—'}</dd>
            <dt>Products</dt><dd>{d.counts.products}</dd>
            <dt>Orders</dt><dd>{d.counts.orders} ({d.counts.ordersLast30Days} in the last 30 days)</dd>
            {!d.store.isPublished && <><dt>Before it can go live</dt><dd>{d.store.missingForPublish.length ? d.store.missingForPublish.map((m) => MISSING_LABELS[m] ?? m).join(', ') : 'Nothing — the owner can publish'}</dd></>}
          </dl>
          <div><button type="button" className="btn btn-secondary btn-sm" onClick={() => setReviewing(true)}>Open verification</button></div>
          {d.store.isPublished && (
            <ReasonForm id="st-down" label="Take this store off CPSE — customers stop seeing it; open orders carry on; the owner sees your reason" placeholder="e.g. Selling items that are not allowed."
              submitLabel="Take off CPSE" busy={unpublish.isPending} onSubmit={(reason) => unpublish.mutate(reason)} />
          )}
          <section>
            <h3 className="admin-section-title">Admin actions on this store</h3>
            <ActionList actions={d.actions} />
          </section>
        </div>
      )}
      {reviewing && d && <ReviewModal storeId={storeId} name={d.store.name} onClose={() => { setReviewing(false); query.refetch(); }} />}
      {account && <AccountModal accountId={account} onClose={() => setAccount(null)} />}
    </Modal>
  );
}

// ── Accounts ────────────────────────────────────────────────────────────────

function AccountsPage() {
  const [kind, setKind] = useState<'all' | 'customer' | 'merchant'>('all');
  const [status, setStatus] = useState('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ['admin-accounts', kind, status, search.trim(), page],
    queryFn: () => adminApi.accounts({ kind, status, search: search.trim() || undefined, page }),
  });
  const rows = query.data?.data.accounts ?? [];
  return (
    <div>
      <PageHeader title="Accounts" subtitle="Customers and shop owners. Suspending an account stops it signing in anywhere." />
      <SubTabs value={kind} onChange={(v) => { setKind(v); setPage(1); }} options={[{ value: 'all', label: 'Everyone' }, { value: 'customer', label: 'Customers' }, { value: 'merchant', label: 'Shop owners' }]} />
      <div className="filters-bar">
        <SearchBox id="ac-search" label="Email, name or phone" value={search} onChange={(v) => { setSearch(v); setPage(1); }} />
        <div className="input-wrapper">
          <label className="input-label" htmlFor="ac-status">Status</label>
          <select id="ac-status" className="input-field" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="all">Any</option><option value="active">Active</option><option value="suspended">Suspended</option>
          </select>
        </div>
      </div>
      {query.isLoading ? <Spinner large /> : query.error ? <ErrorState error={query.error} onRetry={() => query.refetch()} /> : rows.length === 0 ? (
        <EmptyState icon={<IconUser size={32} />} title="No accounts match" />
      ) : (
        <div className="table-container table-scroll">
          <table className="table">
            <thead><tr><th>Account</th><th>Type</th><th>Stores</th><th>Orders</th><th>Joined</th><th>Status</th><th /></tr></thead>
            <tbody>{rows.map((a) => (
              <tr key={a.id}>
                <td>{a.name ?? '—'}<div className="tiny">{a.email}{a.phone ? ` · ${a.phone}` : ''}</div></td>
                <td>{ACCOUNT_TYPE[a.type]}</td>
                <td>{a.storeCount}</td>
                <td>{a.orderCount}</td>
                <td className="tiny">{formatDateTime(a.createdAt)}</td>
                <td>{a.isSuspended ? <span className="badge badge-danger">Suspended</span> : <span className="badge badge-success">Active</span>}</td>
                <td><button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpen(a.id)}>Open</button></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <Pagination meta={query.data?.meta} onPage={setPage} />
      {open && <AccountModal accountId={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function AccountModal({ accountId, onClose }: { accountId: string; onClose: () => void }) {
  const me = useAdmin();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ['admin-account', accountId], queryFn: () => adminApi.account(accountId) });
  const change = useMutation({
    mutationFn: ({ suspend, reason }: { suspend: boolean; reason: string }) => (suspend ? adminApi.suspend(accountId, reason) : adminApi.reinstate(accountId, reason)),
    onSuccess: (data) => {
      queryClient.setQueryData(['admin-account', accountId], data);
      for (const key of ['admin-accounts', 'admin-overview', 'admin-log', 'admin-stores']) queryClient.invalidateQueries({ queryKey: [key] });
      showToast(data.account.isSuspended ? `${data.account.email} is suspended and signed out everywhere.` : `${data.account.email} can sign in again.`, 'success');
    },
    onError: (err) => showToast(errorMessage(err), 'error'),
  });
  const d = query.data;
  return (
    <Modal title={d ? d.account.name ?? d.account.email : 'Account'} size="lg" onClose={onClose} busy={change.isPending}>
      {query.isLoading ? <Spinner /> : query.error || !d ? <ErrorState error={query.error} onRetry={() => query.refetch()} /> : (
        <div className="stack">
          {d.account.isSuspended && <div className="alert-strip alert-strip-warning">Suspended {d.account.suspendedAt ? formatDateTime(d.account.suspendedAt) : ''}: {d.account.suspendedReason}</div>}
          <dl className="kv">
            <dt>Email</dt><dd>{d.account.email}</dd>
            <dt>Phone</dt><dd>{d.account.phone ?? '—'}</dd>
            <dt>Type</dt><dd>{ACCOUNT_TYPE[d.account.type]}</dd>
            <dt>Joined</dt><dd>{formatDateTime(d.account.createdAt)}</dd>
            <dt>Orders placed</dt><dd>{d.account.orderCount}</dd>
          </dl>
          {d.stores.length > 0 && (
            <section>
              <h3 className="admin-section-title">Stores</h3>
              <ul className="admin-plain-list">{d.stores.map((s) => (
                <li key={s.id}>{s.name} <span className={`badge ${STATUS_BADGE[s.verificationStatus]}`}>{s.verificationLabel}</span> {s.isPublished ? <span className="badge badge-success">Live</span> : null}</li>
              ))}</ul>
            </section>
          )}
          {d.account.type !== 'admin' && d.account.id !== me.id && (
            d.account.isSuspended
              ? <ReasonForm id="ac-reinstate" label="Reinstate — why is this account allowed back?" submitLabel="Reinstate account" danger={false} busy={change.isPending} onSubmit={(reason) => change.mutate({ suspend: false, reason })} />
              : <ReasonForm id="ac-suspend" label={`Suspend — the account is signed out and cannot sign in${d.account.type === 'merchant' ? '; its stores stay as they are (take them off separately if needed)' : ''}. The person sees your reason.`}
                  placeholder="e.g. Repeated fake orders." submitLabel="Suspend account" busy={change.isPending} onSubmit={(reason) => change.mutate({ suspend: true, reason })} />
          )}
          {d.account.type === 'admin' && <p className="tiny">Admin accounts cannot be suspended.</p>}
          <section>
            <h3 className="admin-section-title">Admin actions on this account</h3>
            <ActionList actions={d.actions} />
          </section>
        </div>
      )}
    </Modal>
  );
}

// ── Activity log ────────────────────────────────────────────────────────────

function LogPage() {
  const [targetType, setTargetType] = useState<'' | 'store' | 'account' | 'admin'>('');
  const [page, setPage] = useState(1);
  const query = useQuery({ queryKey: ['admin-log', targetType, page], queryFn: () => adminApi.log({ targetType: targetType || undefined, page }) });
  return (
    <div>
      <PageHeader title="Activity log" subtitle="Every admin decision, who made it and why. Entries cannot be edited or deleted." />
      <SubTabs value={targetType} onChange={(v) => { setTargetType(v); setPage(1); }} options={[{ value: '', label: 'Everything' }, { value: 'store', label: 'Stores' }, { value: 'account', label: 'Accounts' }, { value: 'admin', label: 'Admin changes' }]} />
      {query.isLoading ? <Spinner large /> : query.error ? <ErrorState error={query.error} onRetry={() => query.refetch()} /> : (
        <ActionList actions={query.data?.data.actions ?? []} empty="No admin actions yet." />
      )}
      <Pagination meta={query.data?.meta} onPage={setPage} />
    </div>
  );
}

// ── Escalated support ───────────────────────────────────────────────────────

function SupportQueue() {
  const [openId, setOpenId] = useState<string | null>(null);
  const query = useQuery({ queryKey: ['admin-support'], queryFn: () => adminApi.escalated(), refetchInterval: 60_000 });
  const rows = query.data?.conversations ?? [];
  return (
    <div>
      <PageHeader title="Escalated support" subtitle="Conversations a shop did not answer in time, or a customer asked us to step in." />
      {query.isLoading ? <Spinner large /> : query.error ? <ErrorState error={query.error} onRetry={() => query.refetch()} /> : rows.length === 0 ? (
        <EmptyState icon={<IconClipboard size={32} />} title="No escalations" description="Nothing needs platform support right now." />
      ) : (
        <ul className="stack" style={{ listStyle: 'none', padding: 0 }}>
          {rows.map((c) => (
            <li key={c.id}>
              <button type="button" className="card card-sm" style={{ width: '100%', textAlign: 'left', cursor: 'pointer' }} onClick={() => setOpenId(c.id)}>
                <div className="row-between"><strong>{c.subject}</strong><span className="badge badge-danger">{c.statusLabel}</span></div>
                <div className="tiny">{c.kindLabel}{c.store?.name ? ` · ${c.store.name}` : ''}{c.order?.orderNumber ? ` · order ${c.order.orderNumber}` : ''} · {formatDateTime(c.lastMessageAt)}</div>
              </button>
            </li>
          ))}
        </ul>
      )}
      {openId && <SupportThread id={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function SupportThread({ id, onClose }: { id: string; onClose: () => void }) {
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const thread = useQuery({ queryKey: ['admin-thread', id], queryFn: () => adminApi.conversation(id) });
  const reply = useMutation({
    mutationFn: (resolve: boolean) => adminApi.reply(id, text.trim(), resolve),
    onSuccess: (data) => {
      setText('');
      queryClient.setQueryData(['admin-thread', id], data);
      queryClient.invalidateQueries({ queryKey: ['admin-support'] });
      showToast(data.conversation.status === 'resolved' ? 'Replied and resolved.' : 'Reply sent to the customer and the shop.', 'success');
    },
    onError: (err) => showToast(errorMessage(err), 'error'),
  });
  const c = thread.data?.conversation;
  return (
    <Modal title={c?.subject ?? 'Conversation'} size="lg" onClose={onClose} busy={reply.isPending}
      footer={c && c.status !== 'resolved' ? (
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>
          <button type="button" className="btn btn-secondary" disabled={!text.trim() || reply.isPending} onClick={() => reply.mutate(true)}>Reply & resolve</button>
          <button type="button" className="btn btn-primary" disabled={!text.trim() || reply.isPending} onClick={() => reply.mutate(false)}>Send</button>
        </>
      ) : undefined}>
      {thread.isLoading ? <Spinner /> : thread.error ? <ErrorState error={thread.error} onRetry={() => thread.refetch()} /> : c && (
        <>
          <p className="tiny">{c.kindLabel}{c.store?.name ? ` · ${c.store.name}` : ''}{c.customer?.name ? ` · ${c.customer.name}` : ''} · {c.statusLabel}</p>
          <div className="chat">
            {(c.messages ?? []).map((m) => (
              <div key={m.id} className={`chat__msg chat__msg--${m.from === 'admin' ? 'mine' : m.from === 'system' ? 'system' : 'theirs'}`}>
                <strong>{m.from === 'customer' ? 'Customer' : m.from === 'merchant' ? 'Shop' : m.from === 'admin' ? 'Support' : ''}{m.from !== 'system' ? ': ' : ''}</strong>{m.body}
                <div className="tiny">{formatDateTime(m.at)}</div>
              </div>
            ))}
          </div>
          {c.status !== 'resolved' && (
            <div style={{ marginTop: 'var(--space-3)' }}>
              <label className="input-label" htmlFor="admin-reply">Reply as platform support</label>
              <textarea id="admin-reply" className="input-field" rows={3} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} />
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
