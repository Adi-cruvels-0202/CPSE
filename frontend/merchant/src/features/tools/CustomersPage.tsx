import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { crmApi, type CrmCustomer, type Segment } from '../../api/ops';
import { errorMessage } from '../../api/client';
import { useActiveStore } from '../../hooks/useStore';
import { useToast } from '../../hooks/useToast';
import { formatPaise } from '../../lib/money';
import { EmptyState, ErrorState, Modal, NoStore, PageHeader, Pagination, Spinner, formatDate, formatDateTime } from '../../components/common/ui';
import { IconSearch, IconUser } from '../../components/icons/Icons';
import './Tools.css';

/**
 * Customer relationships (roadmap §4 P3): who buys, how often, what they owe,
 * their points and what they agreed to hear about. Segments are computed by the
 * server from completed orders, never typed in by hand.
 */

const SEGMENTS: { value: Segment | ''; label: string }[] = [
  { value: '', label: 'Everyone' },
  { value: 'new', label: 'New' },
  { value: 'active', label: 'Active' },
  { value: 'loyal', label: 'Loyal' },
  { value: 'inactive', label: 'Gone quiet' },
  { value: 'prospect', label: 'Saved your shop, not bought' },
];

export default function CustomersPage() {
  const { activeStoreId } = useActiveStore();
  const [segment, setSegment] = useState<Segment | ''>('');
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');
  const [sort, setSort] = useState('last_order');
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    const id = setTimeout(() => { setTerm(search.trim()); setPage(1); }, 300);
    return () => clearTimeout(id);
  }, [search]);

  const query = useQuery({
    queryKey: ['crm', activeStoreId, segment, term, sort, page],
    queryFn: () => crmApi.list(activeStoreId!, { page, limit: 20, sort, ...(segment ? { segment } : {}), ...(term ? { search: term } : {}) }),
    enabled: !!activeStoreId,
  });
  if (!activeStoreId) return <NoStore title="Customers" />;
  const customers = query.data?.data.customers ?? [];
  const counts = query.data?.data.segments;

  return (
    <div>
      <PageHeader title="Customers" subtitle="Everyone who has ordered from you or saved your shop." />
      <div className="filters-bar">
        <div className="input-wrapper" style={{ flex: 1, minWidth: 200 }}>
          <label className="input-label" htmlFor="crm-search">Name or phone</label>
          <div className="input-with-icon">
            <IconSearch size={16} />
            <input id="crm-search" className="input-field" placeholder="Search customers" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
        <div className="input-wrapper">
          <label className="input-label" htmlFor="crm-seg">Group</label>
          <select id="crm-seg" className="input-field" value={segment} onChange={(e) => { setSegment(e.target.value as Segment | ''); setPage(1); }}>
            {SEGMENTS.map((s) => <option key={s.value} value={s.value}>{s.label}{s.value && counts ? ` (${counts[s.value]})` : ''}</option>)}
          </select>
        </div>
        <div className="input-wrapper">
          <label className="input-label" htmlFor="crm-sort">Sort by</label>
          <select id="crm-sort" className="input-field" value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="last_order">Last order</option><option value="total_spend">Total spend</option><option value="orders">Orders</option><option value="name">Name</option>
          </select>
        </div>
      </div>
      {query.isLoading ? <Spinner large /> : query.error ? <ErrorState error={query.error} onRetry={() => query.refetch()} /> : customers.length === 0 ? (
        <EmptyState icon={<IconUser size={32} />} title="No customers here yet" description="Customers appear after their first order or when they save your shop." />
      ) : (
        <>
          <div className="table-container">
            <table className="table">
              <thead><tr><th>Customer</th><th>Group</th><th>Orders</th><th>Spent</th><th>Last order</th><th>Owes</th><th>Points</th></tr></thead>
              <tbody>
                {customers.map((c) => (
                  <tr key={c.customerId} onClick={() => setOpenId(c.customerId)} style={{ cursor: 'pointer' }}>
                    <td><button type="button" className="btn btn-ghost btn-sm" style={{ padding: 0 }} onClick={() => setOpenId(c.customerId)}>{c.name ?? 'Customer'}</button>{c.tags.length > 0 && <div className="tiny">{c.tags.join(', ')}</div>}</td>
                    <td><SegmentBadge customer={c} /></td>
                    <td>{c.orderCount}</td>
                    <td>{formatPaise(c.totalSpendPaise)}</td>
                    <td className="tiny">{c.lastOrderAt ? formatDate(c.lastOrderAt) : '—'}</td>
                    <td>{c.khataBalancePaise ? formatPaise(c.khataBalancePaise) : '—'}</td>
                    <td>{c.loyaltyPoints ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination meta={query.data?.meta} onPage={setPage} />
        </>
      )}
      {openId && <CustomerModal storeId={activeStoreId} customerId={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}

const SEGMENT_BADGE: Record<Segment, string> = { prospect: 'badge-neutral', new: 'badge-info', active: 'badge-success', loyal: 'badge-success', inactive: 'badge-warning' };
function SegmentBadge({ customer }: { customer: CrmCustomer }) {
  return <span className={`badge ${SEGMENT_BADGE[customer.segment]}`}>{customer.segmentLabel}</span>;
}

function CustomerModal({ storeId, customerId, onClose }: { storeId: string; customerId: string; onClose: () => void }) {
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const detail = useQuery({ queryKey: ['crm-customer', storeId, customerId], queryFn: () => crmApi.get(storeId, customerId) });
  const points = useQuery({ queryKey: ['crm-points', storeId, customerId], queryFn: () => crmApi.points(storeId, customerId) });
  const [notes, setNotes] = useState('');
  const [tags, setTags] = useState('');
  const [adjust, setAdjust] = useState('');
  const [reason, setReason] = useState('');
  useEffect(() => {
    if (detail.data) { setNotes(detail.data.customer.notes ?? ''); setTags(detail.data.customer.tags.join(', ')); }
  }, [detail.data]);

  const save = useMutation({
    mutationFn: () => crmApi.saveNotes(storeId, customerId, { notes: notes.trim() || null, tags: tags.split(',').map((t) => t.trim()).filter(Boolean) }),
    onSuccess: (data) => { queryClient.setQueryData(['crm-customer', storeId, customerId], data); queryClient.invalidateQueries({ queryKey: ['crm', storeId] }); showToast('Saved', 'success'); },
    onError: (err) => showToast(errorMessage(err), 'error'),
  });
  const adjustPoints = useMutation({
    mutationFn: () => crmApi.adjustPoints(storeId, customerId, { points: Number(adjust), reason: reason.trim() }),
    onSuccess: () => {
      setAdjust(''); setReason('');
      queryClient.invalidateQueries({ queryKey: ['crm-points', storeId, customerId] });
      queryClient.invalidateQueries({ queryKey: ['crm-customer', storeId, customerId] });
      showToast('Points updated', 'success');
    },
    onError: (err) => showToast(errorMessage(err), 'error'),
  });

  const c = detail.data?.customer;
  return (
    <Modal title={c?.name ?? 'Customer'} onClose={onClose} size="lg">
      {detail.isLoading ? <Spinner /> : detail.error ? <ErrorState error={detail.error} onRetry={() => detail.refetch()} /> : c && (
        <div className="stack">
          <dl className="kv">
            <dt>Group</dt><dd><SegmentBadge customer={c} /></dd>
            <dt>Phone</dt><dd>{c.phone ?? '—'}</dd>
            <dt>Orders</dt><dd>{c.orderCount} · {formatPaise(c.totalSpendPaise)} total · {formatPaise(c.averageOrderPaise)} average</dd>
            <dt>Usually orders</dt><dd>{c.medianDaysBetweenOrders ? `every ${c.medianDaysBetweenOrders} days` : '—'}</dd>
            <dt>Khata</dt><dd>{c.khata ? `${formatPaise(c.khata.balancePaise)} owed${c.khata.creditLimitPaise ? ` · limit ${formatPaise(c.khata.creditLimitPaise)}` : ''}` : 'No account'}</dd>
            <dt>Agreed to hear about</dt><dd>{[c.consent.promotions && 'offers', c.consent.reminders && 'reminders'].filter(Boolean).join(', ') || 'Nothing — do not message them about offers'}</dd>
          </dl>

          {c.favouriteProducts.repeatPurchases.length > 0 && (
            <section><h3 style={{ fontSize: 'var(--text-sm)' }}>Buys again and again</h3>
              <p className="tiny">{c.favouriteProducts.repeatPurchases.map((p) => `${p.name} (${p.orderCount}×)`).join(' · ')}</p></section>
          )}

          <section>
            <h3 style={{ fontSize: 'var(--text-sm)' }}>Recent orders</h3>
            {c.purchaseHistory.length === 0 ? <p className="muted">No orders yet.</p> : (
              <table className="table"><tbody>{c.purchaseHistory.slice(0, 8).map((o) => <tr key={o.id}><td className="mono">{o.orderNumber}</td><td>{o.statusLabel}</td><td>{formatPaise(o.totalPaise)}</td><td className="tiny">{formatDateTime(o.placedAt)}</td></tr>)}</tbody></table>
            )}
          </section>

          <form className="form-grid" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
            <div className="input-wrapper"><label className="input-label" htmlFor="crm-notes">Private notes (only your shop sees these)</label>
              <textarea id="crm-notes" className="input-field" rows={3} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
            <div className="input-wrapper"><label className="input-label" htmlFor="crm-tags">Tags, comma separated</label>
              <input id="crm-tags" className="input-field" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="wholesale, prefers evening" /></div>
            <button type="submit" className="btn btn-secondary" disabled={save.isPending}>Save notes</button>
          </form>

          <section>
            <h3 style={{ fontSize: 'var(--text-sm)' }}>Loyalty points: {c.loyaltyPoints ?? 0}</h3>
            <form className="form-row" onSubmit={(e) => { e.preventDefault(); adjustPoints.mutate(); }}>
              <div className="input-wrapper"><label className="input-label" htmlFor="crm-adj">Add (or remove with −)</label>
                <input id="crm-adj" type="number" className="input-field" required value={adjust} onChange={(e) => setAdjust(e.target.value)} /></div>
              <div className="input-wrapper" style={{ flex: 2 }}><label className="input-label" htmlFor="crm-reason">Reason</label>
                <input id="crm-reason" className="input-field" required minLength={3} maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} /></div>
              <button type="submit" className="btn btn-secondary" style={{ alignSelf: 'flex-end' }} disabled={adjustPoints.isPending || !adjust || Number(adjust) === 0}>Apply</button>
            </form>
            {(points.data?.history ?? []).length > 0 && (
              <ul className="tiny" style={{ marginTop: 'var(--space-2)' }}>
                {points.data!.history.slice(0, 10).map((h) => <li key={h.id}>{formatDate(h.at)} — {h.label}: {h.points > 0 ? '+' : ''}{h.points} (now {h.pointsAfter}){h.note ? ` · ${h.note}` : ''}</li>)}
              </ul>
            )}
          </section>
        </div>
      )}
    </Modal>
  );
}
