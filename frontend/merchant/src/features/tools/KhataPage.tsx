import { useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { khataApi, type KhataEntry } from '../../api/ops';
import { storeApi } from '../../api/endpoints';
import { errorMessage } from '../../api/client';
import { useActiveStore } from '../../hooks/useStore';
import { useToast } from '../../hooks/useToast';
import { formatPaise, rupeesToPaise, paiseToRupees } from '../../lib/money';
import { EmptyState, ErrorState, Modal, NoStore, PageHeader, Spinner, SubTabs, formatDate, formatDateTime, newIdempotencyKey } from '../../components/common/ui';
import { IconDollarSign, IconPlus } from '../../components/icons/Icons';
import './Tools.css';

/**
 * The khata (roadmap §4 P2): the store's credit book. Entries are never edited
 * or deleted — a mistake is reversed with a new linked entry — so the balance
 * always has a history that explains it.
 */
export default function KhataPage() {
  const { activeStoreId } = useActiveStore();
  const [status, setStatus] = useState<'all' | 'outstanding' | 'overdue'>('outstanding');
  const [search, setSearch] = useState('');
  const [openAccount, setOpenAccount] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [settings, setSettings] = useState(false);

  const query = useQuery({
    queryKey: ['khata', activeStoreId, status, search],
    queryFn: () => khataApi.list(activeStoreId!, { status, search: search.trim() || undefined }),
    enabled: !!activeStoreId,
  });
  if (!activeStoreId) return <NoStore title="Khata" />;
  const accounts = query.data?.accounts ?? [];
  const summary = query.data?.summary;

  return (
    <div>
      <PageHeader title="Khata" subtitle="Credit you give customers, and what they pay back."
        actions={<>
          <button type="button" className="btn btn-secondary" onClick={() => setSettings(true)}>Settings</button>
          <button type="button" className="btn btn-primary" onClick={() => setOpening(true)}><IconPlus size={16} /> Open a khata</button>
        </>} />
      {summary && (
        <div className="metric-grid">
          <div className="metric-tile"><div className="metric__label">Outstanding</div><div className="metric__value">{formatPaise(summary.outstandingPaise)}</div></div>
          <div className="metric-tile"><div className="metric__label">Overdue</div><div className="metric__value" style={{ color: summary.overduePaise ? 'var(--color-danger)' : undefined }}>{formatPaise(summary.overduePaise)}</div></div>
          <div className="metric-tile"><div className="metric__label">Accounts</div><div className="metric__value">{summary.accountCount}</div></div>
        </div>
      )}
      <SubTabs value={status} options={[{ value: 'outstanding', label: 'Owes money' }, { value: 'overdue', label: 'Overdue' }, { value: 'all', label: 'All' }]} onChange={setStatus} />
      <div className="filters-bar">
        <input className="input-field" style={{ maxWidth: 320 }} placeholder="Search name or phone" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search khata accounts" />
      </div>
      {query.isLoading ? <Spinner large /> : query.error ? <ErrorState error={query.error} onRetry={() => query.refetch()} /> : accounts.length === 0 ? (
        summary && summary.accountCount === 0 && !search.trim() ? (
          <KhataGuide onOpen={() => setOpening(true)} />
        ) : (
          <EmptyState
            icon={<IconDollarSign size={32} />}
            title={search.trim() ? 'No account matches that search' : status === 'overdue' ? 'Nothing is overdue' : status === 'outstanding' ? 'Nobody owes you money right now' : 'No accounts here'}
            description={status === 'all' || search.trim() ? 'Open a khata for a customer to record credit and payments.' : 'Accounts with nothing to pay are under All.'}
            action={status !== 'all' ? <button type="button" className="btn btn-secondary" onClick={() => setStatus('all')}>Show all accounts</button> : undefined}
          />
        )
      ) : (
        <div className="table-container">
          <table className="table">
            <thead><tr><th>Customer</th><th>Outstanding</th><th>Overdue</th><th>Credit limit</th><th>Due</th><th /></tr></thead>
            <tbody>
              {accounts.map((account) => (
                <tr key={account.id}>
                  <td>{account.customer?.name ?? '—'}<div className="tiny">{account.customer?.phone ?? ''}{!account.isActive ? ' · closed' : ''}</div></td>
                  <td style={{ fontWeight: 'var(--font-semibold)' }}>{formatPaise(account.ageing.outstandingPaise)}</td>
                  <td style={{ color: account.ageing.overduePaise ? 'var(--color-danger)' : undefined }}>{formatPaise(account.ageing.overduePaise)}</td>
                  <td>{account.creditLimitPaise === null ? '—' : formatPaise(account.creditLimitPaise)}</td>
                  <td className="muted">{formatDate(account.ageing.earliestDueDate)}</td>
                  <td><button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpenAccount(account.id)}>Open</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {opening && <OpenAccountModal storeId={activeStoreId} onClose={() => setOpening(false)} onOpened={(id) => { setOpening(false); setOpenAccount(id); }} />}
      {openAccount && <AccountModal storeId={activeStoreId} accountId={openAccount} onClose={() => setOpenAccount(null)} />}
      {settings && <SettingsModal storeId={activeStoreId} onClose={() => setSettings(false)} />}
    </div>
  );
}

/** Shown until the first khata is opened: what the khata is and the three steps. */
function KhataGuide({ onOpen }: { onOpen: () => void }) {
  return (
    <section className="card khata-guide" aria-labelledby="khata-guide-title">
      <h2 id="khata-guide-title" className="khata-guide__title">How the khata works</h2>
      <ol className="khata-guide__steps">
        <li><strong>Open a khata</strong> for a customer, using the phone number or email they signed up with. Set a credit limit if they may also order on khata online.</li>
        <li><strong>Record credit given</strong> each time they take goods without paying. Their balance goes up, and they see it in their app.</li>
        <li><strong>Record payments</strong> when they pay you back. Use <em>Clear balance</em> to settle everything they owe in one go.</li>
      </ol>
      <p className="khata-guide__note">Entries are never edited or deleted. A mistake is reversed with a new entry, so every balance has a history that explains it.</p>
      <div><button type="button" className="btn btn-primary" onClick={onOpen}><IconPlus size={16} /> Open a khata</button></div>
    </section>
  );
}

function OpenAccountModal({ storeId, onClose, onOpened }: { storeId: string; onClose: () => void; onOpened: (id: string) => void }) {
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [by, setBy] = useState<'phone' | 'email'>('phone');
  const [value, setValue] = useState('');
  const [limit, setLimit] = useState('');
  const open = useMutation({
    mutationFn: () => khataApi.open(storeId, {
      [by]: value.trim(),
      creditLimitPaise: limit.trim() ? rupeesToPaise(limit) : null,
    }),
    onSuccess: (data) => { queryClient.invalidateQueries({ queryKey: ['khata', storeId] }); showToast('Khata opened', 'success'); onOpened(data.account.id); },
    onError: (err) => showToast(errorMessage(err), 'error'),
  });
  return (
    <Modal title="Open a khata" onClose={onClose} busy={open.isPending}
      footer={<><button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button><button type="submit" form="open-khata" className="btn btn-primary" disabled={open.isPending || !value.trim()}>Open</button></>}>
      <form id="open-khata" className="form-grid" onSubmit={(e) => { e.preventDefault(); open.mutate(); }}>
        <p className="muted" style={{ margin: 0 }}>The customer needs a CPSE account. Find them by the phone or email they signed up with.</p>
        <SubTabs value={by} options={[{ value: 'phone', label: 'Phone' }, { value: 'email', label: 'Email' }]} onChange={(v) => { setBy(v); setValue(''); }} />
        <div className="input-wrapper">
          <label className="input-label" htmlFor="khata-who">{by === 'phone' ? 'Phone number' : 'Email address'}</label>
          <input id="khata-who" className="input-field" type={by === 'email' ? 'email' : 'tel'} value={value} onChange={(e) => setValue(e.target.value)} required />
        </div>
        <div className="input-wrapper">
          <label className="input-label" htmlFor="khata-limit">Credit limit for ordering on khata (₹, optional)</label>
          <input id="khata-limit" className="input-field" inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} placeholder="Leave empty to not allow khata at checkout" />
        </div>
      </form>
    </Modal>
  );
}

function AccountModal({ storeId, accountId, onClose }: { storeId: string; accountId: string; onClose: () => void }) {
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ['khata-account', storeId, accountId], queryFn: () => khataApi.get(storeId, accountId) });
  const [kind, setKind] = useState<'charge' | 'payment' | 'adjustment'>('charge');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [method, setMethod] = useState('cash');
  const [direction, setDirection] = useState<'debit' | 'credit'>('credit');
  const key = useRef(newIdempotencyKey());

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['khata-account', storeId, accountId] });
    queryClient.invalidateQueries({ queryKey: ['khata', storeId] });
  };
  const add = useMutation({
    mutationFn: () => khataApi.entry(storeId, accountId, {
      kind,
      amountPaise: rupeesToPaise(amount),
      description: description.trim() || undefined,
      ...(kind === 'charge' && dueDate ? { dueDate } : {}),
      ...(kind === 'payment' ? { paymentMethod: method } : {}),
      ...(kind === 'adjustment' ? { direction } : {}),
    }, key.current),
    onSuccess: () => {
      key.current = newIdempotencyKey();
      setAmount(''); setDescription(''); setDueDate('');
      refresh();
      showToast('Recorded — the customer can see it.', 'success');
    },
    onError: (err) => showToast(errorMessage(err), 'error'),
  });
  const reverse = useMutation({
    mutationFn: ({ entry, reason }: { entry: KhataEntry; reason: string }) => khataApi.reverse(storeId, accountId, entry.id, reason),
    onSuccess: () => { refresh(); showToast('Reversed with a new entry', 'success'); },
    onError: (err) => showToast(errorMessage(err), 'error'),
  });
  const remind = useMutation({
    mutationFn: () => khataApi.remind(storeId, accountId),
    onSuccess: () => { refresh(); showToast('Reminder sent', 'success'); },
    onError: (err) => showToast(errorMessage(err), 'error'),
  });
  const update = useMutation({
    mutationFn: (body: Record<string, unknown>) => khataApi.update(storeId, accountId, body),
    onSuccess: () => { refresh(); showToast('Saved', 'success'); },
    onError: (err) => showToast(errorMessage(err), 'error'),
  });

  const data = query.data;
  const reversed = new Set((data?.transactions ?? []).map((t) => t.reversesTransactionId).filter(Boolean));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!rupeesToPaise(amount)) { showToast('Enter an amount above zero.', 'error'); return; }
    if (kind === 'adjustment' && !description.trim()) { showToast('An adjustment needs a reason.', 'error'); return; }
    add.mutate();
  };

  return (
    <Modal title={data ? `Khata — ${data.account.customer?.name ?? 'Customer'}` : 'Khata'} onClose={onClose} size="lg">
      {query.isLoading ? <Spinner /> : query.error || !data ? <ErrorState error={query.error} onRetry={() => query.refetch()} /> : (
        <div className="stack">
          <div className="metric-grid">
            <div className="metric-tile">
              <div className="metric__label">They owe you</div>
              <div className="metric__value">{formatPaise(Math.max(data.account.balancePaise, 0))}</div>
              {data.account.balancePaise <= 0 && <span className="badge badge-success" style={{ justifySelf: 'start' }}>Settled</span>}
            </div>
            <div className="metric-tile"><div className="metric__label">Overdue</div><div className="metric__value">{formatPaise(data.account.ageing.overduePaise)}</div></div>
            <div className="metric-tile"><div className="metric__label">Credit left</div><div className="metric__value">{data.account.availableCreditPaise === null ? '—' : formatPaise(data.account.availableCreditPaise)}</div></div>
          </div>
          <div className="row-between">
            <span className="muted">{data.account.customer?.phone ?? ''}</span>
            <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
              {data.account.balancePaise > 0 && (
                <button type="button" className="btn btn-primary btn-sm" onClick={() => {
                  setKind('payment');
                  setAmount(paiseToRupees(data.account.balancePaise));
                  setDescription('Balance cleared');
                  document.getElementById('kh-amt')?.focus();
                }}>Clear balance ({formatPaise(data.account.balancePaise)})</button>
              )}
              <button type="button" className="btn btn-secondary btn-sm" disabled={remind.isPending || data.account.ageing.outstandingPaise <= 0 || !data.account.remindersEnabled} onClick={() => remind.mutate()}>Send reminder</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => {
                const value = window.prompt('Credit limit in ₹ (empty = no khata at checkout)', data.account.creditLimitPaise === null ? '' : paiseToRupees(data.account.creditLimitPaise));
                if (value === null) return;
                update.mutate({ creditLimitPaise: value.trim() ? rupeesToPaise(value) : null });
              }}>Credit limit</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => update.mutate({ isActive: !data.account.isActive })}>{data.account.isActive ? 'Close account' : 'Reopen'}</button>
            </div>
          </div>

          <form onSubmit={submit} className="card card-sm form-grid">
            <SubTabs value={kind} options={[{ value: 'charge', label: 'Credit given' }, { value: 'payment', label: 'Payment received' }, { value: 'adjustment', label: 'Adjustment' }]} onChange={setKind} />
            <div className="form-row">
              <div className="input-wrapper"><label className="input-label" htmlFor="kh-amt">Amount (₹)</label>
                <input id="kh-amt" className="input-field" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required /></div>
              {kind === 'charge' && <div className="input-wrapper"><label className="input-label" htmlFor="kh-due">Due date (default: your usual terms)</label>
                <input id="kh-due" type="date" className="input-field" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></div>}
              {kind === 'payment' && <div className="input-wrapper"><label className="input-label" htmlFor="kh-method">Paid by</label>
                <select id="kh-method" className="input-field" value={method} onChange={(e) => setMethod(e.target.value)}>
                  {['cash', 'upi', 'card', 'bank_transfer', 'other'].map((m) => <option key={m} value={m}>{m.replace('_', ' ')}</option>)}
                </select></div>}
              {kind === 'adjustment' && <div className="input-wrapper"><label className="input-label" htmlFor="kh-dir">Direction</label>
                <select id="kh-dir" className="input-field" value={direction} onChange={(e) => setDirection(e.target.value as 'debit' | 'credit')}>
                  <option value="credit">Reduce what they owe</option><option value="debit">Increase what they owe</option>
                </select></div>}
            </div>
            <div className="input-wrapper"><label className="input-label" htmlFor="kh-desc">{kind === 'adjustment' ? 'Reason *' : 'Note'}</label>
              <input id="kh-desc" className="input-field" maxLength={300} value={description} onChange={(e) => setDescription(e.target.value)} /></div>
            <button type="submit" className="btn btn-primary" disabled={add.isPending}>{add.isPending ? 'Recording…' : 'Record'}</button>
          </form>

          {data.transactions.length === 0 ? <p className="muted">No entries yet.</p> : (
            <div className="table-container">
              <table className="table">
                <thead><tr><th>When</th><th>Entry</th><th>Amount</th><th>Due</th><th /></tr></thead>
                <tbody>
                  {data.transactions.map((t) => (
                    <tr key={t.id}>
                      <td className="muted">{formatDateTime(t.occurredAt)}</td>
                      <td>{t.entryLabel}{t.description ? <div className="tiny">{t.description}</div> : null}</td>
                      <td style={{ color: t.type === 'credit' ? 'var(--color-success)' : undefined }}>{t.type === 'credit' ? '−' : '+'}{formatPaise(t.amountPaise)}</td>
                      <td className="muted">{formatDate(t.dueDate)}</td>
                      <td>
                        {t.entryKind !== 'reversal' && !t.refundId && !reversed.has(t.id) && (
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => {
                            const reason = window.prompt('Why reverse this entry? (shown to the customer)');
                            if (reason && reason.trim().length >= 3) reverse.mutate({ entry: t, reason: reason.trim() });
                          }}>Reverse</button>
                        )}
                        {reversed.has(t.id) && <span className="tiny">Reversed</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {data.reminders.length > 0 && <p className="tiny">Last reminder {formatDateTime(data.reminders[0].sentAt)} for {formatPaise(data.reminders[0].outstandingPaise)}.</p>}
        </div>
      )}
    </Modal>
  );
}

function SettingsModal({ storeId, onClose }: { storeId: string; onClose: () => void }) {
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const current = useQuery({ queryKey: ['store', storeId], queryFn: () => storeApi.get(storeId) });
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [days, setDays] = useState<number | null>(null);
  const [auto, setAuto] = useState<boolean | null>(null);
  const khata = current.data?.store.khata;
  const values = { enabled: enabled ?? khata?.enabled ?? false, days: days ?? khata?.dueDays ?? 30, auto: auto ?? khata?.autoReminders ?? false };
  const save = useMutation({
    mutationFn: async () => {
      await khataApi.settings(storeId, { khataEnabled: values.enabled, khataDueDays: values.days });
      await khataApi.autoReminders(storeId, values.auto);
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['store', storeId] }); showToast('Khata settings saved', 'success'); onClose(); },
    onError: (err) => showToast(errorMessage(err), 'error'),
  });
  return (
    <Modal title="Khata settings" onClose={onClose} busy={save.isPending}
      footer={<><button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button><button type="button" className="btn btn-primary" onClick={() => save.mutate()} disabled={save.isPending}>Save</button></>}>
      {current.isLoading ? <Spinner /> : current.error ? <ErrorState error={current.error} onRetry={() => current.refetch()} /> : (
        <div className="form-grid">
          <label style={{ display: 'flex', gap: 'var(--space-2)' }}><input type="checkbox" checked={values.enabled} onChange={(e) => setEnabled(e.target.checked)} />Customers with a credit limit can choose “khata” at checkout</label>
          <div className="input-wrapper"><label className="input-label" htmlFor="kh-days">Usual payment terms (days)</label>
            <input id="kh-days" type="number" min={0} max={365} className="input-field" value={values.days} onChange={(e) => setDays(Number(e.target.value) || 0)} /></div>
          <label style={{ display: 'flex', gap: 'var(--space-2)' }}><input type="checkbox" checked={values.auto} onChange={(e) => setAuto(e.target.checked)} />Send overdue customers a reminder automatically, once a week</label>
        </div>
      )}
    </Modal>
  );
}
