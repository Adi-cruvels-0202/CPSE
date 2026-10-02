import React, { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../hooks/useAuth';
import { useActiveStore } from '../../hooks/useStore';
import { dashboardApi, storeApi } from '../../api/endpoints';
import { IconStore, IconTrendingUp, IconPackage, IconAlertTriangle, IconPlus, IconClipboard, IconCart, IconExternalLink, IconGlobe } from '../../components/icons/Icons';
import { Navigate } from 'react-router-dom';
import './Dashboard.css';

export default function DashboardPage() {
  const { user } = useAuth();
  const { activeStoreId, setActiveStoreId } = useActiveStore();

  const { data: storesRes, isLoading: loadingStores } = useQuery({ queryKey: ['stores'], queryFn: () => storeApi.list() });
  const stores = storesRes?.data?.data || [];

  useEffect(() => {
    if (stores.length > 0 && !activeStoreId) setActiveStoreId(stores[0].id);
  }, [stores, activeStoreId, setActiveStoreId]);

  const currentStore = stores.find((s: any) => s.id === activeStoreId);

  const { data: metricsRes } = useQuery({
    queryKey: ['dashboardMetrics', activeStoreId],
    queryFn: () => dashboardApi.metrics(activeStoreId!),
    enabled: !!activeStoreId,
    refetchInterval: 60000,
  });
  const metrics = metricsRes?.data?.data || {};

  const getGreeting = () => {
    const h = new Date().getHours();
    return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  };

  // If we finished loading stores and the user has none, redirect to store creation
  if (!loadingStores && stores.length === 0) {
    return <Navigate to="/store/new" replace />;
  }

  // Fallback while loading
  if (!activeStoreId) {
    return (
      <div className="dashboard">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
          <div className="spinner spinner-lg" />
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard">
      {/* Welcome strip */}
      <div className="dashboard-welcome">
        <div>
          <h1 className="page-title">{getGreeting()}, {user?.name?.split(' ')[0]}</h1>
          <div className="dashboard-store-status">
            <span className={`status-dot ${currentStore?.isPublished ? 'status-dot-success' : 'status-dot-neutral'}`} />
            <span>{currentStore?.name}</span>
            <span className="dashboard-store-badge">{currentStore?.isPublished ? 'Published' : 'Draft'}</span>
          </div>
        </div>
        <div className="dashboard-actions">
          <a href="/sales/new" className="btn btn-primary">
            <IconPlus size={16} />
            New Sale
          </a>
          {currentStore?.isPublished && currentStore?.slug && (
            <a href={`/shop/${currentStore.slug}`} target="_blank" rel="noopener noreferrer" className="btn btn-secondary">
              <IconGlobe size={16} />
              Storefront
              <IconExternalLink size={13} />
            </a>
          )}
        </div>
      </div>

      {/* Primary metrics — horizontal strip */}
      <div className="dashboard-metrics">
        <div className="dashboard-metric-hero">
          <span className="stat-label">Today's Revenue</span>
          <span className="metric-md">₹{Number(metrics.todayRevenue || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
          <span className="stat-footnote">{metrics.todaySales || 0} sales today</span>
        </div>
        <div className="dashboard-metric-divider" />
        <div className="stat-item">
          <span className="stat-label">This Month</span>
          <span className="stat-value">₹{Number(metrics.monthRevenue || 0).toLocaleString('en-IN', { minimumFractionDigits: 0 })}</span>
          <span className="stat-footnote">{metrics.monthSales || 0} sales</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">Products</span>
          <span className="stat-value">{metrics.totalProducts || 0}</span>
          <span className="stat-footnote">in catalogue</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">Low Stock</span>
          <span className="stat-value" style={{ color: (metrics.lowStockCount || 0) > 0 ? 'var(--color-warning)' : undefined }}>
            {metrics.lowStockCount || 0}
          </span>
          <span className="stat-footnote">below threshold</span>
        </div>
      </div>

      {/* Operational grid */}
      <div className="dashboard-grid">
        {/* Quick actions */}
        <div className="dashboard-section">
          <h3 className="heading-4">Quick Actions</h3>
          <div className="dashboard-quick-actions">
            <a href="/sales/new" className="dashboard-action-card">
              <div className="dashboard-action-icon"><IconTrendingUp size={20} /></div>
              <div>
                <div className="dashboard-action-title">New Sale</div>
                <div className="dashboard-action-desc">Process a sale</div>
              </div>
            </a>
            <a href="/products" className="dashboard-action-card">
              <div className="dashboard-action-icon"><IconPackage size={20} /></div>
              <div>
                <div className="dashboard-action-title">Products</div>
                <div className="dashboard-action-desc">Manage catalogue</div>
              </div>
            </a>
            <a href="/inventory" className="dashboard-action-card">
              <div className="dashboard-action-icon"><IconClipboard size={20} /></div>
              <div>
                <div className="dashboard-action-title">Inventory</div>
                <div className="dashboard-action-desc">Track stock levels</div>
              </div>
            </a>
            <a href="/purchases" className="dashboard-action-card">
              <div className="dashboard-action-icon"><IconCart size={20} /></div>
              <div>
                <div className="dashboard-action-title">Purchases</div>
                <div className="dashboard-action-desc">Record orders</div>
              </div>
            </a>
          </div>
        </div>

        {/* Store status */}
        <div className="dashboard-section">
          <h3 className="heading-4">Store Details</h3>
          <div className="detail-grid" style={{ marginTop: 'var(--space-4)', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-xl)', padding: 'var(--space-5)' }}>
            <div className="detail-row">
              <span className="detail-label">Status</span>
              <span className={`badge ${currentStore?.isPublished ? 'badge-success' : 'badge-neutral'}`}>
                {currentStore?.isPublished ? 'Published' : 'Draft'}
              </span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Category</span>
              <span style={{ fontWeight: 'var(--font-medium)' }}>{currentStore?.shopCategory || '—'}</span>
            </div>
            {currentStore?.slug && (
              <div className="detail-row">
                <span className="detail-label">Storefront</span>
                <span className="mono" style={{ fontSize: 'var(--text-sm)', color: 'var(--navy)' }}>/shop/{currentStore.slug}</span>
              </div>
            )}
            {currentStore?.phone && (
              <div className="detail-row">
                <span className="detail-label">Phone</span>
                <span style={{ fontWeight: 'var(--font-medium)' }}>{currentStore.phone}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Low stock warning */}
      {(metrics.lowStockCount || 0) > 0 && (
        <div className="alert-strip alert-strip-warning" style={{ marginTop: 'var(--space-6)' }}>
          <IconAlertTriangle size={18} />
          <span>{metrics.lowStockCount} product{metrics.lowStockCount !== 1 ? 's' : ''} below stock threshold — </span>
          <a href="/inventory" style={{ fontWeight: 'var(--font-semibold)', color: 'inherit', textDecoration: 'underline' }}>
            Review inventory
          </a>
        </div>
      )}
    </div>
  );
}
