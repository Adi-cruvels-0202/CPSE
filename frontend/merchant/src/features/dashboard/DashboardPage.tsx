import { useQuery } from '@tanstack/react-query';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { useActiveStore } from '../../hooks/useStore';
import { dashboardApi } from '../../api/endpoints';
import { errorMessage } from '../../api/client';
import { formatPaise } from '../../lib/money';
import { Spinner, OrderStatusBadge, formatDateTime } from '../../components/common/ui';
import { IconTrendingUp, IconPackage, IconAlertTriangle, IconPlus, IconClipboard, IconCart, IconExternalLink, IconGlobe } from '../../components/icons/Icons';
import './Dashboard.css';

export default function DashboardPage() {
  const { merchant, stores, status } = useAuth();
  const { activeStoreId } = useActiveStore();
  const currentStore = stores.find((s) => s.id === activeStoreId);

  const { data, isLoading, error } = useQuery({
    queryKey: ['dashboard', activeStoreId],
    queryFn: () => dashboardApi.get(activeStoreId!),
    enabled: !!activeStoreId,
    // New orders arrive while the shopkeeper is looking at this.
    refetchInterval: 30_000,
  });
  const dashboard = data?.dashboard;

  // A merchant with no store yet starts by creating one.
  if (status === 'merchant' && stores.length === 0) return <Navigate to="/store/new" replace />;
  if (!activeStoreId || isLoading) return <div className="dashboard"><Spinner large /></div>;

  const greeting = (() => {
    const hour = new Date().getHours();
    return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  })();
  const firstName = (merchant?.fullName ?? '').split(' ')[0];
  const waiting = dashboard ? dashboard.openOrders.placed : 0;

  return (
    <div className="dashboard">
      <div className="dashboard-welcome">
        <div>
          <h1 className="page-title">{greeting}{firstName ? `, ${firstName}` : ''}</h1>
          <div className="dashboard-store-status">
            <span className={`status-dot ${currentStore?.isPublished ? 'status-dot-success' : 'status-dot-neutral'}`} />
            <span>{currentStore?.name}</span>
            <span className="dashboard-store-badge">{currentStore?.isPublished ? 'Published' : 'Not published yet'}</span>
          </div>
        </div>
        <div className="dashboard-actions">
          <Link to="/sales/new" className="btn btn-primary"><IconPlus size={16} /> New counter sale</Link>
          {currentStore?.isPublished && (
            <a href={`/store/${currentStore.slug}`} target="_blank" rel="noopener noreferrer" className="btn btn-secondary">
              <IconGlobe size={16} /> View store <IconExternalLink size={13} />
            </a>
          )}
        </div>
      </div>

      {error && <div className="alert-strip alert-strip-warning" role="alert">{errorMessage(error)}</div>}

      {dashboard && (
        <>
          {waiting > 0 && (
            <div className="alert-strip alert-strip-warning" style={{ marginBottom: 'var(--space-6)' }}>
              <IconCart size={18} />
              <span>{waiting} new order{waiting === 1 ? '' : 's'} waiting for you — </span>
              <Link to="/orders" style={{ fontWeight: 'var(--font-semibold)', color: 'inherit', textDecoration: 'underline' }}>Review orders</Link>
            </div>
          )}

          <div className="dashboard-metrics">
            <div className="dashboard-metric-hero">
              <span className="stat-label">Today's takings</span>
              <span className="metric-md">{formatPaise(dashboard.today.ordersRevenuePaise + dashboard.today.salesRevenuePaise)}</span>
              <span className="stat-footnote">online orders and counter sales</span>
            </div>
            <div className="dashboard-metric-divider" />
            <div className="stat-item">
              <span className="stat-label">Online orders</span>
              <span className="stat-value">{dashboard.today.ordersCount}</span>
              <span className="stat-footnote">{formatPaise(dashboard.today.ordersRevenuePaise, { decimals: 0 })} today</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Counter sales</span>
              <span className="stat-value">{dashboard.today.salesCount}</span>
              <span className="stat-footnote">{formatPaise(dashboard.today.salesRevenuePaise, { decimals: 0 })} today</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Low stock</span>
              <span className="stat-value" style={{ color: dashboard.lowStock.length > 0 ? 'var(--color-warning)' : undefined }}>{dashboard.lowStock.length}</span>
              <span className="stat-footnote">at or below threshold</span>
            </div>
          </div>

          <div className="dashboard-grid">
            <div className="dashboard-section">
              <h3 className="heading-4">Orders in progress</h3>
              <div className="detail-grid" style={{ marginTop: 'var(--space-4)', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-xl)', padding: 'var(--space-5)' }}>
                {([
                  ['New — needs accepting', dashboard.openOrders.placed],
                  ['Accepted', dashboard.openOrders.accepted],
                  ['Being prepared', dashboard.openOrders.preparing],
                  ['Ready / out for delivery', dashboard.openOrders.ready],
                ] as const).map(([label, count]) => (
                  <div className="detail-row" key={label}>
                    <span className="detail-label">{label}</span>
                    <span style={{ fontWeight: 'var(--font-semibold)' }}>{count}</span>
                  </div>
                ))}
              </div>

              <h3 className="heading-4" style={{ marginTop: 'var(--space-6)' }}>Quick actions</h3>
              <div className="dashboard-quick-actions">
                <Link to="/sales/new" className="dashboard-action-card">
                  <div className="dashboard-action-icon"><IconTrendingUp size={20} /></div>
                  <div><div className="dashboard-action-title">Counter sale</div><div className="dashboard-action-desc">Bill a walk-in customer</div></div>
                </Link>
                <Link to="/products" className="dashboard-action-card">
                  <div className="dashboard-action-icon"><IconPackage size={20} /></div>
                  <div><div className="dashboard-action-title">Products</div><div className="dashboard-action-desc">Manage the catalogue</div></div>
                </Link>
                <Link to="/inventory" className="dashboard-action-card">
                  <div className="dashboard-action-icon"><IconClipboard size={20} /></div>
                  <div><div className="dashboard-action-title">Stock</div><div className="dashboard-action-desc">Receive and count stock</div></div>
                </Link>
                <Link to="/orders" className="dashboard-action-card">
                  <div className="dashboard-action-icon"><IconCart size={20} /></div>
                  <div><div className="dashboard-action-title">Online orders</div><div className="dashboard-action-desc">Accept and fulfil</div></div>
                </Link>
              </div>
            </div>

            <div className="dashboard-section">
              <h3 className="heading-4">Recent orders</h3>
              {dashboard.recentOrders.length === 0 ? (
                <p className="body-sm" style={{ marginTop: 'var(--space-4)', color: 'var(--color-text-secondary)' }}>No online orders yet.</p>
              ) : (
                <div className="table-container" style={{ marginTop: 'var(--space-4)' }}>
                  <table className="table">
                    <thead><tr><th>Order</th><th>Placed</th><th>Status</th><th>Total</th></tr></thead>
                    <tbody>
                      {dashboard.recentOrders.map((order) => (
                        <tr key={order.id}>
                          <td style={{ fontWeight: 'var(--font-semibold)' }}><Link to={`/orders?open=${order.id}`}>{order.orderNumber}</Link></td>
                          <td style={{ fontSize: 'var(--text-xs)' }}>{formatDateTime(order.placedAt)}</td>
                          <td><OrderStatusBadge status={order.status} label={order.statusLabel} /></td>
                          <td style={{ fontWeight: 'var(--font-semibold)' }}>{formatPaise(order.totalPaise)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {dashboard.lowStock.length > 0 && (
            <div className="dashboard-section" style={{ marginTop: 'var(--space-6)' }}>
              <div className="alert-strip alert-strip-warning">
                <IconAlertTriangle size={18} />
                <span>Running low — </span>
                <Link to="/inventory" style={{ fontWeight: 'var(--font-semibold)', color: 'inherit', textDecoration: 'underline' }}>restock</Link>
              </div>
              <div className="table-container" style={{ marginTop: 'var(--space-3)' }}>
                <table className="table">
                  <thead><tr><th>Product</th><th>Variant</th><th>Can still sell</th><th>Alert at</th></tr></thead>
                  <tbody>
                    {dashboard.lowStock.map((row) => (
                      <tr key={row.variantId}>
                        <td style={{ fontWeight: 'var(--font-medium)' }}>{row.productName}</td>
                        <td>{row.variantName === 'Default' ? '—' : row.variantName}</td>
                        <td><span className={`badge ${row.availableQuantity <= 0 ? 'badge-danger' : 'badge-warning'}`}>{row.availableQuantity}</span></td>
                        <td>{row.lowStockThreshold}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
