import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { endpoints } from '../../lib/endpoints.js';
import { useApiQuery } from '../../hooks/useApiQuery.js';
import { useSubmit } from '../../hooks/useSubmit.js';
import { formatWhen } from '../../lib/orderStatus.js';
import { EmptyState, ErrorState, LoadingBlock, Skeleton } from '../../components/states/States.jsx';
import { FormError } from '../../components/FormError.jsx';
import { Field } from '../../components/Field.jsx';
import './Engage.css';

/**
 * Talking to a shop (roadmap §5 P5): questions about a product, special
 * requests, messages about an order, and asking platform support to step in
 * when a shop does not answer. Every message is kept; nothing is edited.
 */
const KIND_LABEL = {
  question: 'Question',
  special_request: 'Special request',
  order: 'About an order',
  support: 'Support',
};

export function MessagesPage() {
  const query = useApiQuery(() => endpoints.conversations.list(), []);
  const conversations = query.data?.conversations ?? [];
  if (query.loading) return <LoadingBlock label="Loading messages"><Skeleton height="8rem" radius="var(--radius-md)" /></LoadingBlock>;
  if (query.error) return <ErrorState error={query.error} onRetry={query.refetch} />;
  return (
    <div className="stack">
      <header>
        <h1>Messages</h1>
        <p className="muted">Ask a shop from its page, or about an order from the order.</p>
      </header>
      {conversations.length === 0 ? (
        <EmptyState title="No messages yet" body="Questions and requests you send to shops show up here." />
      ) : (
        <ul className="prows">
          {conversations.map((c) => (
            <li key={c.id} className="prow" style={{ gridTemplateColumns: '1fr auto' }}>
              <span className="prow__body">
                <Link to={`/messages/${c.id}`} className="prow__name">{c.isUnread ? '● ' : ''}{c.subject}</Link>
                <span className="muted">
                  {c.kindLabel ?? KIND_LABEL[c.kind]}{c.store?.name ? ` · ${c.store.name}` : ''}{c.order?.orderNumber ? ` · ${c.order.orderNumber}` : ''} · {formatWhen(c.lastMessageAt)}
                </span>
              </span>
              <span className="badge">{c.statusLabel}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const REQUEST_TYPES = [
  ['custom_item', 'Something not on the shelf'],
  ['packaging', 'Packing or cutting'],
  ['delivery_time', 'A delivery time'],
  ['bulk_order', 'A large order'],
  ['other', 'Something else'],
];

/** `/messages/new?storeId=…&productId=…` or `?orderId=…`. */
export function NewMessagePage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const orderId = params.get('orderId');
  const storeId = params.get('storeId');
  const productId = params.get('productId');
  const storeName = params.get('storeName');
  const [kind, setKind] = useState(orderId ? 'order' : productId ? 'question' : 'question');
  const [requestType, setRequestType] = useState('custom_item');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const start = useSubmit(
    async () => {
      const { data } = await endpoints.conversations.start({
        kind,
        ...(orderId ? { orderId } : {}),
        ...(storeId ? { storeId } : {}),
        ...(productId ? { productId } : {}),
        ...(kind === 'special_request' ? { requestType } : {}),
        subject: subject.trim(),
        message: message.trim(),
      });
      return data.conversation;
    },
    { onSuccess: (conversation) => navigate(`/messages/${conversation.id}`, { replace: true }) },
  );
  if (!orderId && !storeId) {
    return <EmptyState title="Which shop?" body="Start a message from a shop's page or from one of your orders." actionTo="/" actionLabel="Find a shop" />;
  }
  const kinds = orderId ? [['order', 'About this order'], ['support', 'I need help — ask CPSE support']] : [['question', 'A question'], ['special_request', 'A special request']];

  return (
    <form
      className="stack"
      onSubmit={(event) => {
        event.preventDefault();
        start.submit();
      }}
    >
      <header>
        <h1>Message {storeName ?? 'the shop'}</h1>
        <p className="muted">
          The shop is told straight away.
          {orderId ? ' If it has not replied about your order within a day, CPSE support steps in.' : ''}
        </p>
      </header>
      <div className="choices" role="radiogroup" aria-label="What is it">
        {kinds.map(([value, label]) => (
          <label key={value} className={`choice${kind === value ? ' choice--selected' : ''}`}>
            <input type="radio" name="kind" value={value} checked={kind === value} onChange={() => setKind(value)} />
            <span className="choice__body"><span className="choice__label">{label}</span></span>
          </label>
        ))}
      </div>
      {kind === 'special_request' ? (
        <Field label="Kind of request" required>
          <select className="field__input" aria-label="Kind of request" value={requestType} onChange={(event) => setRequestType(event.target.value)}>
            {REQUEST_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </Field>
      ) : null}
      <Field label="Subject" value={subject} onChange={setSubject} required error={start.fieldErrors.subject} placeholder="Do you have 5 kg rice bags?" />
      <Field label="Message" required error={start.fieldErrors.message}>
        <textarea className="field__input" aria-label="Message" rows={4} maxLength={2000} value={message} onChange={(event) => setMessage(event.target.value)} />
      </Field>
      <FormError error={start.error} />
      <button type="submit" className="btn" disabled={start.pending || !subject.trim() || !message.trim()}>
        {start.pending ? 'Sending…' : 'Send'}
      </button>
    </form>
  );
}

export function ConversationPage() {
  const { conversationId } = useParams();
  const query = useApiQuery(() => endpoints.conversations.get(conversationId), [conversationId]);
  const [text, setText] = useState('');
  const [escalating, setEscalating] = useState(false);
  const [reason, setReason] = useState('');
  const set = (data) => query.setData({ conversation: data.conversation });
  const reply = useSubmit(async () => {
    const { data } = await endpoints.conversations.reply(conversationId, text.trim());
    set(data);
    setText('');
  });
  const escalate = useSubmit(async () => {
    const { data } = await endpoints.conversations.escalate(conversationId, reason.trim());
    set(data);
    setEscalating(false);
  });
  const resolve = useSubmit(async () => set((await endpoints.conversations.resolve(conversationId)).data));
  const c = query.data?.conversation;
  if (query.loading) return <LoadingBlock label="Loading the conversation"><Skeleton height="12rem" radius="var(--radius-md)" /></LoadingBlock>;
  if (query.error || !c) return <ErrorState error={query.error ?? { message: 'Could not load the conversation.' }} onRetry={query.refetch} />;
  const open = c.status !== 'resolved';

  return (
    <div className="stack">
      <header>
        <h1>{c.subject}</h1>
        <p className="muted">
          {c.kindLabel ?? KIND_LABEL[c.kind]}{c.store?.name ? ` · ${c.store.name}` : ''}{c.order?.orderNumber ? ` · ` : ''}
          {c.order ? <Link to={`/orders/${c.order.id}`}>{c.order.orderNumber}</Link> : null} · <span className="badge">{c.statusLabel}</span>
        </p>
      </header>
      <div className="chat" aria-live="polite">
        {(c.messages ?? []).map((m) => (
          <div key={m.id} className={`chat__msg chat__msg--${m.from === 'customer' ? 'mine' : m.from === 'system' ? 'system' : 'theirs'}`}>
            {m.from === 'merchant' ? <strong>{c.store?.name ?? 'Shop'}: </strong> : m.from === 'admin' ? <strong>CPSE support: </strong> : null}
            {m.body}
            <div className="muted" style={{ fontSize: '0.75rem' }}>{formatWhen(m.at)}</div>
          </div>
        ))}
      </div>
      <FormError error={reply.error ?? escalate.error ?? resolve.error} />
      {open ? (
        <>
          <form
            className="inline-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (text.trim()) reply.submit();
            }}
          >
            <input className="field__input" aria-label="Your reply" placeholder="Write a reply" maxLength={2000} value={text} onChange={(event) => setText(event.target.value)} />
            <button type="submit" className="btn btn--sm" disabled={reply.pending || !text.trim()}>Send</button>
          </form>
          <div className="row">
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => resolve.submit()} disabled={resolve.pending}>My question is answered</button>
            {c.status !== 'escalated' && (c.kind === 'order' || c.kind === 'support') ? (
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setEscalating(true)}>Ask CPSE support</button>
            ) : null}
          </div>
          {escalating ? (
            <form
              className="card stack"
              onSubmit={(event) => {
                event.preventDefault();
                escalate.submit();
              }}
            >
              <Field label="What went wrong?" value={reason} onChange={setReason} required error={escalate.fieldErrors.reason} />
              <button type="submit" className="btn btn--sm" disabled={escalate.pending || reason.trim().length < 3}>Ask support to step in</button>
            </form>
          ) : null}
        </>
      ) : (
        <p className="muted">This conversation is closed. Start a new one from the shop or the order.</p>
      )}
      <Link to="/messages" className="btn btn--ghost btn--sm">All messages</Link>
    </div>
  );
}
