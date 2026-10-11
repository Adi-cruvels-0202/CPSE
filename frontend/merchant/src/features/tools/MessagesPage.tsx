import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { messagingApi, type Conversation } from '../../api/ops';
import { errorMessage } from '../../api/client';
import { useActiveStore } from '../../hooks/useStore';
import { useToast } from '../../hooks/useToast';
import { EmptyState, ErrorState, Modal, NoStore, PageHeader, Spinner, SubTabs, formatDateTime } from '../../components/common/ui';
import { IconClipboard } from '../../components/icons/Icons';
import './Tools.css';

/**
 * Customer questions, special requests and order conversations (roadmap §5
 * P5). An order conversation left unanswered for 24 hours is escalated to platform support by the
 * jobs runner, so the "Escalated" tab is the one to watch.
 */

type Filter = 'awaiting_store' | 'awaiting_customer' | 'escalated' | 'resolved' | 'all';
const STATUS_BADGE: Record<Conversation['status'], string> = {
  awaiting_store: 'badge-warning', awaiting_customer: 'badge-info', escalated: 'badge-danger', resolved: 'badge-neutral',
};

export default function MessagesPage() {
  const { activeStoreId } = useActiveStore();
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState<Filter>('awaiting_store');
  const openId = params.get('open');
  const query = useQuery({
    queryKey: ['conversations', activeStoreId, filter],
    queryFn: () => messagingApi.list(activeStoreId!, filter === 'all' ? {} : { status: filter }),
    enabled: !!activeStoreId,
    refetchInterval: 30_000,
  });
  if (!activeStoreId) return <NoStore title="Messages" />;
  const conversations = query.data?.conversations ?? [];
  const open = (id: string | null) => setParams(id ? { open: id } : {});

  return (
    <div>
      <PageHeader title="Messages" subtitle="Questions and requests from customers. Reply here; they are told straight away." />
      <SubTabs value={filter} onChange={setFilter} options={[
        { value: 'awaiting_store', label: 'Needs your reply' }, { value: 'awaiting_customer', label: 'Waiting on customer' },
        { value: 'escalated', label: 'Escalated' }, { value: 'resolved', label: 'Resolved' }, { value: 'all', label: 'All' },
      ]} />
      {query.isLoading ? <Spinner large /> : query.error ? <ErrorState error={query.error} onRetry={() => query.refetch()} /> : conversations.length === 0 ? (
        <EmptyState icon={<IconClipboard size={32} />} title="Nothing here" description="New questions and special requests show up in “Needs your reply”." />
      ) : (
        <ul className="stack" style={{ listStyle: 'none', padding: 0 }}>
          {conversations.map((c) => (
            <li key={c.id}>
              <button type="button" className="card card-sm" style={{ width: '100%', textAlign: 'left', cursor: 'pointer' }} onClick={() => open(c.id)}>
                <div className="row-between">
                  <strong>{c.isUnread ? '● ' : ''}{c.subject}</strong>
                  <span className={`badge ${STATUS_BADGE[c.status]}`}>{c.statusLabel}</span>
                </div>
                <div className="tiny">{c.kindLabel}{c.customer?.name ? ` · ${c.customer.name}` : ''}{c.order?.orderNumber ? ` · order ${c.order.orderNumber}` : ''}{c.product?.name ? ` · ${c.product.name}` : ''} · {formatDateTime(c.lastMessageAt)}</div>
              </button>
            </li>
          ))}
        </ul>
      )}
      {openId && <ThreadModal storeId={activeStoreId} conversationId={openId} onClose={() => open(null)} />}
    </div>
  );
}

function ThreadModal({ storeId, conversationId, onClose }: { storeId: string; conversationId: string; onClose: () => void }) {
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const thread = useQuery({ queryKey: ['conversation', storeId, conversationId], queryFn: () => messagingApi.get(storeId, conversationId) });
  const reply = useMutation({
    mutationFn: (resolve: boolean) => messagingApi.reply(storeId, conversationId, text.trim(), resolve),
    onSuccess: (data) => {
      setText('');
      queryClient.setQueryData(['conversation', storeId, conversationId], data);
      queryClient.invalidateQueries({ queryKey: ['conversations', storeId] });
    },
    onError: (err) => showToast(errorMessage(err), 'error'),
  });
  const submit = (event: FormEvent, resolve = false) => { event.preventDefault(); if (text.trim()) reply.mutate(resolve); };
  const c = thread.data?.conversation;

  return (
    <Modal title={c?.subject ?? 'Conversation'} onClose={onClose} size="lg" busy={reply.isPending}
      footer={c && c.status !== 'resolved' ? (
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>
          <button type="button" className="btn btn-secondary" disabled={!text.trim() || reply.isPending} onClick={(e) => submit(e, true)}>Reply & resolve</button>
          <button type="submit" form="reply-form" className="btn btn-primary" disabled={!text.trim() || reply.isPending}>Send</button>
        </>
      ) : undefined}>
      {thread.isLoading ? <Spinner /> : thread.error ? <ErrorState error={thread.error} onRetry={() => thread.refetch()} /> : c && (
        <>
          <p className="tiny">{c.kindLabel}{c.requestType ? ` · ${c.requestType.replace(/_/g, ' ')}` : ''}{c.customer?.name ? ` · ${c.customer.name}` : ''}{c.order?.orderNumber ? ` · order ${c.order.orderNumber}` : ''} · {c.statusLabel}</p>
          <div className="chat" aria-live="polite">
            {(c.messages ?? []).map((m) => (
              <div key={m.id} className={`chat__msg chat__msg--${m.from === 'merchant' ? 'mine' : m.from === 'customer' ? 'theirs' : 'system'}`}>
                {m.from === 'admin' && <strong>Platform support: </strong>}{m.body}
                <div className="tiny">{formatDateTime(m.at)}</div>
              </div>
            ))}
          </div>
          {c.status !== 'resolved' && (
            <form id="reply-form" onSubmit={(e) => submit(e)} style={{ marginTop: 'var(--space-3)' }}>
              <label className="input-label" htmlFor="reply-text">Your reply</label>
              <textarea id="reply-text" className="input-field" rows={3} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} />
            </form>
          )}
        </>
      )}
    </Modal>
  );
}
