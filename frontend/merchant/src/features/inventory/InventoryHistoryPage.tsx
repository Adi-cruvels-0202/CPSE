import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { inventoryApi } from '../../api/endpoints';
import { useActiveStore } from '../../hooks/useStore';
import { IconHistory, IconStore } from '../../components/icons/Icons';

export default function InventoryHistoryPage() {
  const { activeStoreId } = useActiveStore();
  const [page, setPage] = useState(0);
  const [typeFilter, setTypeFilter] = useState('');

  const { data: historyRes, isLoading } = useQuery({
    queryKey: ['inventoryHistory', activeStoreId, page, typeFilter],
    queryFn: () => inventoryApi.history(activeStoreId!, { page, size: 30, type: typeFilter || undefined }),
    enabled: !!activeStoreId,
  });

  const entries = historyRes?.data?.data || [];
  const totalPages = historyRes?.data?.totalPages || 0;
  const movementTypes = ['STOCK_IN','STOCK_OUT','ADJUSTMENT','SALE','PURCHASE','DAMAGE','EXPIRY'];

  const badgeClass = (type: string) => {
    if (type === 'STOCK_IN' || type === 'PURCHASE') return 'badge-success';
    if (type === 'STOCK_OUT' || type === 'SALE') return 'badge-danger';
    if (type === 'ADJUSTMENT') return 'badge-warning';
    return 'badge-neutral';
  };

  if (!activeStoreId) return (
    <div>
      <div className="page-header"><div><h1 className="page-title">Inventory History</h1></div></div>
      <div className="empty-state">
        <div className="empty-state-icon"><IconStore size={32} /></div>
        <div className="empty-state-title">No store selected</div>
      </div>
    </div>
  );

  return (
    <div>
      <div className="page-header"><div><h1 className="page-title">Inventory History</h1><p className="page-subtitle">Audit trail of all stock movements</p></div></div>

      <div className="filters-bar">
        <select className="input-field select-field" value={typeFilter} onChange={e => { setTypeFilter(e.target.value); setPage(0); }} style={{ maxWidth: 200 }}>
          <option value="">All Types</option>
          {movementTypes.map(t => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
        </select>
      </div>

      {isLoading ? (
        <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner spinner-lg" /></div>
      ) : entries.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon"><IconHistory size={32} /></div>
          <div className="empty-state-title">No history yet</div>
          <div className="empty-state-description">Stock movements will appear here as you manage inventory.</div>
        </div>
      ) : (
        <>
          <div className="table-container">
            <table className="table">
              <thead><tr><th>Date</th><th>Product</th><th>SKU</th><th>Type</th><th>Qty</th><th>Before</th><th>After</th><th>Notes</th></tr></thead>
              <tbody>
                {entries.map((e: any) => (
                  <tr key={e.id}>
                    <td style={{ whiteSpace: 'nowrap', fontSize: 'var(--text-xs)' }}>{new Date(e.createdAt).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}</td>
                    <td style={{ fontWeight: 'var(--font-medium)' }}>{e.productName || '—'}</td>
                    <td><code className="mono">{e.variantSku || '—'}</code></td>
                    <td><span className={`badge ${badgeClass(e.movementType)}`}>{e.movementType?.replace('_', ' ')}</span></td>
                    <td style={{ fontWeight: 'var(--font-semibold)', color: e.quantity > 0 ? 'var(--color-success)' : 'var(--color-danger)' }}>{e.quantity > 0 ? '+' : ''}{e.quantity}</td>
                    <td>{e.quantityBefore}</td>
                    <td style={{ fontWeight: 'var(--font-semibold)' }}>{e.quantityAfter}</td>
                    <td style={{ maxWidth: 200, color: 'var(--color-text-secondary)', fontSize: 'var(--text-xs)' }}><span className="truncate" style={{ display: 'block' }}>{e.notes || '—'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="pagination">
              <button className="btn btn-secondary btn-sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Previous</button>
              <span className="pagination-info">Page {page + 1} of {totalPages}</span>
              <button className="btn btn-secondary btn-sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>Next</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
