import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ordersApi } from '../../api/endpoints';
import { useToast } from '../../hooks/useToast';
import { IconCheck, IconX, IconRefresh, IconPackage, IconTruck } from '../../components/icons/Icons';

export default function OrderDetailModal({ storeId, order, onClose }: { storeId: string; order: any; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const { data: detailRes, isLoading } = useQuery({
    queryKey: ['order', storeId, order.id],
    queryFn: () => ordersApi.get(storeId, order.id),
  });
  
  const detail = detailRes?.data?.data || order;

  // Mutations
  const actionOpts = {
    onSuccess: (res: any) => {
      showToast('success', res.data?.message || 'Order updated successfully');
      queryClient.invalidateQueries({ queryKey: ['orders', storeId] });
      queryClient.invalidateQueries({ queryKey: ['order', storeId, order.id] });
    },
    onError: (err: any) => {
      showToast('error', err.response?.data?.message || 'Failed to update order');
    }
  };

  const acceptMutation = useMutation({
    mutationFn: () => ordersApi.accept(storeId, order.id),
    ...actionOpts,
  });

  const rejectMutation = useMutation({
    mutationFn: (reason: string) => ordersApi.reject(storeId, order.id, { reason }),
    ...actionOpts,
  });

  const statusMutation = useMutation({
    mutationFn: (status: string) => ordersApi.updateStatus(storeId, order.id, { status }),
    ...actionOpts,
  });

  const completeMutation = useMutation({
    mutationFn: () => ordersApi.complete(storeId, order.id),
    ...actionOpts,
  });

  const cancelMutation = useMutation({
    mutationFn: (reason: string) => ordersApi.cancel(storeId, order.id, { reason }),
    ...actionOpts,
  });

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

  const isWorking = acceptMutation.isPending || rejectMutation.isPending || 
                    statusMutation.isPending || completeMutation.isPending || cancelMutation.isPending;

  return (
    <div className="dialog-overlay" onClick={e => { if (e.target === e.currentTarget && !isWorking) onClose(); }}>
      <div className="dialog-content dialog-lg">
        <div className="dialog-header">
          <h2 className="dialog-title">Order {detail.orderNumber}</h2>
          <span className={`badge ${getStatusBadgeClass(detail.status)}`} style={{ marginLeft: 'var(--space-3)' }}>
            {detail.status}
          </span>
        </div>
        
        <div className="dialog-body">
          {isLoading && !detail.items ? (
            <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" /></div>
          ) : (
            <>
              <div className="detail-grid" style={{ marginBottom: 'var(--space-4)' }}>
                <div className="detail-row">
                  <span className="detail-label">Date</span>
                  <span>{new Date(detail.createdAt).toLocaleString('en-IN')}</span>
                </div>
                <div className="detail-row">
                  <span className="detail-label">Type</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    {detail.orderType === 'DELIVERY' ? <IconTruck size={14}/> : <IconPackage size={14}/>}
                    {detail.orderType}
                  </span>
                </div>
                <div className="detail-row">
                  <span className="detail-label">Payment</span>
                  <span className="badge badge-neutral">{(detail.paymentMethod || 'N/A').replace('_', ' ')}</span>
                </div>
                
                {detail.customerName && (
                  <div className="detail-row">
                    <span className="detail-label">Customer</span>
                    <span>{detail.customerName}</span>
                  </div>
                )}
                {detail.customerPhone && (
                  <div className="detail-row">
                    <span className="detail-label">Phone</span>
                    <span>{detail.customerPhone}</span>
                  </div>
                )}
              </div>

              {detail.items && detail.items.length > 0 && (
                <div className="table-container">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Product</th>
                        <th>SKU</th>
                        <th>Qty</th>
                        <th>Price</th>
                        <th>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.items.map((i: any) => (
                        <tr key={i.id}>
                          <td>
                            {i.productName} 
                            {i.variantName !== 'Default' && <span style={{ color: 'var(--color-text-tertiary)', marginLeft: 4 }}>({i.variantName})</span>}
                          </td>
                          <td><code className="mono">{i.sku}</code></td>
                          <td>{i.quantity}</td>
                          <td>₹{Number(i.unitPrice).toLocaleString('en-IN')}</td>
                          <td style={{ fontWeight: 'var(--font-semibold)' }}>₹{Number(i.lineTotal).toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="cart-summary" style={{ marginTop: 'var(--space-4)' }}>
                <div className="cart-summary-row">
                  <span>Subtotal</span>
                  <span>₹{Number(detail.subtotal).toFixed(2)}</span>
                </div>
                <div className="cart-summary-row">
                  <span>Tax</span>
                  <span>₹{Number(detail.taxAmount).toFixed(2)}</span>
                </div>
                <div className="cart-summary-row cart-total">
                  <span>Total</span>
                  <span>₹{Number(detail.totalAmount).toFixed(2)}</span>
                </div>
              </div>

              {/* ACTION AREA */}
              <div style={{ marginTop: 'var(--space-6)', padding: 'var(--space-4)', backgroundColor: 'var(--color-bg-alt)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
                <h3 style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--font-semibold)', marginBottom: 'var(--space-3)' }}>Order Actions</h3>
                <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                  
                  {detail.status === 'PENDING' && (
                    <>
                      <button className="btn btn-primary" onClick={() => acceptMutation.mutate()} disabled={isWorking}>
                        <IconCheck size={16} /> Accept Order (Reserve Stock)
                      </button>
                      <button className="btn btn-danger" onClick={() => {
                        const reason = window.prompt("Reason for rejection:");
                        if (reason !== null) rejectMutation.mutate(reason);
                      }} disabled={isWorking}>
                        <IconX size={16} /> Reject Order
                      </button>
                    </>
                  )}

                  {detail.status === 'ACCEPTED' && (
                    <button className="btn btn-primary" onClick={() => statusMutation.mutate('PREPARING')} disabled={isWorking}>
                      Mark as Preparing
                    </button>
                  )}

                  {detail.status === 'PREPARING' && (
                    <button className="btn btn-primary" onClick={() => statusMutation.mutate('READY')} disabled={isWorking}>
                      Mark as Ready
                    </button>
                  )}

                  {detail.status === 'READY' && (
                    <button className="btn btn-success" onClick={() => completeMutation.mutate()} disabled={isWorking}>
                      <IconCheck size={16} /> Complete Order (Deduct Stock)
                    </button>
                  )}

                  {['ACCEPTED', 'PREPARING', 'READY'].includes(detail.status) && (
                    <button className="btn btn-danger" onClick={() => {
                      const reason = window.prompt("Reason for cancellation:");
                      if (reason !== null) cancelMutation.mutate(reason);
                    }} disabled={isWorking}>
                      <IconX size={16} /> Cancel Order
                    </button>
                  )}

                  {['COMPLETED', 'REJECTED', 'CANCELLED'].includes(detail.status) && (
                    <span style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-sm)', fontStyle: 'italic' }}>
                      Order is in a terminal state. No further actions can be taken.
                    </span>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
        <div className="dialog-footer">
          <button className="btn btn-secondary" onClick={onClose} disabled={isWorking}>Close</button>
        </div>
      </div>
    </div>
  );
}
