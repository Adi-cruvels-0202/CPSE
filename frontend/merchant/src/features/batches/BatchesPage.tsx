import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useActiveStore } from '../../hooks/useStore';
import api from '../../api/client';
import { IconCalendar, IconAlertTriangle, IconStore } from '../../components/icons/Icons';

export default function BatchesPage() {
  const { activeStoreId } = useActiveStore();
  const [page, setPage] = useState(0);

  const { data: batchesRes, isLoading } = useQuery({
    queryKey: ['batches', activeStoreId, page],
    queryFn: () => api.get(`/api/stores/${activeStoreId}/batches`, { params: { page, size: 20 } }),
    enabled: !!activeStoreId,
  });

  const { data: expiringRes } = useQuery({
    queryKey: ['expiringBatches', activeStoreId],
    queryFn: () => api.get(`/api/stores/${activeStoreId}/batches/expiring`),
    enabled: !!activeStoreId,
  });

  const batches = batchesRes?.data?.data || [];
  const totalPages = batchesRes?.data?.totalPages || 0;
  const expiringBatches = expiringRes?.data?.data || [];

  if (!activeStoreId) return (
    <div>
      <div className="page-header"><div><h1 className="page-title">Batches</h1></div></div>
      <div className="empty-state"><div className="empty-state-icon"><IconStore size={32} /></div><div className="empty-state-title">No store selected</div></div>
    </div>
  );

  return (
    <div>
      <div className="page-header"><div><h1 className="page-title">Batches & Expiry</h1><p className="page-subtitle">Track batch-level inventory and expiry dates</p></div></div>

      {expiringBatches.length > 0 && (
        <div className="alert-strip alert-strip-warning" style={{ marginBottom: 'var(--space-4)' }}>
          <IconAlertTriangle size={18} />
          <span style={{ fontWeight: 'var(--font-semibold)' }}>{expiringBatches.length} batch{expiringBatches.length !== 1 ? 'es' : ''} expiring soon</span>
        </div>
      )}

      {expiringBatches.length > 0 && (
        <div className="table-container" style={{ marginBottom: 'var(--space-6)' }}>
          <table className="table">
            <thead><tr><th>Product</th><th>Batch</th><th>Remaining</th><th>Expiry</th><th>Days Left</th></tr></thead>
            <tbody>
              {expiringBatches.map((b: any) => {
                const daysLeft = b.expiryDate ? Math.ceil((new Date(b.expiryDate).getTime() - Date.now()) / 86400000) : null;
                return (
                  <tr key={b.id}>
                    <td>{b.productName || '—'} ({b.variantName || b.sku})</td>
                    <td style={{ fontWeight: 'var(--font-medium)' }}>{b.batchNumber}</td>
                    <td>{b.remainingQuantity}</td>
                    <td>{b.expiryDate ? new Date(b.expiryDate).toLocaleDateString('en-IN') : '—'}</td>
                    <td><span className={`badge ${daysLeft !== null && daysLeft <= 7 ? 'badge-danger' : 'badge-warning'}`}>{daysLeft !== null ? `${daysLeft} days` : '—'}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {isLoading ? (
        <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner spinner-lg" /></div>
      ) : batches.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon"><IconCalendar size={32} /></div>
          <div className="empty-state-title">No batches yet</div>
          <div className="empty-state-description">Batches are created when you record purchases with batch numbers.</div>
          <a href="/purchases" className="btn btn-primary">Go to Purchases</a>
        </div>
      ) : (
        <>
          <div className="table-container">
            <table className="table">
              <thead><tr><th>Batch #</th><th>Product</th><th>SKU</th><th>Initial</th><th>Remaining</th><th>Cost</th><th>Expiry</th><th>Status</th></tr></thead>
              <tbody>
                {batches.map((b: any) => (
                  <tr key={b.id}>
                    <td style={{ fontWeight: 'var(--font-semibold)' }}>{b.batchNumber}</td>
                    <td>{b.productName || '—'}</td>
                    <td><code className="mono">{b.sku || '—'}</code></td>
                    <td>{b.quantity}</td>
                    <td style={{ fontWeight: 'var(--font-semibold)' }}>{b.remainingQuantity}</td>
                    <td>{b.unitCost ? `₹${Number(b.unitCost).toFixed(2)}` : '—'}</td>
                    <td>{b.expiryDate ? new Date(b.expiryDate).toLocaleDateString('en-IN') : '—'}</td>
                    <td>
                      {b.expired || b.isExpired ? <span className="badge badge-danger">Expired</span>
                        : b.expiringSoon || b.isExpiringSoon ? <span className="badge badge-warning">Expiring</span>
                        : <span className="badge badge-success">OK</span>}
                    </td>
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
