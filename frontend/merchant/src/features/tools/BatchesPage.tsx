import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { inventoryApi } from '../../api/endpoints';
import { purchaseApi, type Batch } from '../../api/ops';
import { errorMessage } from '../../api/client';
import { useActiveStore } from '../../hooks/useStore';
import { useToast } from '../../hooks/useToast';
import { formatPaise } from '../../lib/money';
import { EmptyState, ErrorState, NoStore, PageHeader, Pagination, Spinner, SubTabs, formatDate } from '../../components/common/ui';
import { IconCalendar } from '../../components/icons/Icons';
import { OfferForm } from './PromotionsPage';
import './Tools.css';

/**
 * Batches and expiry (roadmap §4 P1, Phase C). Stock leaves batches
 * first-expiring first; expired lots are written off from here, and a lot near
 * its expiry can be put on a local clearance offer.
 */
const STATE_BADGE: Record<string, { label: string; badge: string }> = {
  expired: { label: 'Expired', badge: 'badge-danger' },
  expiring: { label: 'Expiring soon', badge: 'badge-warning' },
  ok: { label: 'OK', badge: 'badge-success' },
  no_expiry: { label: 'No expiry', badge: 'badge-neutral' },
};

export default function BatchesPage() {
  const { activeStoreId } = useActiveStore();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<'expiring' | 'expired' | 'active' | 'all'>('expiring');
  const [page, setPage] = useState(1);
  const [offerFor, setOfferFor] = useState<Batch | null>(null);

  const query = useQuery({
    queryKey: ['batches', activeStoreId, status, page],
    queryFn: () => purchaseApi.batches(activeStoreId!, { status, page }),
    enabled: !!activeStoreId,
  });
  const writeOff = useMutation({
    mutationFn: (batch: Batch) => inventoryApi.stockOut(activeStoreId!, { variantId: batch.variantId, quantity: batch.quantityRemaining, reason: 'expired', batchId: batch.id, notes: `Batch ${batch.batchNumber ?? ''} written off` }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['batches', activeStoreId] });
      queryClient.invalidateQueries({ queryKey: ['products', activeStoreId] });
      showToast('Written off — recorded in the stock history.', 'success');
    },
    onError: (err) => showToast(errorMessage(err), 'error'),
  });

  if (!activeStoreId) return <NoStore title="Batches & expiry" />;
  const batches = query.data?.data.batches ?? [];
  const summary = query.data?.data.summary;

  return (
    <div>
      <PageHeader title="Batches & expiry" subtitle="Lots received with a batch number or expiry date. Sales use the soonest-expiring lot first." />
      {summary && (
        <div className="metric-grid">
          <div className="metric"><div className="metric__label">Expiring soon</div><div className="metric__value">{summary.expiringCount}</div></div>
          <div className="metric"><div className="metric__label">Expired lots</div><div className="metric__value">{summary.expiredCount}</div></div>
          <div className="metric"><div className="metric__label">Expired units on shelf</div><div className="metric__value">{summary.expiredQuantity}</div></div>
        </div>
      )}
      <SubTabs value={status} options={[{ value: 'expiring', label: 'Expiring soon' }, { value: 'expired', label: 'Expired' }, { value: 'active', label: 'On the shelf' }, { value: 'all', label: 'All' }]} onChange={(v) => { setStatus(v); setPage(1); }} />
      {query.isLoading ? <Spinner large /> : query.error ? <ErrorState error={query.error} onRetry={() => query.refetch()} /> : batches.length === 0 ? (
        <EmptyState icon={<IconCalendar size={32} />} title="Nothing here" description="Receive stock with a batch number or expiry date (Purchases or Stock in) to track it." />
      ) : (
        <div className="table-container">
          <table className="table">
            <thead><tr><th>Product</th><th>Batch</th><th>Expires</th><th>Left</th><th>Cost</th><th /></tr></thead>
            <tbody>
              {batches.map((b) => (
                <tr key={b.id}>
                  <td>{b.productName}{b.variantName && b.variantName !== 'Default' ? ` (${b.variantName})` : ''}</td>
                  <td className="muted">{b.batchNumber ?? '—'}</td>
                  <td>
                    {formatDate(b.expiresOn)} <span className={`badge ${STATE_BADGE[b.expiryState].badge}`}>{STATE_BADGE[b.expiryState].label}</span>
                    {b.daysToExpiry !== null && b.daysToExpiry >= 0 && <div className="tiny">{b.daysToExpiry} day{b.daysToExpiry === 1 ? '' : 's'} left</div>}
                  </td>
                  <td>{b.quantityRemaining} / {b.quantityReceived}</td>
                  <td className="muted">{b.unitCostPaise === null ? '—' : formatPaise(b.unitCostPaise)}</td>
                  <td style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {b.quantityRemaining > 0 && b.expiryState === 'expiring' && (
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOfferFor(b)}>Clearance offer</button>
                    )}
                    {b.quantityRemaining > 0 && b.expiryState === 'expired' && (
                      <button type="button" className="btn btn-danger btn-sm" disabled={writeOff.isPending}
                        onClick={() => { if (window.confirm(`Write off ${b.quantityRemaining} expired unit(s)? This takes them off the shelf.`)) writeOff.mutate(b); }}>
                        Write off
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination meta={query.data?.meta} onPage={setPage} />
      {offerFor && <OfferForm storeId={activeStoreId} batch={offerFor} onClose={() => setOfferFor(null)} />}
    </div>
  );
}
