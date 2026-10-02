import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ordersApi } from '../../api/endpoints';
import { useActiveStore } from '../../hooks/useStore';
import { IconPackage, IconStore, IconEye, IconCheck, IconX } from '../../components/icons/Icons';
import OrderDetailModal from './OrderDetailModal';

export default function OrdersPage() {
  const { activeStoreId } = useActiveStore();
  const [page, setPage] = useState(0);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [viewOrder, setViewOrder] = useState<any>(null);

  const { data: ordersRes, isLoading, refetch } = useQuery({
    queryKey: ['orders', activeStoreId, page, statusFilter],
    queryFn: () => ordersApi.list(activeStoreId!, { page, size: 20, status: statusFilter || undefined }),
    enabled: !!activeStoreId,
  });

  const orders = ordersRes?.data?.data || [];
  const totalPages = ordersRes?.data?.totalPages || 0;
  const totalElements = ordersRes?.data?.totalElements || 0;

  if (!activeStoreId) return (
    <div>
      <div className="page-header"><div><h1 className="page-title">Orders</h1></div></div>
      <div className="empty-state"><div className="empty-state-icon"><IconStore size={32} /></div><div className="empty-state-title">No store selected</div></div>
    </div>
  );

  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case 'PENDING': return 'badge-warning';
      case 'ACCEPTED': return 'badge-info';
      case 'PREPARING': return 'badge-info';
      case 'READY': return 'badge-success';
      case 'COMPLETED': return 'badge-neutral';
      case 'CANCELLED': 
      case 'REJECTED': return 'badge-danger';
      default: return 'badge-neutral';
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Orders</h1>
          <p className="page-subtitle">{totalElements} orders found</p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <select 
            className="input" 
            value={statusFilter} 
            onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }}
            style={{ width: '180px' }}
          >
            <option value="">All Statuses</option>
            <option value="PENDING">Pending</option>
            <option value="ACCEPTED">Accepted</option>
            <option value="PREPARING">Preparing</option>
            <option value="READY">Ready</option>
            <option value="COMPLETED">Completed</option>
            <option value="CANCELLED">Cancelled</option>
            <option value="REJECTED">Rejected</option>
          </select>
        </div>
      </div>

      {isLoading ? (
        <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner spinner-lg" /></div>
      ) : orders.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon"><IconPackage size={32} /></div>
          <div className="empty-state-title">No orders found</div>
          <div className="empty-state-description">Try changing your filters or wait for new orders.</div>
        </div>
      ) : (
        <>
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Order #</th>
                  <th>Date</th>
                  <th>Customer</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Total</th>
                  <th style={{ width: 60 }}></th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o: any) => (
                  <tr 
                    key={o.id} 
                    onClick={() => setViewOrder(o)}
                    style={{ cursor: 'pointer' }}
                    className="hoverable-row"
                  >
                    <td style={{ fontWeight: 'var(--font-semibold)' }}>{o.orderNumber}</td>
                    <td style={{ fontSize: 'var(--text-xs)', whiteSpace: 'nowrap' }}>
                      {new Date(o.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                    </td>
                    <td>
                      <div>{o.customerName || '—'}</div>
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)' }}>{o.customerPhone}</div>
                    </td>
                    <td>
                      <span className="badge badge-neutral">{o.orderType}</span>
                    </td>
                    <td>
                      <span className={`badge ${getStatusBadgeClass(o.status)}`}>{o.status}</span>
                    </td>
                    <td style={{ fontWeight: 'var(--font-bold)', whiteSpace: 'nowrap' }}>
                      ₹{Number(o.totalAmount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button 
                        className="btn btn-secondary btn-sm" 
                        onClick={(e) => { e.stopPropagation(); setViewOrder(o); }}
                        style={{ padding: '4px 12px' }}
                      >
                        View Details
                      </button>
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

      {viewOrder && (
        <OrderDetailModal 
          storeId={activeStoreId!} 
          order={viewOrder} 
          onClose={() => { setViewOrder(null); refetch(); }} 
        />
      )}
    </div>
  );
}
