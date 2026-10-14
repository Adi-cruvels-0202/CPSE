import { useState } from 'react';
import { endpoints } from '../../lib/endpoints.js';
import { useSubmit } from '../../hooks/useSubmit.js';
import { formatPaise } from '../../lib/money.js';
import { formatWhen } from '../../lib/orderStatus.js';
import { FormError } from '../../components/FormError.jsx';

/**
 * What happens to the customer's money and items after the order changes —
 * roadmap §5 P5 (refund tracking, transparent substitutions). The server says
 * what each state means; these only show it and offer the actions it allows.
 */

const REFUND_TONE = { initiated: 'warning', processing: 'info', refunded: 'success', failed: 'danger' };

/** One refund: amount, where it goes, its status history and reference. */
export function RefundCard({ refund }) {
  const partial = refund.kind === 'adjustment';
  return (
    <div className={`notice notice--${REFUND_TONE[refund.status] ?? 'info'} stack`} data-testid="refund">
      <div className="spread">
        <strong>
          {partial ? 'Partial refund' : 'Refund'} of {formatPaise(refund.amountPaise)}
        </strong>
        <span className="badge">{refund.statusLabel}</span>
      </div>
      <span>{refund.methodLabel}</span>
      {refund.reason ? <span className="muted">Why: {refund.reason}</span> : null}
      {refund.reference ? <span className="muted">Reference: <span className="numeric">{refund.reference}</span></span> : null}
      {refund.failureReason ? <span>{refund.failureReason}</span> : null}
      {refund.nextStep ? <span>{refund.nextStep}</span> : null}
      {refund.events?.length ? (
        <ol className="refund__events" aria-label="Refund progress">
          {refund.events.map((event, index) => (
            <li key={index}>
              <span>{event.label}</span> <span className="muted">· {formatWhen(event.at)}</span>
              {event.note ? <span className="muted"> — {event.note}</span> : null}
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

export function RefundSection({ order }) {
  const adjustments = order.refundAdjustments ?? [];
  if (!order.refund && adjustments.length === 0) return null;
  return (
    <section className="card stack" aria-labelledby="refund-heading">
      <h2 id="refund-heading" className="order__section-title">Your money back</h2>
      {order.refund ? <RefundCard refund={order.refund} /> : null}
      {adjustments.map((refund) => (
        <RefundCard key={refund.id} refund={refund} />
      ))}
    </section>
  );
}

const SUB_STATUS = {
  pending: 'Waiting for you',
  approved: 'Accepted',
  rejected: 'Declined',
  withdrawn: 'Withdrawn by the shop',
};

/** The shop's suggested replacements — accept or decline each one. */
export function SubstitutionSection({ order, onChanged }) {
  const substitutions = order.substitutions ?? [];
  const replaced = order.replacedItems ?? [];
  if (substitutions.length === 0) return null;
  return (
    <section className="card stack" aria-labelledby="subs-heading">
      <h2 id="subs-heading" className="order__section-title">Replacements</h2>
      {substitutions.map((sub) => (
        <Substitution key={sub.id} sub={sub} onChanged={onChanged} />
      ))}
      {replaced.length ? (
        <p className="muted">
          Replaced on your bill: {replaced.map((item) => `${item.name}${item.variantName ? ` · ${item.variantName}` : ''}`).join(', ')}.
        </p>
      ) : null}
    </section>
  );
}

function Substitution({ sub, onChanged }) {
  const [note, setNote] = useState('');
  const respond = useSubmit(
    async (approve) => {
      await endpoints.substitutions.respond(sub.id, { approve, ...(note.trim() ? { note: note.trim() } : {}) });
      await onChanged?.();
    },
  );
  const original = sub.original;
  const cheaper = sub.savingPaise > 0;
  return (
    <div className="stack sub" data-testid="substitution">
      <div className="spread">
        <span>
          {original ? `${original.name}${original.variantName ? ` · ${original.variantName}` : ''}` : 'An item'} →{' '}
          <strong>
            {sub.proposed.name}
            {sub.proposed.variantName ? ` · ${sub.proposed.variantName}` : ''}
          </strong>{' '}
          × {sub.proposed.quantity}
        </span>
        <span className="badge">{SUB_STATUS[sub.status] ?? sub.status}</span>
      </div>
      <span className="muted">
        {formatPaise(sub.proposed.linePaise)} instead of {formatPaise(sub.originalLinePaise)}
        {cheaper ? ` — you pay ${formatPaise(sub.savingPaise)} less` : ''}
        {sub.autoApproved ? ' · applied because you allow similar items' : ''}
      </span>
      {sub.merchantNote ? <span>The shop says: “{sub.merchantNote}”</span> : null}
      {sub.status === 'pending' ? (
        <>
          <label className="field">
            <span className="field__label">Note to the shop <span className="field__optional">(optional)</span></span>
            <input className="field__input" maxLength={300} value={note} onChange={(event) => setNote(event.target.value)} />
          </label>
          <FormError error={respond.error} />
          <div className="row">
            <button type="button" className="btn btn--sm" disabled={respond.pending} onClick={() => respond.submit(true)}>
              Accept
            </button>
            <button type="button" className="btn btn--secondary btn--sm" disabled={respond.pending} onClick={() => respond.submit(false)}>
              Decline
            </button>
          </div>
          <span className="muted">If you decline, the item is left out and you are not charged for it.</span>
        </>
      ) : null}
    </div>
  );
}

const SUBSTITUTION_PREFERENCE = {
  contact_me: 'Ask me before replacing anything',
  allow_similar: 'Replace with a similar item if needed',
  no_substitutions: 'No replacements — leave it out',
};

export function substitutionPreferenceLabel(value) {
  return SUBSTITUTION_PREFERENCE[value] ?? null;
}

export { SUBSTITUTION_PREFERENCE };
