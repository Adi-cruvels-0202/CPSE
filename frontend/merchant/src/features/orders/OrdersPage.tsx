import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { orderApi } from '../../api/endpoints';
import { useActiveStore } from '../../hooks/useStore';
import { formatPaise } from '../../lib/money';
import { EmptyState, NoStore, OrderStatusBadge, Pagination, Spinner, formatDateTime } from '../../components/common/ui';
import { IconCart } from '../../components/icons/Icons';
import OrderDetailModal from './OrderDetailModal';

/**
 * Online orders, newest first, in tabs by where they are. Orders still waiting
 * for an online payment are left out until paid — there is nothing to do with
 * them yet.
 */

const TABS: { id: string; label: string; statuses: string[] }[] = [
  { id: 'new', label: 'New', statuses: ['placed'] },
  { id: 'active', label: 'In progress', statuses: ['accepted', 'preparing', 'ready_for_pickup', 'out_for_delivery'] },
  { id: 'done', label: 'Completed', statuses: ['completed'] },
  { id: 'closed', label: 'Rejected / cancelled', statuses: ['rejected', 'cancelled'] },
  { id: 'all', label: 'All', statuses: [] },
];

export default function OrdersPage() {
  const { activeStoreId } = useActiveStore();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState('new');
  const [page, setPage] = useState(1);
  const openId = params.get('open');

  const statuses = TABS.find((t) => t.id === tab)!.statuses;
  const { data, isLoading } = useQuery({
    queryKey: ['orders', activeStoreId, tab, page],
    queryFn: () => orderApi.list(activeStoreId!, { status: statuses.join(',') || undefined, page, limit: 20 }),
    enabled: !!activeStoreId,
    refetchInterval: 30_000,
  });

  if (!activeStoreId) return <NoStore title="Online orders" />;

  const orders = data?.data.orders ?? [];
  const counts = data?.data.counts ?? {};
  const countFor = (t: (typeof TABS)[number]) => (t.statuses.length === 0 ? null : t.statuses.reduce((sum, s) => sum + (counts[s] ?? 0), 0));
  const open = (id: string | null) => setParams(id ? { open: id } : {}, { replace: true });

  return (
    <div>
      <div className="page-header">
        <div><h1 className="page-title">Online orders</h1><p className="page-subtitle">Accept, prepare and complete what customers order from your store</p></div>
      </div>

      <div className="tabs" role="tablist">
        {TABS.map((t) => {
          const count = countFor(t);
          return (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={`tab ${tab === t.id ? 'tab-active' : ''}`} onClick={() => { setTab(t.id); setPage(1); }}>
              {t.label}{count ? ` (${count})` : ''}
            </button>
          );
        })}
      </div>

      <div style={{ marginTop: 'var(--space-6)' }}>
        {isLoading ? <Spinner large /> : orders.length === 0 ? (
          <EmptyState icon={<IconCart size={32} />} title="No orders here" description={tab === 'new' ? 'New orders show up here — this page checks every 30 seconds.' : undefined} />
        ) : (
          <>
            <div className="table-container">
              <table className="table orders-table">
                <thead><tr><th>Order</th><th>Placed</th><th>Customer</th><th>Pickup / delivery</th><th>Paid by</th><th>Status</th><th>Total</th></tr></thead>
                <tbody>
                  {orders.map((order) => (
                    <tr key={order.id} onClick={() => open(order.id)} style={{ cursor: 'pointer' }} className="hoverable-row">
                      <td style={{ fontWeight: 'var(--font-semibold)' }}>{order.orderNumber}</td>
                      <td style={{ fontSize: 'var(--text-xs)', whiteSpace: 'nowrap' }}>{formatDateTime(order.placedAt)}</td>
                      <td>
                        <div>{order.customer.name ?? '—'}</div>
                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)' }}>{order.customer.phone}</div>
                      </td>
                      <td><span className="badge badge-neutral">{order.fulfilmentMode === 'delivery' ? 'Delivery' : 'Pickup'}</span></td>
                      <td>{order.paymentMethod === 'online' ? `Online (${order.paymentStatus})` : 'Cash'}</td>
                      <td><OrderStatusBadge status={order.status} label={order.statusLabel} /></td>
                      <td style={{ fontWeight: 'var(--font-bold)', whiteSpace: 'nowrap' }}>{formatPaise(order.totals.totalPaise)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination meta={data?.meta} onPage={setPage} />
          </>
        )}
      </div>

      {openId && <OrderDetailModal storeId={activeStoreId} orderId={openId} onClose={() => open(null)} />}
    </div>
  );
}
