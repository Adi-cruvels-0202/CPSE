import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { inventoryApi } from '../../api/endpoints';
import { useActiveStore } from '../../hooks/useStore';
import { formatPaise } from '../../lib/money';
import { EmptyState, NoStore, Pagination, Spinner, formatDateTime } from '../../components/common/ui';
import { IconHistory } from '../../components/icons/Icons';

/**
 * Every stock movement, newest first — the merchant's own and the ones orders
 * and counter sales make. Append-only: a mistake is fixed by a new movement.
 */

const TYPES: Record<string, { label: string; badge: string }> = {
  stock_in: { label: 'Received', badge: 'badge-success' },
  stock_out: { label: 'Taken out', badge: 'badge-danger' },
  adjustment: { label: 'Counted', badge: 'badge-warning' },
  order_reserved: { label: 'Held for order', badge: 'badge-info' },
  order_released: { label: 'Order let go', badge: 'badge-neutral' },
  order_fulfilled: { label: 'Order completed', badge: 'badge-danger' },
  sale: { label: 'Counter sale', badge: 'badge-danger' },
  purchase: { label: 'Purchase', badge: 'badge-success' },
};

const signed = (value: number) => (value > 0 ? `+${value}` : String(value));

export default function InventoryHistoryPage() {
  const { activeStoreId } = useActiveStore();
  const [page, setPage] = useState(1);
  const [movementType, setMovementType] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['history', activeStoreId, page, movementType],
    queryFn: () => inventoryApi.history(activeStoreId!, { page, limit: 30, movementType: movementType || undefined }),
    enabled: !!activeStoreId,
  });

  if (!activeStoreId) return <NoStore title="Stock history" />;
  const entries = data?.data.entries ?? [];

  return (
    <div>
      <div className="page-header">
        <div><h1 className="page-title">Stock history</h1><p className="page-subtitle">Every change to stock, and what caused it</p></div>
      </div>

      <div className="filters-bar">
        <select className="input-field select-field" value={movementType} onChange={(e) => { setMovementType(e.target.value); setPage(1); }} style={{ maxWidth: 220 }}>
          <option value="">Every kind</option>
          {Object.entries(TYPES).filter(([type]) => type !== 'purchase').map(([type, { label }]) => <option key={type} value={type}>{label}</option>)}
        </select>
      </div>

      {isLoading ? <Spinner large /> : entries.length === 0 ? (
        <EmptyState icon={<IconHistory size={32} />} title="No movements yet" description="Receiving stock, orders and counter sales all show up here." />
      ) : (
        <>
          <div className="table-container">
            <table className="table">
              <thead><tr><th>When</th><th>Product</th><th>What</th><th>Shelf</th><th>Held</th><th>Can sell after</th><th>By</th><th>Details</th></tr></thead>
              <tbody>
                {entries.map((entry) => {
                  const type = TYPES[entry.movementType] ?? { label: entry.movementType, badge: 'badge-neutral' };
                  return (
                    <tr key={entry.id}>
                      <td style={{ whiteSpace: 'nowrap', fontSize: 'var(--text-xs)' }}>{formatDateTime(entry.createdAt)}</td>
                      <td style={{ fontWeight: 'var(--font-medium)' }}>
                        {entry.productName ?? '—'}
                        {entry.variantName && entry.variantName !== 'Default' && <span style={{ color: 'var(--color-text-tertiary)' }}> ({entry.variantName})</span>}
                      </td>
                      <td><span className={`badge ${type.badge}`}>{type.label}</span></td>
                      <td style={{ color: entry.onHandChange > 0 ? 'var(--color-success)' : entry.onHandChange < 0 ? 'var(--color-danger)' : undefined }}>
                        {entry.onHandChange === 0 ? '—' : signed(entry.onHandChange)} <span className="body-xs">→ {entry.onHandAfter}</span>
                      </td>
                      <td>{entry.reservedChange === 0 ? '—' : signed(entry.reservedChange)} <span className="body-xs">→ {entry.reservedAfter}</span></td>
                      <td style={{ fontWeight: 'var(--font-semibold)' }}>{entry.availableAfter}</td>
                      <td style={{ fontSize: 'var(--text-xs)' }}>{entry.performedBy.type === 'merchant' ? 'You' : entry.performedBy.type === 'customer' ? 'Customer' : 'Automatic'}</td>
                      <td style={{ maxWidth: 240, color: 'var(--color-text-secondary)', fontSize: 'var(--text-xs)' }}>
                        <span className="truncate" style={{ display: 'block' }}>
                          {entry.reference?.number ?? (entry.reference?.type === 'sale' ? 'Counter sale' : '')}
                          {entry.reason ? ` ${entry.reason.replace(/_/g, ' ')}` : ''}
                          {entry.unitCostPaise !== null ? ` @ ${formatPaise(entry.unitCostPaise)}` : ''}
                          {entry.notes ? ` — ${entry.notes}` : ''}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination meta={data?.meta} onPage={setPage} />
        </>
      )}
    </div>
  );
}
