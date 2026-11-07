import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { productApi } from '../../api/endpoints';
import { errorMessage } from '../../api/client';
import type { LineItem } from '../../api/types';
import { intelligenceApi, refundApi, substitutionApi, type Refund, type Substitution } from '../../api/ops';
import { useToast } from '../../hooks/useToast';
import { formatPaise } from '../../lib/money';
import { Modal, Spinner, formatDateTime } from '../../components/common/ui';

/**
 * Refunds and substitutions on one order (roadmap §4 P2 refund settlement,
 * §5 P5 transparent substitutions). The server decides what each state means;
 * this only shows it and offers the actions it allows.
 */

const REFUND_BADGE: Record<string, string> = {
  initiated: 'badge-warning',
  processing: 'badge-info',
  refunded: 'badge-success',
  failed: 'badge-danger',
};

function RefundCard({ storeId, refund, onChanged }: { storeId: string; refund: Refund; onChanged: () => void }) {
  const { showToast } = useToast();
  const retry = useMutation({
    mutationFn: () => refundApi.retry(storeId, refund.id),
    onSuccess: ({ refund: updated }) => {
      showToast(`Refund sent again — now ${updated.statusLabel.toLowerCase()}.`, 'success');
      onChanged();
    },
    onError: (err) => showToast(errorMessage(err), 'error'),
  });
  const confirmCash = useMutation({
    mutationFn: () => refundApi.confirmCash(storeId, refund.id),
    onSuccess: () => {
      showToast('Recorded: cash returned to the customer.', 'success');
      onChanged();
    },
    onError: (err) => showToast(errorMessage(err), 'error'),
  });

  return (
    <div className="card card-sm" style={{ marginTop: 'var(--space-3)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-3)', flexWrap: 'wrap', alignItems: 'center' }}>
        <div>
          <strong>{refund.kind === 'adjustment' ? 'Partial refund' : 'Refund'} of {formatPaise(refund.amountPaise)}</strong>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>{refund.methodLabel}{refund.reference ? ` · ref ${refund.reference}` : ''}</div>
        </div>
        <span className={`badge ${REFUND_BADGE[refund.status] ?? 'badge-neutral'}`}>{refund.statusLabel}</span>
      </div>
      {refund.failureReason && <div className="alert-strip alert-strip-danger" style={{ marginTop: 'var(--space-2)' }}>{refund.failureReason}</div>}
      <ol style={{ margin: 'var(--space-2) 0 0', paddingLeft: 'var(--space-5)', fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>
        {refund.events.map((event, index) => (
          <li key={index}>{formatDateTime(event.at)} — {event.label}{event.note ? `: ${event.note}` : ''}</li>
        ))}
      </ol>
      {(refund.status === 'failed' && refund.method === 'provider') && (
        <button type="button" className="btn btn-primary btn-sm" style={{ marginTop: 'var(--space-2)' }} onClick={() => retry.mutate()} disabled={retry.isPending}>
          {retry.isPending ? 'Sending…' : 'Retry refund'}
        </button>
      )}
      {(refund.method === 'cash' && refund.status !== 'refunded') && (
        <button type="button" className="btn btn-primary btn-sm" style={{ marginTop: 'var(--space-2)' }} onClick={() => confirmCash.mutate()} disabled={confirmCash.isPending}>
          I returned the cash
        </button>
      )}
    </div>
  );
}

export function RefundPanel({ storeId, refund, adjustments, onChanged }: { storeId: string; refund: Refund | null; adjustments: Refund[]; onChanged: () => void }) {
  if (!refund && adjustments.length === 0) return null;
  return (
    <section style={{ marginTop: 'var(--space-4)' }} aria-label="Refunds">
      <h3 style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--font-semibold)' }}>Money back to the customer</h3>
      {refund && <RefundCard storeId={storeId} refund={refund} onChanged={onChanged} />}
      {adjustments.map((adjustment) => <RefundCard key={adjustment.id} storeId={storeId} refund={adjustment} onChanged={onChanged} />)}
    </section>
  );
}

const SUB_STATUS: Record<string, { label: string; badge: string }> = {
  pending: { label: 'Waiting for the customer', badge: 'badge-warning' },
  approved: { label: 'Approved', badge: 'badge-success' },
  rejected: { label: 'Declined', badge: 'badge-danger' },
  withdrawn: { label: 'Withdrawn', badge: 'badge-neutral' },
};

export function SubstitutionsPanel({ storeId, substitutions, onChanged }: { storeId: string; substitutions: Substitution[]; onChanged: () => void }) {
  const { showToast } = useToast();
  const withdraw = useMutation({
    mutationFn: (id: string) => substitutionApi.withdraw(storeId, id),
    onSuccess: () => { showToast('Suggestion withdrawn.', 'info'); onChanged(); },
    onError: (err) => showToast(errorMessage(err), 'error'),
  });
  if (substitutions.length === 0) return null;
  return (
    <section style={{ marginTop: 'var(--space-4)' }} aria-label="Substitutions">
      <h3 style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--font-semibold)' }}>Substitutions</h3>
      {substitutions.map((sub) => (
        <div key={sub.id} className="card card-sm" style={{ marginTop: 'var(--space-2)', display: 'flex', justifyContent: 'space-between', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          <div style={{ fontSize: 'var(--text-sm)' }}>
            {sub.original?.name ?? 'Item'} → <strong>{sub.proposed.name}{sub.proposed.variantName ? ` (${sub.proposed.variantName})` : ''}</strong> × {sub.proposed.quantity}
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>
              Customer pays {formatPaise(sub.proposed.linePaise)} instead of {formatPaise(sub.originalLinePaise)}
              {sub.autoApproved ? ' · applied automatically (customer allows similar items)' : ''}
              {sub.customerNote ? ` · “${sub.customerNote}”` : ''}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
            <span className={`badge ${SUB_STATUS[sub.status].badge}`}>{SUB_STATUS[sub.status].label}</span>
            {sub.status === 'pending' && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => withdraw.mutate(sub.id)} disabled={withdraw.isPending}>Withdraw</button>
            )}
          </div>
        </div>
      ))}
    </section>
  );
}

export function ProposeSubstitutionModal({ storeId, orderId, item, preference, onClose, onDone }: {
  storeId: string; orderId: string; item: LineItem; preference: string; onClose: () => void; onDone: () => void;
}) {
  const { showToast } = useToast();
  const { data: products, isLoading, error } = useQuery({ queryKey: ['products-all', storeId], queryFn: () => productApi.all(storeId) });
  // The same alternatives engine the customer sees (roadmap §5 P6 "Smart substitutions").
  const suggested = useQuery({
    queryKey: ['alternatives', storeId, item.productId],
    queryFn: () => intelligenceApi.alternatives(storeId, item.productId!),
    enabled: Boolean(item.productId),
  });
  const rank = useMemo(() => new Map((suggested.data?.alternatives.items ?? []).map((a, i) => [a.product.id, i])), [suggested.data]);
  const [search, setSearch] = useState('');
  const [variantId, setVariantId] = useState('');
  const [quantity, setQuantity] = useState(item.quantity);
  const [note, setNote] = useState('');

  const options = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (products ?? [])
      .filter((p) => p.isActive && (!term || p.name.toLowerCase().includes(term)))
      .flatMap((p) => p.variants.filter((v) => v.isActive && v.id !== item.variantId && (v.availableQuantity === null || v.availableQuantity > 0)).map((v) => ({ product: p, variant: v })))
      .sort((a, b) => (rank.get(a.product.id) ?? 99) - (rank.get(b.product.id) ?? 99))
      .slice(0, 50);
  }, [products, search, item.variantId, rank]);
  const chosen = options.find((o) => o.variant.id === variantId);
  const originalLine = item.unitPricePaise * item.quantity;
  const replacementLine = chosen ? Math.min(chosen.variant.pricePaise * quantity, originalLine) : null;

  const propose = useMutation({
    mutationFn: () => substitutionApi.propose(storeId, orderId, { orderItemId: item.id, variantId, quantity, note: note.trim() || undefined }),
    onSuccess: ({ substitution }) => {
      showToast(substitution.status === 'approved' ? 'Applied — the customer allows similar items and has been told.' : 'Suggested — the customer will approve or decline it.', 'success');
      onDone();
    },
    onError: (err) => showToast(errorMessage(err), 'error'),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!variantId) return;
    propose.mutate();
  };

  return (
    <Modal title={`Substitute for ${item.productName}`} onClose={onClose} busy={propose.isPending}
      footer={<>
        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={propose.isPending}>Cancel</button>
        <button type="submit" form="substitute-form" className="btn btn-primary" disabled={!variantId || propose.isPending}>{propose.isPending ? 'Sending…' : 'Suggest'}</button>
      </>}>
      <form id="substitute-form" onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', margin: 0 }}>
          {preference === 'allow_similar'
            ? 'This customer allows similar items: a replacement that costs no more is applied at once and they are told.'
            : 'The customer will be asked to approve. They never pay more than the original line.'}
        </p>
        <div className="input-wrapper">
          <label className="input-label" htmlFor="sub-search">Find a product</label>
          <input id="sub-search" className="input-field" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search your catalogue" />
        </div>
        {isLoading ? <Spinner /> : error ? <div className="alert-strip alert-strip-danger">{errorMessage(error)}</div> : options.length === 0 ? (
          <p style={{ fontSize: 'var(--text-sm)' }}>No other product in stock matches.</p>
        ) : (
          <div className="input-wrapper">
            <label className="input-label" htmlFor="sub-variant">Replacement</label>
            <select id="sub-variant" className="input-field" value={variantId} onChange={(e) => setVariantId(e.target.value)} required>
              <option value="">Choose…</option>
              {options.map(({ product, variant }) => (
                <option key={variant.id} value={variant.id}>
                  {rank.has(product.id) ? '★ ' : ''}{product.name}{variant.name !== 'Default' ? ` (${variant.name})` : ''} — {formatPaise(variant.pricePaise)}{variant.availableQuantity !== null ? ` · ${variant.availableQuantity} left` : ''}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="form-row">
          <div className="input-wrapper">
            <label className="input-label" htmlFor="sub-qty">Quantity</label>
            <input id="sub-qty" type="number" min={1} max={999} className="input-field" value={quantity} onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))} />
          </div>
          <div className="input-wrapper">
            <label className="input-label" htmlFor="sub-note">Note to the customer</label>
            <input id="sub-note" className="input-field" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. 1 kg packs sold out" />
          </div>
        </div>
        {rank.size > 0 && <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)', margin: 0 }}>★ Suggested: similar name or category, close in price.</p>}
        {replacementLine !== null && (
          <div className="alert-strip alert-strip-info">Customer pays {formatPaise(replacementLine)} for this line (was {formatPaise(originalLine)}).</div>
        )}
      </form>
    </Modal>
  );
}
