import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { inboxApi, type MerchantNotification } from '../../api/ops';
import { errorMessage } from '../../api/client';
import { useActiveStore } from '../../hooks/useStore';
import { useToast } from '../../hooks/useToast';
import { EmptyState, ErrorState, NoStore, PageHeader, Pagination, Spinner, SubTabs, formatDateTime } from '../../components/common/ui';
import { IconCheck } from '../../components/icons/Icons';
import OrderDetailModal from '../orders/OrderDetailModal';
import './Tools.css';

/** The store's inbox (roadmap Phase C notifications): new orders, refunds, stock and expiry alerts, messages. */
function targetOf(note: MerchantNotification): { kind: 'order'; id: string } | { kind: 'path'; to: string } | null {
  const p = note.payload ?? {};
  if (p.order_id) return { kind: 'order', id: p.order_id };
  if (p.conversation_id) return { kind: 'path', to: `/messages?open=${p.conversation_id}` };
  if (p.batch_id) return { kind: 'path', to: '/batches' };
  if (note.type === 'low_stock') return { kind: 'path', to: '/suggestions' };
  if (p.offer_id) return { kind: 'path', to: '/promotions' };
  if (note.type === 'verification_update') return { kind: 'path', to: '/verification' };
  return null;
}

export default function InboxPage() {
  const { activeStoreId } = useActiveStore();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<'unread' | 'all'>('unread');
  const [page, setPage] = useState(1);
  const [orderId, setOrderId] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['inbox', activeStoreId, filter, page],
    queryFn: () => inboxApi.list(activeStoreId!, { unreadOnly: filter === 'unread' ? 'true' : undefined, page }),
    enabled: !!activeStoreId,
  });
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['inbox', activeStoreId] });
    queryClient.invalidateQueries({ queryKey: ['inbox-count', activeStoreId] });
  };
  const readAll = useMutation({
    mutationFn: () => inboxApi.readAll(activeStoreId!),
    onSuccess: ({ updated }) => { showToast(`${updated} marked read`, 'info'); refresh(); },
    onError: (err) => showToast(errorMessage(err), 'error'),
  });

  if (!activeStoreId) return <NoStore title="Inbox" />;
  const notes = query.data?.data.notifications ?? [];

  const open = async (note: MerchantNotification) => {
    if (!note.isRead) {
      try { await inboxApi.read(activeStoreId, note.id); refresh(); } catch { /* opening still works */ }
    }
    const target = targetOf(note);
    if (target?.kind === 'order') setOrderId(target.id);
    else if (target?.kind === 'path') navigate(target.to);
  };

  return (
    <div>
      <PageHeader
        title="Inbox"
        subtitle={`${query.data?.data.unreadCount ?? 0} unread`}
        actions={<button type="button" className="btn btn-secondary" onClick={() => readAll.mutate()} disabled={readAll.isPending}><IconCheck size={16} /> Mark all read</button>}
      />
      <SubTabs value={filter} options={[{ value: 'unread', label: 'Unread' }, { value: 'all', label: 'All' }]} onChange={(v) => { setFilter(v); setPage(1); }} />
      {query.isLoading ? <Spinner large /> : query.error ? <ErrorState error={query.error} onRetry={() => query.refetch()} /> : notes.length === 0 ? (
        <EmptyState icon={<IconCheck size={32} />} title={filter === 'unread' ? 'All caught up' : 'Nothing yet'} description="New orders, refunds, stock and expiry alerts arrive here." />
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }} className="stack">
          {notes.map((note) => (
            <li key={note.id}>
              <button type="button" className="card card-sm" onClick={() => open(note)}
                style={{ width: '100%', textAlign: 'left', cursor: 'pointer', borderLeft: note.isRead ? undefined : '3px solid var(--green-600)' }}>
                <div className="row-between">
                  <strong>{note.title}</strong>
                  <span className="tiny">{formatDateTime(note.createdAt)}</span>
                </div>
                {note.body && <div className="muted">{note.body}</div>}
              </button>
            </li>
          ))}
        </ul>
      )}
      <Pagination meta={query.data?.meta} onPage={setPage} />
      {orderId && <OrderDetailModal storeId={activeStoreId} orderId={orderId} onClose={() => setOrderId(null)} />}
    </div>
  );
}
