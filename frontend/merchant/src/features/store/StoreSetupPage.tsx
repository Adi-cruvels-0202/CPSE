import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { storeApi } from '../../api/endpoints';
import { useActiveStore } from '../../hooks/useStore';
import { useToast } from '../../hooks/useToast';
import './StoreSetup.css';

export default function StoreSetupPage({ isNewStore = false }: { isNewStore?: boolean }) {
  const { activeStoreId, setActiveStoreId } = useActiveStore();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const getInitialTab = (path: string) => {
    if (path.includes('hours')) return 'hours';
    if (path.includes('delivery')) return 'delivery';
    if (path.includes('payments')) return 'payments';
    if (path.includes('storefront')) return 'branding';
    return 'basic';
  };
  const [activeTab, setActiveTab] = useState(() => getInitialTab(location.pathname));

  useEffect(() => {
    setActiveTab(getInitialTab(location.pathname));
  }, [location.pathname]);

  const handleTabChange = (tabId: string) => {
    setActiveTab(tabId);
    if (tabId === 'basic') navigate('/store/setup', { replace: true });
    else if (tabId === 'branding') navigate('/store/storefront', { replace: true });
    else navigate(`/store/${tabId}`, { replace: true });
  };

  const { data: storesRes, isLoading: loadingStores } = useQuery({
    queryKey: ['stores'],
    queryFn: () => storeApi.list(),
  });

  const stores = storesRes?.data?.data || [];
  const currentStore = stores.find((s: any) => s.id === activeStoreId) || stores[0];

  useEffect(() => {
    if (stores.length > 0 && !activeStoreId && !isNewStore) {
      setActiveStoreId(stores[0].id);
    }
  }, [stores, activeStoreId, setActiveStoreId, isNewStore]);

  if (loadingStores) {
    return (
      <div>
        <div className="page-header"><div><h1 className="page-title">Store Setup</h1></div></div>
        <div className="card"><div style={{ padding: '40px', textAlign: 'center' }}><div className="spinner spinner-lg" /></div></div>
      </div>
    );
  }

  if (isNewStore || stores.length === 0) {
    return <CreateStoreView />;
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Store Setup</h1>
          <p className="page-subtitle">Configure your store details and settings</p>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
          {currentStore && currentStore.slug && (
            <a href={`/shop/${currentStore.slug}`} target="_blank" rel="noopener noreferrer" className="btn btn-secondary" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
              Preview Storefront
            </a>
          )}
          {currentStore && !currentStore.isPublished && (
            <PublishButton storeId={currentStore.id} />
          )}
          {currentStore && currentStore.isPublished && (
            <UnpublishButton storeId={currentStore.id} />
          )}
        </div>
      </div>

      <div className="tabs" role="tablist">
        {[
          { id: 'basic', label: 'Basic Info' },
          { id: 'hours', label: 'Business Hours' },
          { id: 'delivery', label: 'Delivery' },
          { id: 'payments', label: 'Payments' },
          { id: 'branding', label: 'Branding' },
        ].map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={activeTab === tab.id}
            className={`tab ${activeTab === tab.id ? 'tab-active' : ''}`}
            onClick={() => handleTabChange(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div style={{ marginTop: 'var(--space-6)' }}>
        {activeTab === 'basic' && currentStore && <BasicInfoTab store={currentStore} />}
        {activeTab === 'hours' && currentStore && <HoursTab storeId={currentStore.id} />}
        {activeTab === 'delivery' && currentStore && <DeliveryTab storeId={currentStore.id} />}
        {activeTab === 'payments' && currentStore && <PaymentsTab storeId={currentStore.id} />}
        {activeTab === 'branding' && currentStore && <BrandingTab store={currentStore} />}
      </div>
    </div>
  );
}

// ========== Create Store View ==========
function CreateStoreView() {
  const { showToast } = useToast();
  const { setActiveStoreId } = useActiveStore();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', description: '', shopCategory: 'GENERAL', address: '', phone: '', email: '' });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const res = await storeApi.create(form);
      setActiveStoreId(res.data.data.id);
      queryClient.invalidateQueries({ queryKey: ['stores'] });
      showToast('Store created successfully!', 'success');
      navigate('/store/setup', { replace: true });
    } catch (err: any) {
      showToast(err.response?.data?.error?.message || 'Failed to create store', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div>
      <div className="page-header"><div><h1 className="page-title">Create Your Store</h1><p className="page-subtitle">Set up your store to start selling</p></div></div>
      <div className="card">
        <form onSubmit={handleSubmit} className="form-grid">
          <div className="input-wrapper">
            <label className="input-label" htmlFor="storeName">Store Name *</label>
            <input id="storeName" className="input-field" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Mohit's Grocery" />
          </div>
          <div className="input-wrapper">
            <label className="input-label" htmlFor="storeDesc">Description</label>
            <textarea id="storeDesc" className="input-field textarea-field" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Tell customers about your store" />
          </div>
          <div className="form-row">
            <div className="input-wrapper">
              <label className="input-label" htmlFor="category">Category</label>
              <select id="category" className="input-field select-field" value={form.shopCategory} onChange={(e) => setForm({ ...form, shopCategory: e.target.value })}>
                {['GROCERY','PHARMACY','RESTAURANT','BAKERY','ELECTRONICS','CLOTHING','GENERAL','OTHER'].map(c => <option key={c} value={c}>{c.charAt(0) + c.slice(1).toLowerCase()}</option>)}
              </select>
            </div>
            <div className="input-wrapper">
              <label className="input-label" htmlFor="phone">Phone</label>
              <input id="phone" className="input-field" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+91..." />
            </div>
          </div>
          <div className="input-wrapper">
            <label className="input-label" htmlFor="address">Address</label>
            <input id="address" className="input-field" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Store address" />
          </div>
          <div className="input-wrapper">
            <label className="input-label" htmlFor="storeEmail">Email</label>
            <input id="storeEmail" type="email" className="input-field" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="store@example.com" />
          </div>
          <button type="submit" className="btn btn-primary btn-lg" disabled={isSubmitting} style={{ marginTop: 'var(--space-2)' }}>
            {isSubmitting ? <><span className="spinner spinner-sm" /> Creating...</> : 'Create Store'}
          </button>
        </form>
      </div>
    </div>
  );
}

// ========== Basic Info Tab ==========
function BasicInfoTab({ store }: { store: any }) {
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    name: store.name || '', description: store.description || '', shopCategory: store.shopCategory || 'GENERAL',
    address: store.address || '', phone: store.phone || '', email: store.email || '',
    latitude: store.latitude || '', longitude: store.longitude || '', pickupEnabled: store.pickupEnabled || false,
  });
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      await storeApi.update(store.id, form);
      queryClient.invalidateQueries({ queryKey: ['stores'] });
      showToast('Store updated', 'success');
    } catch (err: any) {
      showToast(err.response?.data?.error?.message || 'Failed to update', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <form onSubmit={handleSave}>
      <div className="setup-section">
        <div className="setup-section-header">
          <h2 className="setup-section-title">Identity</h2>
          <p className="setup-section-desc">The basic details of your store that customers will see.</p>
        </div>
        <div className="setup-section-content">
          <div className="form-row">
            <div className="input-wrapper">
              <label className="input-label">Store Name *</label>
              <input className="input-field" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="input-wrapper">
              <label className="input-label">Category</label>
              <select className="input-field select-field" value={form.shopCategory} onChange={(e) => setForm({ ...form, shopCategory: e.target.value })}>
                {['GROCERY','PHARMACY','RESTAURANT','BAKERY','ELECTRONICS','CLOTHING','GENERAL','OTHER'].map(c => <option key={c} value={c}>{c.charAt(0) + c.slice(1).toLowerCase()}</option>)}
              </select>
            </div>
          </div>
          <div className="input-wrapper">
            <label className="input-label">Description</label>
            <textarea className="input-field textarea-field" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
        </div>
      </div>

      <div className="setup-section">
        <div className="setup-section-header">
          <h2 className="setup-section-title">Contact</h2>
          <p className="setup-section-desc">How customers can reach out to you directly.</p>
        </div>
        <div className="setup-section-content">
          <div className="form-row">
            <div className="input-wrapper">
              <label className="input-label">Phone</label>
              <input className="input-field" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </div>
            <div className="input-wrapper">
              <label className="input-label">Email</label>
              <input type="email" className="input-field" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
          </div>
        </div>
      </div>

      <div className="setup-section">
        <div className="setup-section-header">
          <h2 className="setup-section-title">Location & Pickup</h2>
          <p className="setup-section-desc">Your physical store address and pickup preferences.</p>
        </div>
        <div className="setup-section-content">
          <div className="input-wrapper">
            <label className="input-label">Address</label>
            <input className="input-field" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </div>
          <label className="switch" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginTop: 'var(--space-2)' }}>
            <input type="checkbox" className="switch-input" checked={form.pickupEnabled} onChange={(e) => setForm({ ...form, pickupEnabled: e.target.checked })} />
            <span className="switch-slider" />
            <span style={{ fontSize: 'var(--text-sm)' }}>Enable store pickup for online orders</span>
          </label>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', padding: 'var(--space-6) 0' }}>
        <button type="submit" className="btn btn-primary btn-lg" disabled={isSaving}>
          {isSaving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </form>
  );
}

// ========== Business Hours Tab ==========
function HoursTab({ storeId }: { storeId: string }) {
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const days = ['MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY','SUNDAY'];
  
  const { data: hoursRes, isLoading } = useQuery({
    queryKey: ['storeHours', storeId],
    queryFn: () => storeApi.getHours(storeId),
  });

  const [hours, setHours] = useState<any[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (hoursRes?.data?.data) {
      setHours(hoursRes.data.data);
    } else {
      setHours(days.map(d => ({ dayOfWeek: d, openingTime: '09:00', closingTime: '21:00', closed: d === 'SUNDAY' })));
    }
  }, [hoursRes]);

  const updateHour = (index: number, field: string, value: any) => {
    const updated = [...hours];
    updated[index] = { ...updated[index], [field]: value };
    setHours(updated);
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await storeApi.updateHours(storeId, hours);
      queryClient.invalidateQueries({ queryKey: ['storeHours', storeId] });
      showToast('Business hours updated', 'success');
    } catch (err: any) {
      showToast(err.response?.data?.error?.message || 'Failed to update hours', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) return <div className="card"><div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" /></div></div>;

  return (
    <div className="setup-section">
      <div className="setup-section-header">
        <h2 className="setup-section-title">Weekly Schedule</h2>
        <p className="setup-section-desc">Define when your store is open and accepting orders.</p>
      </div>
      <div className="setup-section-content">
        <div className="hours-grid">
          {hours.map((h: any, i: number) => (
            <div key={h.dayOfWeek} className="hours-row">
              <span className="hours-day">{h.dayOfWeek.charAt(0) + h.dayOfWeek.slice(1).toLowerCase()}</span>
              <label className="switch" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <input type="checkbox" className="switch-input" checked={!h.closed} onChange={(e) => updateHour(i, 'closed', !e.target.checked)} />
                <span className="switch-slider" />
              </label>
              {!h.closed ? (
                <div className="hours-times">
                  <input type="time" className="input-field" style={{ width: 130 }} value={h.openingTime || '09:00'} onChange={(e) => updateHour(i, 'openingTime', e.target.value)} />
                  <span style={{ color: 'var(--color-text-tertiary)' }}>to</span>
                  <input type="time" className="input-field" style={{ width: 130 }} value={h.closingTime || '21:00'} onChange={(e) => updateHour(i, 'closingTime', e.target.value)} />
                </div>
              ) : (
                <span className="badge badge-neutral">Closed</span>
              )}
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--space-2)' }}>
          <button className="btn btn-primary" onClick={handleSave} disabled={isSaving}>{isSaving ? 'Saving...' : 'Save Hours'}</button>
        </div>
      </div>
    </div>
  );
}

// ========== Delivery Tab ==========
function DeliveryTab({ storeId }: { storeId: string }) {
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const { data: delRes, isLoading } = useQuery({
    queryKey: ['delivery', storeId],
    queryFn: () => storeApi.getDelivery(storeId),
  });

  const [form, setForm] = useState({ enabled: false, deliveryRadius: '', deliveryFee: '', minimumOrder: '', freeDeliveryThreshold: '' });
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (delRes?.data?.data) {
      const d = delRes.data.data;
      setForm({
        enabled: d.enabled || false,
        deliveryRadius: d.deliveryRadius?.toString() || '',
        deliveryFee: d.deliveryFee?.toString() || '',
        minimumOrder: d.minimumOrder?.toString() || '',
        freeDeliveryThreshold: d.freeDeliveryThreshold?.toString() || '',
      });
    }
  }, [delRes]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await storeApi.updateDelivery(storeId, {
        enabled: form.enabled,
        deliveryRadius: form.deliveryRadius ? parseFloat(form.deliveryRadius) : null,
        deliveryFee: form.deliveryFee ? parseFloat(form.deliveryFee) : null,
        minimumOrder: form.minimumOrder ? parseFloat(form.minimumOrder) : null,
        freeDeliveryThreshold: form.freeDeliveryThreshold ? parseFloat(form.freeDeliveryThreshold) : null,
      });
      queryClient.invalidateQueries({ queryKey: ['delivery', storeId] });
      showToast('Delivery settings updated', 'success');
    } catch (err: any) {
      showToast(err.response?.data?.error?.message || 'Failed to update', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) return <div className="card"><div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" /></div></div>;

  return (
    <div className="setup-section">
      <div className="setup-section-header">
        <h2 className="setup-section-title">Delivery Configuration</h2>
        <p className="setup-section-desc">Manage your delivery zones, fees, and order minimums.</p>
      </div>
      <div className="setup-section-content">
        <label className="switch" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <input type="checkbox" className="switch-input" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
          <span className="switch-slider" />
          <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--font-medium)' }}>Enable delivery services</span>
        </label>
        {form.enabled && (
          <div style={{ marginTop: 'var(--space-2)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            <div className="form-row">
              <div className="input-wrapper">
                <label className="input-label">Delivery Radius (km)</label>
                <input type="number" min="0" step="0.1" className="input-field" value={form.deliveryRadius} onChange={(e) => setForm({ ...form, deliveryRadius: e.target.value })} />
              </div>
              <div className="input-wrapper">
                <label className="input-label">Delivery Fee (₹)</label>
                <input type="number" min="0" step="0.01" className="input-field" value={form.deliveryFee} onChange={(e) => setForm({ ...form, deliveryFee: e.target.value })} />
              </div>
            </div>
            <div className="form-row">
              <div className="input-wrapper">
                <label className="input-label">Minimum Order (₹)</label>
                <input type="number" min="0" step="0.01" className="input-field" value={form.minimumOrder} onChange={(e) => setForm({ ...form, minimumOrder: e.target.value })} />
              </div>
              <div className="input-wrapper">
                <label className="input-label">Free Delivery Above (₹)</label>
                <input type="number" min="0" step="0.01" className="input-field" value={form.freeDeliveryThreshold} onChange={(e) => setForm({ ...form, freeDeliveryThreshold: e.target.value })} />
              </div>
            </div>
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--space-2)' }}>
          <button className="btn btn-primary" onClick={handleSave} disabled={isSaving}>{isSaving ? 'Saving...' : 'Save Delivery Settings'}</button>
        </div>
      </div>
    </div>
  );
}

// ========== Payments Tab ==========
function PaymentsTab({ storeId }: { storeId: string }) {
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const methods = ['CASH', 'UPI', 'CARD', 'NET_BANKING'];
  const labels: Record<string, string> = { CASH: 'Cash', UPI: 'UPI', CARD: 'Card', NET_BANKING: 'Net Banking' };

  const { data: payRes, isLoading } = useQuery({
    queryKey: ['payments', storeId],
    queryFn: () => storeApi.getPayments(storeId),
  });

  const [prefs, setPrefs] = useState<Record<string, boolean>>({});
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (payRes?.data?.data) {
      const map: Record<string, boolean> = {};
      payRes.data.data.forEach((p: any) => { map[p.paymentMethod] = p.enabled; });
      methods.forEach(m => { if (!(m in map)) map[m] = false; });
      setPrefs(map);
    }
  }, [payRes]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const data = methods.map(m => ({ paymentMethod: m, enabled: prefs[m] || false }));
      await storeApi.updatePayments(storeId, data);
      queryClient.invalidateQueries({ queryKey: ['payments', storeId] });
      showToast('Payment preferences updated', 'success');
    } catch (err: any) {
      showToast(err.response?.data?.error?.message || 'Failed to update', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) return <div className="card"><div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" /></div></div>;

  return (
    <div className="setup-section">
      <div className="setup-section-header">
        <h2 className="setup-section-title">Payment Methods</h2>
        <p className="setup-section-desc">Select which payment methods you accept.</p>
      </div>
      <div className="setup-section-content">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          {methods.map(m => (
            <label key={m} className="switch" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
              <input type="checkbox" className="switch-input" checked={prefs[m] || false} onChange={(e) => setPrefs({ ...prefs, [m]: e.target.checked })} />
              <span className="switch-slider" />
              <span style={{ fontSize: 'var(--text-md)', fontWeight: 'var(--font-medium)' }}>{labels[m]}</span>
            </label>
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--space-2)' }}>
          <button className="btn btn-primary" onClick={handleSave} disabled={isSaving}>{isSaving ? 'Saving...' : 'Save Payment Preferences'}</button>
        </div>
      </div>
    </div>
  );
}

// ========== Branding Tab ==========
function BrandingTab({ store }: { store: any }) {
  const { showToast } = useToast();
  const queryClient = useQueryClient();

  const handleUpload = async (type: 'logo' | 'cover', file: File) => {
    try {
      if (type === 'logo') await storeApi.uploadLogo(store.id, file);
      else await storeApi.uploadCover(store.id, file);
      queryClient.invalidateQueries({ queryKey: ['stores'] });
      showToast(`${type === 'logo' ? 'Logo' : 'Cover image'} uploaded`, 'success');
    } catch (err: any) {
      showToast(err.response?.data?.error?.message || 'Upload failed', 'error');
    }
  };

  return (
    <div className="setup-section">
      <div className="setup-section-header">
        <h2 className="setup-section-title">Store Branding</h2>
        <p className="setup-section-desc">Upload your logo and cover image for the storefront.</p>
      </div>
      <div className="setup-section-content">
        <div className="form-row" style={{ alignItems: 'flex-start' }}>
          <div className="input-wrapper">
            <label className="input-label">Logo</label>
            {store.logoUrl && <img src={store.logoUrl} alt="Store logo" style={{ width: 80, height: 80, borderRadius: 'var(--radius-lg)', objectFit: 'cover', marginBottom: 'var(--space-2)', border: '1px solid var(--color-border)' }} />}
            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => { if (e.target.files?.[0]) handleUpload('logo', e.target.files[0]); }} />
            <span className="input-helper">JPEG, PNG, or WebP. Max 5MB.</span>
          </div>
          <div className="input-wrapper">
            <label className="input-label">Cover Image</label>
            {store.coverImageUrl && <img src={store.coverImageUrl} alt="Store cover" style={{ width: '100%', height: 120, borderRadius: 'var(--radius-lg)', objectFit: 'cover', marginBottom: 'var(--space-2)', border: '1px solid var(--color-border)' }} />}
            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => { if (e.target.files?.[0]) handleUpload('cover', e.target.files[0]); }} />
            <span className="input-helper">JPEG, PNG, or WebP. Max 5MB. Recommended 1200×400.</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ========== Publish / Unpublish Buttons ==========
function PublishButton({ storeId }: { storeId: string }) {
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(false);

  const handlePublish = async () => {
    setLoading(true);
    try {
      await storeApi.publish(storeId);
      queryClient.invalidateQueries({ queryKey: ['stores'] });
      showToast('Store published!', 'success');
    } catch (err: any) {
      showToast(err.response?.data?.error?.message || 'Failed to publish', 'error');
    } finally {
      setLoading(false);
    }
  };

  return <button className="btn btn-success" onClick={handlePublish} disabled={loading}>{loading ? 'Publishing...' : '● Publish Store'}</button>;
}

function UnpublishButton({ storeId }: { storeId: string }) {
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(false);

  const handleUnpublish = async () => {
    if (!window.confirm('Are you sure you want to unpublish your store? It will no longer be visible to customers.')) return;
    setLoading(true);
    try {
      await storeApi.unpublish(storeId);
      queryClient.invalidateQueries({ queryKey: ['stores'] });
      showToast('Store unpublished', 'info');
    } catch (err: any) {
      showToast(err.response?.data?.error?.message || 'Failed to unpublish', 'error');
    } finally {
      setLoading(false);
    }
  };

  return <button className="btn btn-secondary" onClick={handleUnpublish} disabled={loading}>{loading ? 'Unpublishing...' : 'Unpublish Store'}</button>;
}
