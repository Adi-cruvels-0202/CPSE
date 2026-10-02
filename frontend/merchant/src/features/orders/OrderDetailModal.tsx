import type { ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { orderApi } from '../../api/endpoints';
import { errorMessage } from '../../api/client';
import type { Order } from '../../api/types';
import { useToast } from '../../hooks/useToast';
import { formatPaise } from '../../lib/money';
import { OrderStatusBadge, Spinner, formatDateTime } from '../../components/common/ui';
import { IconCheck, IconX, IconPackage, IconTruck } from '../../components/icons/Icons';

/**
 * One order. The buttons are exactly the order's `allowedActions`, worked out
 * by the server from its state and whether it is pickup or delivery — this
 * screen never re-implements the rules. Every action notifies the customer and
 * moves the stock: a reject or cancel gives it back, completing takes it off
 * the shelf.
 */

const ACTIONS: Record<string, { label: string; style: string; icon?: ReactNode; reason?: 'optional' | 'required' }> = {
  accept: { label: 'Accept order', style: 'btn-primary', icon: <IconCheck size={16} /> },
  'status:preparing': { label: 'Start preparing', style: 'btn-primary' },
  'status:ready_for_pickup': { label: 'Ready for pickup', style: 'btn-primary', icon: <IconPackage size={16} /> },
  'status:out_for_delivery': { label: 'Out for delivery', style: 'btn-primary', icon: <IconTruck size={16} /> },
  complete: { label: 'Mark completed', style: 'btn-success', icon: <IconCheck size={16} /> },
  reject: { label: 'Reject', style: 'btn-danger', icon: <IconX size={16} />, reason: 'optional' },
  cancel: { label: 'Cancel order', style: 'btn-danger', icon: <IconX size={16} />, reason: 'required' },
};

const WHO: Record<string, string> = { customer: 'Customer', store: 'You', system: 'Automatic', payment_webhook: 'Payment' };

export default function OrderDetailModal({ storeId, orderId, onClose }: { storeId: string; orderId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const { data, isLoading, error } = useQuery({
    queryKey: ['order', storeId, orderId],
    queryFn: () => orderApi.get(storeId, orderId),
  });
  const order: Order | undefined = data?.order;

  const act = useMutation({
    mutationFn: ({ action, reason }: { action: string; reason?: string }) => orderApi.act(storeId, orderId, action, reason),
    onSuccess: ({ order: updated }) => {
      queryClient.setQueryData(['order', storeId, orderId], { order: updated });
      queryClient.invalidateQueries({ queryKey: ['orders', storeId] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', storeId] });
      queryClient.invalidateQueries({ queryKey: ['products', storeId] });
      showToast(`Order ${updated.statusLabel.toLowerCase()} — the customer has been told.`, 'success');
    },
    onError: (err) => showToast(errorMessage(err), 'error'),
  });

  const run = (action: string) => {
    const spec = ACTIONS[action];
    if (spec?.reason) {
      const reason = window.prompt(spec.reason === 'required' ? 'Why are you cancelling? The customer sees this.' : 'Why are you rejecting it? (optional — the customer sees this)');
      if (reason === null) return;
      if (spec.reason === 'required' && reason.trim().length < 3) {
        showToast('Give the customer a reason (3 characters or more).', 'error');
        return;
      }
      act.mutate({ action, reason: reason.trim() || undefined });
      return;
    }
    act.mutate({ action });
  };

  const address = order?.deliveryAddress;

  return (
    <div className="dialog-overlay" onClick={(e) => { if (e.target === e.currentTarget && !act.isPending) onClose(); }}>
      <div className="dialog-content dialog-lg" role="dialog" aria-modal="true" aria-labelledby="order-title">
        <div className="dialog-header">
          <h2 className="dialog-title" id="order-title">Order {order?.orderNumber ?? ''}</h2>
          {order && <span style={{ marginLeft: 'var(--space-3)' }}><OrderStatusBadge status={order.status} label={order.statusLabel} /></span>}
        </div>

        <div className="dialog-body">
          {isLoading ? <Spinner /> : !order ? (
            <div className="alert-strip alert-strip-warning" role="alert">{errorMessage(error)}</div>
          ) : (
            <>
              <div className="detail-grid" style={{ marginBottom: 'var(--space-4)' }}>
                <div className="detail-row"><span className="detail-label">Placed</span><span>{formatDateTime(order.placedAt)}</span></div>
                <div className="detail-row"><span className="detail-label">Customer</span><span>{order.customer.name ?? '—'}{order.customer.phone ? ` · ${order.customer.phone}` : ''}</span></div>
                <div className="detail-row">
                  <span className="detail-label">How</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    {order.fulfilmentMode === 'delivery' ? <IconTruck size={14} /> : <IconPackage size={14} />}
                    {order.fulfilmentMode === 'delivery' ? 'Delivery' : 'Pickup from the store'}
                  </span>
                </div>
                {address && (
                  <div className="detail-row">
                    <span className="detail-label">Deliver to</span>
                    <span>{[address.recipientName, address.line1, address.line2, address.landmark, address.city, address.postalCode].filter(Boolean).join(', ')}</span>
                  </div>
                )}
                <div className="detail-row"><span className="detail-label">Payment</span><span>{order.paymentMethod === 'online' ? `Online — ${order.paymentStatus}` : `Cash on ${order.fulfilmentMode}`}</span></div>
                {order.customerNote && <div className="detail-row"><span className="detail-label">Note</span><span style={{ fontStyle: 'italic' }}>“{order.customerNote}”</span></div>}
                {order.cancellationReason && <div className="detail-row"><span className="detail-label">Reason</span><span>{order.cancellationReason}</span></div>}
              </div>

              <div className="table-container">
                <table className="table">
                  <thead><tr><th>Item</th><th>SKU</th><th>Qty</th><th>Price</th><th>GST</th><th>Line total</th></tr></thead>
                  <tbody>
                    {(order.items ?? []).map((item) => (
                      <tr key={item.id}>
                        <td>{item.productName}{item.variantName && <span style={{ color: 'var(--color-text-tertiary)', marginLeft: 4 }}>({item.variantName})</span>}</td>
                        <td><code className="mono">{item.sku ?? '—'}</code></td>
                        <td>{item.quantity}</td>
                        <td>{formatPaise(item.unitPricePaise)}</td>
                        <td>{item.taxPaise > 0 ? `${formatPaise(item.taxPaise)} (${item.taxPercent}%)` : '—'}</td>
                        <td style={{ fontWeight: 'var(--font-semibold)' }}>{formatPaise(item.lineTotalPaise)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="cart-summary" style={{ marginTop: 'var(--space-4)' }}>
                <div className="cart-summary-row"><span>Subtotal</span><span>{formatPaise(order.totals.subtotalPaise)}</span></div>
                {order.totals.discountPaise > 0 && <div className="cart-summary-row"><span>Discount</span><span>−{formatPaise(order.totals.discountPaise)}</span></div>}
                {order.totals.taxPaise > 0 && <div className="cart-summary-row"><span>GST</span><span>{formatPaise(order.totals.taxPaise)}</span></div>}
                {(order.totals.deliveryFeePaise ?? 0) > 0 && <div className="cart-summary-row"><span>Delivery</span><span>{formatPaise(order.totals.deliveryFeePaise)}</span></div>}
                <div className="cart-summary-row cart-total"><span>Total</span><span>{formatPaise(order.totals.totalPaise)}</span></div>
              </div>

              <div style={{ marginTop: 'var(--space-6)', padding: 'var(--space-4)', backgroundColor: 'var(--color-bg-alt)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
                <h3 style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--font-semibold)', marginBottom: 'var(--space-3)' }}>Next step</h3>
                {order.allowedActions.length === 0 ? (
                  <span style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-sm)' }}>
                    {order.status === 'pending_payment' ? 'Waiting for the customer to finish paying online.' : 'Nothing left to do on this order.'}
                  </span>
                ) : (
                  <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                    {order.allowedActions.map((action) => {
                      const spec = ACTIONS[action] ?? { label: action, style: 'btn-secondary' };
                      return (
                        <button key={action} className={`btn ${spec.style}`} onClick={() => run(action)} disabled={act.isPending}>
                          {spec.icon} {spec.label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {order.history && order.history.length > 0 && (
                <div style={{ marginTop: 'var(--space-4)' }}>
                  <h3 style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--font-semibold)', marginBottom: 'var(--space-2)' }}>History</h3>
                  <ol style={{ margin: 0, paddingLeft: 'var(--space-5)', fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>
                    {order.history.map((entry, index) => (
                      <li key={index}>{formatDateTime(entry.at)} — {entry.status.replace(/_/g, ' ')} ({WHO[entry.changedBy] ?? entry.changedBy}){entry.note ? `: ${entry.note}` : ''}</li>
                    ))}
                  </ol>
                </div>
              )}
            </>
          )}
        </div>
        <div className="dialog-footer"><button className="btn btn-secondary" onClick={onClose} disabled={act.isPending}>Close</button></div>
      </div>
    </div>
  );
}
