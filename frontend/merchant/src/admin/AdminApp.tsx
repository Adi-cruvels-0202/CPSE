import { useEffect, useState, type FormEvent } from 'react';
import { NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { adminApi, readAdminSession, writeAdminSession, type ReviewRow } from './adminApi';
import { ApiError, errorMessage } from '../api/client';
import { useToast } from '../hooks/useToast';
import Logo from '../components/brand/Logo';
import { EmptyState, ErrorState, Modal, PageHeader, Pagination, Spinner, SubTabs, formatDateTime } from '../components/common/ui';
import { IconCheck, IconClipboard, IconLogOut } from '../components/icons/Icons';
import '../features/auth/Auth.css';
import '../features/tools/Tools.css';

/**
 * The platform reviewers' console, at /merchant/admin: store verification
 * decisions (roadmap §4 P1) and escalated customer support (§5 P5). Every
 * call goes to /admin, which refuses anyone without a platform_admins row.
 */
export default function AdminApp() {
  const [signedIn, setSignedIn] = useState(() => readAdminSession() !== null);
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: ['admin-me'], queryFn: () => adminApi.me(), enabled: signedIn, retry: false });

  useEffect(() => {
    // A token that is no longer a reviewer's (or expired past refresh) signs out here only.
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
  if (me.isLoading) return <Spinner large />;
  if (me.error) return <ErrorState error={me.error} onRetry={() => me.refetch()} />;

  return (
    <div className="shell">
      <header className="shell__header">
        <div className="shell__bar">
          <span className="shell__brand"><Logo size="md" /> <strong style={{ marginLeft: 8 }}>Review</strong></span>
          <div className="shell__actions">
            <span className="tiny">{me.data?.admin.email}</span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={signOut}><IconLogOut size={16} /> Sign out</button>
          </div>
        </div>
      </header>
      <main className="shell__main" id="main">
        <div className="shell__content">
          <nav className="tabs" aria-label="Review" style={{ marginBottom: 'var(--space-4)' }}>
            <NavLink to="/admin/verifications" className={({ isActive }) => `tab${isActive ? ' tab-active' : ''}`}>Store verification</NavLink>
            <NavLink to="/admin/support" className={({ isActive }) => `tab${isActive ? ' tab-active' : ''}`}>Escalated support</NavLink>
          </nav>
          <Routes>
            <Route path="verifications" element={<VerificationQueue />} />
            <Route path="support" element={<SupportQueue />} />
            <Route path="*" element={<Navigate to="/admin/verifications" replace />} />
          </Routes>
        </div>
      </main>
    </div>
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
      navigate('/admin/verifications', { replace: true });
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
          <div className="auth-mobile-logo" style={{ display: 'block' }}><Logo size="lg" /></div>
          <div className="auth-form-header">
            <h2 className="auth-form-title">Platform review</h2>
            <p className="auth-form-subtitle">For CPSE reviewers only. Shop owners sign in at <a className="auth-link" href="/merchant/login">/merchant</a>.</p>
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

// ── Verification ────────────────────────────────────────────────────────────

const STATUS_BADGE: Record<string, string> = { pending: 'badge-warning', verified: 'badge-success', rejected: 'badge-danger', not_submitted: 'badge-neutral' };

function VerificationQueue() {
  const [status, setStatus] = useState('pending');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<ReviewRow | null>(null);
  const query = useQuery({ queryKey: ['admin-queue', status, page], queryFn: () => adminApi.queue({ status, page }) });
  const rows = query.data?.data.stores ?? [];
  return (
    <div>
      <PageHeader title="Store verification" subtitle="Check each shop's details and documents. A shop can publish only once verified." />
      <SubTabs value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={[
        { value: 'pending', label: 'Waiting for review' }, { value: 'rejected', label: 'Sent back' }, { value: 'verified', label: 'Verified' }, { value: 'not_submitted', label: 'Not submitted' },
      ]} />
      {query.isLoading ? <Spinner large /> : query.error ? <ErrorState error={query.error} onRetry={() => query.refetch()} /> : rows.length === 0 ? (
        <EmptyState icon={<IconCheck size={32} />} title="Nothing to review" description="Shops appear here when they submit their details." />
      ) : (
        <div className="table-container">
          <table className="table">
            <thead><tr><th>Shop</th><th>Legal name</th><th>City</th><th>Submitted</th><th>Status</th><th /></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.storeId}>
                <td>{r.name}<div className="tiny mono">{r.slug}</div></td>
                <td>{r.legalName ?? '—'}</td>
                <td>{r.city ?? '—'}</td>
                <td className="tiny">{r.submittedAt ? formatDateTime(r.submittedAt) : '—'}</td>
                <td><span className={`badge ${STATUS_BADGE[r.status]}`}>{r.statusLabel}</span></td>
                <td><button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpen(r)}>Review</button></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <Pagination meta={query.data?.meta} onPage={setPage} />
      {open && <ReviewModal row={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function ReviewModal({ row, onClose }: { row: ReviewRow; onClose: () => void }) {
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ['admin-review', row.storeId], queryFn: () => adminApi.review(row.storeId) });
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const decide = useMutation({
    mutationFn: (decision: 'approve' | 'reject') => (decision === 'approve' ? adminApi.approve(row.storeId, note.trim() || undefined) : adminApi.reject(row.storeId, reason.trim(), note.trim() || undefined)),
    onSuccess: (data) => {
      queryClient.setQueryData(['admin-review', row.storeId], data);
      queryClient.invalidateQueries({ queryKey: ['admin-queue'] });
      showToast(data.verification.status === 'verified' ? `${row.name} is verified. The owner has been told.` : `${row.name} was sent back with your reason.`, 'success');
      onClose();
    },
    onError: (err) => showToast(errorMessage(err), 'error'),
  });
  const openDocument = async (documentId: string) => {
    try {
      const { url } = await adminApi.documentUrl(row.storeId, documentId);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      showToast(errorMessage(err), 'error');
    }
  };
  const v = query.data?.verification;
  const canDecide = v?.status === 'pending';
  return (
    <Modal title={`Review ${row.name}`} size="lg" onClose={onClose} busy={decide.isPending}
      footer={canDecide ? (
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>
          <button type="button" className="btn btn-danger" disabled={decide.isPending || reason.trim().length < 3} onClick={() => decide.mutate('reject')}>Send back</button>
          <button type="button" className="btn btn-primary" disabled={decide.isPending || (v?.missing.length ?? 0) > 0} onClick={() => decide.mutate('approve')}>Approve</button>
        </>
      ) : undefined}>
      {query.isLoading ? <Spinner /> : query.error ? <ErrorState error={query.error} onRetry={() => query.refetch()} /> : v && query.data && (
        <div className="stack">
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
            <h3 style={{ fontSize: 'var(--text-sm)' }}>Documents</h3>
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
          {v.events.length > 0 && (
            <section>
              <h3 style={{ fontSize: 'var(--text-sm)' }}>History</h3>
              <ol className="tiny">{v.events.map((e, i) => <li key={i}>{formatDateTime(e.at)} — {e.label} ({e.actor}){e.reason ? `: ${e.reason}` : ''}</li>)}</ol>
            </section>
          )}
        </div>
      )}
    </Modal>
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
