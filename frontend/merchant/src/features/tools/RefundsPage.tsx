import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { refundApi, type RefundStatus } from '../../api/ops';
import { useActiveStore } from '../../hooks/useStore';
import { formatPaise } from '../../lib/money';
import { EmptyState, ErrorState, NoStore, PageHeader, Pagination, Spinner, SubTabs, formatDateTime } from '../../components/common/ui';
import { IconRefresh } from '../../components/icons/Icons';
import OrderDetailModal from '../orders/OrderDetailModal';
import './Tools.css';

/**
 * Money owed back on cancelled and rejected paid orders (roadmap §4 P2). A
 * refund is "Refunded" only once the payment partner — or the khata entry, or
 * the merchant handing cash back — confirms it.
 */
const FILTERS: { value: string; label: string }[] = [
  { value: 'initiated,processing,failed', label: 'Needs attention' },
  { value: 'failed', label: 'Failed' },
  { value: 'refunded', label: 'Refunded' },
  { value: '', label: 'All' },
];

const BADGE: Record<RefundStatus, string> = { initiated: 'badge-warning', processing: 'badge-info', refunded: 'badge-success', failed: 'badge-danger' };

export default function RefundsPage() {
  const { activeStoreId } = useActiveStore();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState(FILTERS[0].value);
  const [page, setPage] = useState(1);
  const [orderId, setOrderId] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['refunds', activeStoreId, status, page],
    queryFn: () => refundApi.list(activeStoreId!, { status: status || undefined, page }),
    enabled: !!activeStoreId,
  });
  if (!activeStoreId) return <NoStore title="Refunds" />;
  const refunds = query.data?.data.refunds ?? [];

  return (
    <div>
      <PageHeader title="Refunds" subtitle="Refunds open by themselves when a paid order is cancelled or rejected. Open the order to retry a failed one." />
      <SubTabs value={status} options={FILTERS} onChange={(value) => { setStatus(value); setPage(1); }} />
      {query.isLoading ? <Spinner large /> : query.error ? <ErrorState error={query.error} onRetry={() => query.refetch()} /> : refunds.length === 0 ? (
        <EmptyState icon={<IconRefresh size={32} />} title="No refunds here" description="Nothing in this list right now." />
      ) : (
        <div className="table-container">
          <table className="table">
            <thead><tr><th>Order</th><th>Amount</th><th>How</th><th>Status</th><th>Started</th><th /></tr></thead>
            <tbody>
              {refunds.map((refund) => (
                <tr key={refund.id}>
                  <td>{refund.orderNumber ?? '—'}{refund.kind === 'adjustment' && <span className="tiny"> (partial)</span>}</td>
                  <td style={{ fontWeight: 'var(--font-semibold)' }}>{formatPaise(refund.amountPaise)}</td>
                  <td className="muted">{refund.methodLabel}</td>
                  <td>
                    <span className={`badge ${BADGE[refund.status]}`}>{refund.statusLabel}</span>
                    {refund.failureReason && <div className="tiny">{refund.failureReason}</div>}
                  </td>
                  <td className="muted">{formatDateTime(refund.initiatedAt)}</td>
                  <td><button type="button" className="btn btn-ghost btn-sm" onClick={() => setOrderId(refund.orderId)}>Open order</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination meta={query.data?.meta} onPage={setPage} />
      {orderId && (
        <OrderDetailModal storeId={activeStoreId} orderId={orderId} onClose={() => { setOrderId(null); queryClient.invalidateQueries({ queryKey: ['refunds', activeStoreId] }); }} />
      )}
    </div>
  );
}
