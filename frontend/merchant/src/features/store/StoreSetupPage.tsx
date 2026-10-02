import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { storeApi } from '../../api/endpoints';
import { ApiError, errorMessage } from '../../api/client';
import type { Day, OpeningHours, OpeningWindow, Store } from '../../api/types';
import { useActiveStore } from '../../hooks/useStore';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../hooks/useToast';
import { paiseToRupees, rupeesToPaise } from '../../lib/money';
import { Spinner } from '../../components/common/ui';
import { IconTrash, IconPlus, IconExternalLink } from '../../components/icons/Icons';
import './StoreSetup.css';

const TABS = [
  { id: 'setup', label: 'Store details' },
  { id: 'hours', label: 'Business hours' },
  { id: 'holidays', label: 'Holidays' },
  { id: 'delivery', label: 'Pickup & delivery' },
  { id: 'payments', label: 'Payments' },
  { id: 'branding', label: 'Logo & cover' },
] as const;

const CATEGORIES = ['grocery', 'pharmacy', 'restaurant', 'bakery', 'electronics', 'clothing', 'general', 'other'];
const DAYS: { id: Day; label: string }[] = [
  { id: 'mon', label: 'Monday' }, { id: 'tue', label: 'Tuesday' }, { id: 'wed', label: 'Wednesday' },
  { id: 'thu', label: 'Thursday' }, { id: 'fri', label: 'Friday' }, { id: 'sat', label: 'Saturday' }, { id: 'sun', label: 'Sunday' },
];
const MISSING_LABELS: Record<string, string> = {
  address: 'an address (line 1 and city)',
  phone: 'a phone number',
  openingHours: 'opening hours for at least one day',
  fulfilment: 'pickup or delivery switched on',
};

const capitalise = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

/** A store field, sent as null when cleared rather than as an empty string. */
const orNull = (value: string) => (value.trim() === '' ? null : value.trim());

export default function StoreSetupPage({ isNewStore = false }: { isNewStore?: boolean }) {
  const { activeStoreId } = useActiveStore();
  const { tab = 'setup' } = useParams();
  const navigate = useNavigate();

  const { data, isLoading, error } = useQuery({
    queryKey: ['store', activeStoreId],
    queryFn: () => storeApi.get(activeStoreId!),
    enabled: !!activeStoreId && !isNewStore,
  });

  if (isNewStore || !activeStoreId) return <CreateStoreView />;
  if (isLoading) return <Spinner large />;
  if (error || !data) return <div className="alert-strip alert-strip-warning" role="alert">{errorMessage(error)}</div>;

  const store = data.store;
  const activeTab = TABS.some((t) => t.id === tab) ? tab : 'setup';

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">{store.name}</h1>
          <p className="page-subtitle">
            {store.isPublished ? 'Published — customers can find and order from it.' : 'Not published yet — only you can see it.'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
          {store.isPublished && (
            <a href={store.publicPath} target="_blank" rel="noopener noreferrer" className="btn btn-secondary">
              View store <IconExternalLink size={13} />
            </a>
          )}
          <PublishToggle store={store} />
        </div>
      </div>

      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={activeTab === t.id} className={`tab ${activeTab === t.id ? 'tab-active' : ''}`} onClick={() => navigate(`/store/${t.id}`, { replace: true })}>
            {t.label}
          </button>
        ))}
      </div>

      <div style={{ marginTop: 'var(--space-6)' }}>
        {activeTab === 'setup' && <DetailsTab store={store} />}
        {activeTab === 'hours' && <HoursTab store={store} />}
        {activeTab === 'holidays' && <HolidaysTab store={store} />}
        {activeTab === 'delivery' && <DeliveryTab store={store} />}
        {activeTab === 'payments' && <PaymentsTab store={store} />}
        {activeTab === 'branding' && <BrandingTab store={store} />}
      </div>
    </div>
  );
}

/** After any save: the store, and the list in the nav and switcher. */
function useStoreSaved() {
  const queryClient = useQueryClient();
  const { refresh } = useAuth();
  return async (store: Store) => {
    queryClient.setQueryData(['store', store.id], { store });
    queryClient.invalidateQueries({ queryKey: ['dashboard', store.id] });
    await refresh();
  };
}

// ── Create ───────────────────────────────────────────────────────────────────

function CreateStoreView() {
  const { showToast } = useToast();
  const { setActiveStoreId } = useActiveStore();
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', description: '', shopCategory: 'grocery', phone: '', email: '' });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setIsSubmitting(true);
    try {
      const { store } = await storeApi.create({
        name: form.name.trim(),
        description: orNull(form.description),
        shopCategory: form.shopCategory,
        phone: orNull(form.phone),
        email: orNull(form.email),
      });
      await refresh();
      setActiveStoreId(store.id);
      showToast('Store created. Add an address and hours, then publish it.', 'success');
      navigate('/store/setup', { replace: true });
    } catch (err) {
      showToast(errorMessage(err, 'Could not create the store.'), 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div>
      <div className="page-header"><div><h1 className="page-title">Create your store</h1><p className="page-subtitle">It stays private until you publish it.</p></div></div>
      <div className="card">
        <form onSubmit={handleSubmit} className="form-grid">
          <div className="input-wrapper">
            <label className="input-label" htmlFor="storeName">Store name *</label>
            <input id="storeName" className="input-field" required minLength={2} maxLength={100} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Sharma Kirana Store" autoFocus />
          </div>
          <div className="input-wrapper">
            <label className="input-label" htmlFor="storeDesc">Description</label>
            <textarea id="storeDesc" className="input-field textarea-field" maxLength={1000} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="What do you sell?" />
          </div>
          <div className="form-row">
            <div className="input-wrapper">
              <label className="input-label" htmlFor="category">Type of shop</label>
              <select id="category" className="input-field select-field" value={form.shopCategory} onChange={(e) => setForm({ ...form, shopCategory: e.target.value })}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{capitalise(c)}</option>)}
              </select>
            </div>
            <div className="input-wrapper">
              <label className="input-label" htmlFor="phone">Phone</label>
              <input id="phone" type="tel" className="input-field" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+919876543210" />
            </div>
          </div>
          <div className="input-wrapper">
            <label className="input-label" htmlFor="storeEmail">Email</label>
            <input id="storeEmail" type="email" className="input-field" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="shop@example.com" />
          </div>
          <button type="submit" className="btn btn-primary btn-lg" disabled={isSubmitting} style={{ marginTop: 'var(--space-2)' }}>
            {isSubmitting ? <><span className="spinner spinner-sm" /> Creating…</> : 'Create store'}
          </button>
        </form>
      </div>
    </div>
  );
}

// ── Publish ──────────────────────────────────────────────────────────────────

function PublishToggle({ store }: { store: Store }) {
  const { showToast } = useToast();
  const saved = useStoreSaved();
  const [busy, setBusy] = useState(false);
  const [missing, setMissing] = useState<string[]>([]);

  const toggle = async () => {
    if (store.isPublished && !window.confirm('Unpublish the store? Customers will not be able to open it or order until you publish again. Orders already placed carry on.')) return;
    setBusy(true);
    setMissing([]);
    try {
      const { store: updated } = store.isPublished ? await storeApi.unpublish(store.id) : await storeApi.publish(store.id);
      await saved(updated);
      showToast(updated.isPublished ? 'Published — customers can now see your store.' : 'Store unpublished.', updated.isPublished ? 'success' : 'info');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'STORE_INCOMPLETE') setMissing(err.details?.missing ?? []);
      else showToast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 'var(--space-2)' }}>
      <button className={`btn ${store.isPublished ? 'btn-secondary' : 'btn-success'}`} onClick={toggle} disabled={busy}>
        {busy ? 'Saving…' : store.isPublished ? 'Unpublish' : '● Publish store'}
      </button>
      {missing.length > 0 && (
        <div className="alert-strip alert-strip-warning" role="alert" style={{ maxWidth: 360 }}>
          Before publishing, add {missing.map((m) => MISSING_LABELS[m] ?? m).join(', ')}.
        </div>
      )}
    </div>
  );
}

// ── Details ──────────────────────────────────────────────────────────────────

function DetailsTab({ store }: { store: Store }) {
  const { showToast } = useToast();
  const saved = useStoreSaved();
  const [form, setForm] = useState({
    name: store.name,
    slug: store.slug,
    description: store.description ?? '',
    shopCategory: store.shopCategory ?? 'general',
    phone: store.phone ?? '',
    email: store.email ?? '',
    line1: store.address?.line1 ?? '',
    line2: store.address?.line2 ?? '',
    city: store.address?.city ?? '',
    state: store.address?.state ?? '',
    postalCode: store.address?.postalCode ?? '',
  });
  const [isSaving, setIsSaving] = useState(false);
  const set = (field: keyof typeof form) => (event: { target: { value: string } }) => setForm({ ...form, [field]: event.target.value });

  const handleSave = async (event: FormEvent) => {
    event.preventDefault();
    setIsSaving(true);
    try {
      const hasAddress = form.line1.trim() !== '' || form.city.trim() !== '';
      const { store: updated } = await storeApi.update(store.id, {
        name: form.name.trim(),
        ...(form.slug !== store.slug ? { slug: form.slug.trim() } : {}),
        description: orNull(form.description),
        shopCategory: form.shopCategory,
        phone: orNull(form.phone),
        email: orNull(form.email),
        address: hasAddress
          ? { line1: form.line1.trim(), line2: orNull(form.line2), city: form.city.trim(), state: orNull(form.state), postalCode: orNull(form.postalCode) }
          : null,
      });
      await saved(updated);
      showToast('Store details saved', 'success');
    } catch (err) {
      showToast(errorMessage(err, 'Could not save the store.'), 'error');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <form onSubmit={handleSave}>
      <div className="setup-section">
        <div className="setup-section-header">
          <h2 className="setup-section-title">Identity</h2>
          <p className="setup-section-desc">What customers see at the top of your store page.</p>
        </div>
        <div className="setup-section-content">
          <div className="form-row">
            <div className="input-wrapper">
              <label className="input-label">Store name *</label>
              <input className="input-field" required minLength={2} maxLength={100} value={form.name} onChange={set('name')} />
            </div>
            <div className="input-wrapper">
              <label className="input-label">Type of shop</label>
              <select className="input-field select-field" value={form.shopCategory} onChange={set('shopCategory')}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{capitalise(c)}</option>)}
              </select>
            </div>
          </div>
          <div className="input-wrapper">
            <label className="input-label">Store link</label>
            <input className="input-field mono" value={form.slug} onChange={set('slug')} disabled={store.isPublished} pattern="[a-z0-9]+(-[a-z0-9]+)*" />
            <span className="input-helper">
              {store.isPublished
                ? `Customers reach you at /store/${store.slug}. It cannot change while the store is published — it is in shared links and QR codes.`
                : 'Lower-case letters, numbers and hyphens. Choose it before publishing.'}
            </span>
          </div>
          <div className="input-wrapper">
            <label className="input-label">Description</label>
            <textarea className="input-field textarea-field" maxLength={1000} value={form.description} onChange={set('description')} />
          </div>
        </div>
      </div>

      <div className="setup-section">
        <div className="setup-section-header">
          <h2 className="setup-section-title">Contact</h2>
          <p className="setup-section-desc">Customers call this about their orders. A phone number is needed to publish.</p>
        </div>
        <div className="setup-section-content">
          <div className="form-row">
            <div className="input-wrapper">
              <label className="input-label">Phone</label>
              <input type="tel" className="input-field" value={form.phone} onChange={set('phone')} placeholder="+919876543210" />
            </div>
            <div className="input-wrapper">
              <label className="input-label">Email</label>
              <input type="email" className="input-field" value={form.email} onChange={set('email')} />
            </div>
          </div>
        </div>
      </div>

      <div className="setup-section">
        <div className="setup-section-header">
          <h2 className="setup-section-title">Address</h2>
          <p className="setup-section-desc">Where pickup customers come to. Needed to publish.</p>
        </div>
        <div className="setup-section-content">
          <div className="input-wrapper"><label className="input-label">Address line 1</label><input className="input-field" maxLength={200} value={form.line1} onChange={set('line1')} /></div>
          <div className="input-wrapper"><label className="input-label">Address line 2</label><input className="input-field" maxLength={200} value={form.line2} onChange={set('line2')} /></div>
          <div className="form-row" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
            <div className="input-wrapper"><label className="input-label">City</label><input className="input-field" maxLength={100} value={form.city} onChange={set('city')} /></div>
            <div className="input-wrapper"><label className="input-label">State</label><input className="input-field" maxLength={100} value={form.state} onChange={set('state')} /></div>
            <div className="input-wrapper"><label className="input-label">PIN code</label><input className="input-field" maxLength={12} value={form.postalCode} onChange={set('postalCode')} /></div>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', padding: 'var(--space-6) 0' }}>
        <button type="submit" className="btn btn-primary btn-lg" disabled={isSaving}>{isSaving ? 'Saving…' : 'Save changes'}</button>
      </div>
    </form>
  );
}

// ── Hours ────────────────────────────────────────────────────────────────────

function HoursTab({ store }: { store: Store }) {
  const { showToast } = useToast();
  const saved = useStoreSaved();
  const [hours, setHours] = useState<Record<Day, OpeningWindow[]>>(() =>
    Object.fromEntries(DAYS.map(({ id }) => [id, [...(store.openingHours[id] ?? [])]])) as Record<Day, OpeningWindow[]>,
  );
  const [isSaving, setIsSaving] = useState(false);

  const setWindow = (day: Day, index: number, field: keyof OpeningWindow, value: string) =>
    setHours({ ...hours, [day]: hours[day].map((w, i) => (i === index ? { ...w, [field]: value } : w)) });
  const addWindow = (day: Day) => setHours({ ...hours, [day]: [...hours[day], { open: '09:00', close: '21:00' }] });
  const removeWindow = (day: Day, index: number) => setHours({ ...hours, [day]: hours[day].filter((_, i) => i !== index) });
  const copyToAll = (day: Day) =>
    setHours(Object.fromEntries(DAYS.map(({ id }) => [id, hours[day].map((w) => ({ ...w }))])) as Record<Day, OpeningWindow[]>);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const { store: updated } = await storeApi.setHours(store.id, { timezone: store.timezone, openingHours: hours as OpeningHours });
      await saved(updated);
      showToast('Business hours saved', 'success');
    } catch (err) {
      showToast(errorMessage(err, 'Could not save the hours.'), 'error');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="setup-section">
      <div className="setup-section-header">
        <h2 className="setup-section-title">Weekly schedule</h2>
        <p className="setup-section-desc">
          Up to three time slots a day, in {store.timezone}. A slot that closes earlier than it opens runs past midnight. A day with no slots is closed — orders placed then wait until you open.
        </p>
      </div>
      <div className="setup-section-content">
        <div className="hours-grid">
          {DAYS.map(({ id, label }) => (
            <div key={id} className="hours-row" style={{ alignItems: 'flex-start' }}>
              <span className="hours-day">{label}</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', flex: 1 }}>
                {hours[id].length === 0 && <span className="badge badge-neutral" style={{ alignSelf: 'flex-start' }}>Closed</span>}
                {hours[id].map((window, index) => (
                  <div key={index} className="hours-times">
                    <input type="time" className="input-field" style={{ width: 130 }} value={window.open} onChange={(e) => setWindow(id, index, 'open', e.target.value)} aria-label={`${label} opens`} />
                    <span style={{ color: 'var(--color-text-tertiary)' }}>to</span>
                    <input type="time" className="input-field" style={{ width: 130 }} value={window.close} onChange={(e) => setWindow(id, index, 'close', e.target.value)} aria-label={`${label} closes`} />
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeWindow(id, index)} aria-label="Remove slot"><IconTrash size={14} /></button>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
                {hours[id].length < 3 && <button type="button" className="btn btn-ghost btn-sm" onClick={() => addWindow(id)}><IconPlus size={14} /> Slot</button>}
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => copyToAll(id)} title="Use these hours every day">Copy to all</button>
              </div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--space-2)' }}>
          <button className="btn btn-primary" onClick={handleSave} disabled={isSaving}>{isSaving ? 'Saving…' : 'Save hours'}</button>
        </div>
      </div>
    </div>
  );
}

// ── Holidays ─────────────────────────────────────────────────────────────────

function HolidaysTab({ store }: { store: Store }) {
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['holidays', store.id], queryFn: () => storeApi.holidays(store.id) });
  const [date, setDate] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const reload = () => {
    queryClient.invalidateQueries({ queryKey: ['holidays', store.id] });
    queryClient.invalidateQueries({ queryKey: ['store', store.id] });
  };

  const add = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await storeApi.addHoliday(store.id, { date, reason: reason.trim() || undefined });
      setDate('');
      setReason('');
      reload();
      showToast('Holiday added — the store shows closed that day', 'success');
    } catch (err) {
      showToast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await storeApi.removeHoliday(store.id, id);
      reload();
    } catch (err) {
      showToast(errorMessage(err), 'error');
    }
  };

  return (
    <div className="setup-section">
      <div className="setup-section-header">
        <h2 className="setup-section-title">Holidays</h2>
        <p className="setup-section-desc">Days the store is closed whatever the weekly hours say — festivals, a day off. Customers see it closed all that day.</p>
      </div>
      <div className="setup-section-content">
        <form onSubmit={add} className="form-row" style={{ alignItems: 'flex-end' }}>
          <div className="input-wrapper"><label className="input-label">Date *</label><input type="date" className="input-field" required value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div className="input-wrapper"><label className="input-label">Reason</label><input className="input-field" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Diwali" /></div>
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Adding…' : 'Add holiday'}</button>
        </form>

        {isLoading ? <Spinner /> : (data?.holidays.length ?? 0) === 0 ? (
          <p className="body-sm" style={{ color: 'var(--color-text-secondary)' }}>No holidays coming up.</p>
        ) : (
          <div className="table-container">
            <table className="table">
              <thead><tr><th>Date</th><th>Reason</th><th style={{ width: 60 }}></th></tr></thead>
              <tbody>
                {data!.holidays.map((holiday) => (
                  <tr key={holiday.id}>
                    <td style={{ fontWeight: 'var(--font-semibold)' }}>{new Date(`${holiday.date}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</td>
                    <td>{holiday.reason ?? '—'}</td>
                    <td><button className="btn btn-ghost btn-sm" onClick={() => remove(holiday.id)} aria-label="Remove holiday"><IconTrash size={14} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Pickup & delivery ────────────────────────────────────────────────────────

function DeliveryTab({ store }: { store: Store }) {
  const { showToast } = useToast();
  const saved = useStoreSaved();
  const f = store.fulfilment;
  const [form, setForm] = useState({
    pickupEnabled: f.pickupEnabled,
    deliveryEnabled: f.deliveryEnabled,
    deliveryFee: paiseToRupees(f.deliveryFeePaise),
    minOrder: paiseToRupees(f.minOrderPaise),
    freeAbove: paiseToRupees(f.freeDeliveryThresholdPaise),
    radius: f.deliveryRadiusKm === null ? '' : String(f.deliveryRadiusKm),
  });
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    const fee = rupeesToPaise(form.deliveryFee) ?? 0;
    const min = rupeesToPaise(form.minOrder) ?? 0;
    const free = rupeesToPaise(form.freeAbove);
    if ([fee, min, free].some((value) => Number.isNaN(value))) {
      showToast('Use amounts in rupees, like 29 or 29.50.', 'error');
      return;
    }
    setIsSaving(true);
    try {
      const { store: updated } = await storeApi.setDelivery(store.id, {
        pickupEnabled: form.pickupEnabled,
        deliveryEnabled: form.deliveryEnabled,
        deliveryFeePaise: fee,
        minOrderPaise: min,
        freeDeliveryThresholdPaise: free,
        deliveryRadiusKm: form.radius.trim() === '' ? null : Number(form.radius),
      });
      await saved(updated);
      showToast('Pickup and delivery saved', 'success');
    } catch (err) {
      showToast(errorMessage(err), 'error');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="setup-section">
      <div className="setup-section-header">
        <h2 className="setup-section-title">Pickup & delivery</h2>
        <p className="setup-section-desc">Offer at least one. The minimum order applies to both, measured before delivery and tax.</p>
      </div>
      <div className="setup-section-content">
        <label className="switch" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <input type="checkbox" className="switch-input" checked={form.pickupEnabled} onChange={(e) => setForm({ ...form, pickupEnabled: e.target.checked })} />
          <span className="switch-slider" /><span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--font-medium)' }}>Customers can pick up from the store</span>
        </label>
        <label className="switch" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <input type="checkbox" className="switch-input" checked={form.deliveryEnabled} onChange={(e) => setForm({ ...form, deliveryEnabled: e.target.checked })} />
          <span className="switch-slider" /><span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--font-medium)' }}>We deliver</span>
        </label>
        <div className="form-row">
          <div className="input-wrapper"><label className="input-label">Minimum order (₹)</label><input inputMode="decimal" className="input-field" value={form.minOrder} onChange={(e) => setForm({ ...form, minOrder: e.target.value })} placeholder="0" /></div>
          {form.deliveryEnabled && <div className="input-wrapper"><label className="input-label">Delivery fee (₹)</label><input inputMode="decimal" className="input-field" value={form.deliveryFee} onChange={(e) => setForm({ ...form, deliveryFee: e.target.value })} placeholder="0" /></div>}
        </div>
        {form.deliveryEnabled && (
          <div className="form-row">
            <div className="input-wrapper"><label className="input-label">Free delivery above (₹)</label><input inputMode="decimal" className="input-field" value={form.freeAbove} onChange={(e) => setForm({ ...form, freeAbove: e.target.value })} placeholder="Never free" /></div>
            <div className="input-wrapper"><label className="input-label">Delivery radius (km)</label><input inputMode="decimal" className="input-field" value={form.radius} onChange={(e) => setForm({ ...form, radius: e.target.value })} placeholder="No limit" /></div>
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--space-2)' }}>
          <button className="btn btn-primary" onClick={handleSave} disabled={isSaving}>{isSaving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}

// ── Payments ─────────────────────────────────────────────────────────────────

function PaymentsTab({ store }: { store: Store }) {
  const { showToast } = useToast();
  const saved = useStoreSaved();
  const [methods, setMethods] = useState(store.paymentMethods);
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const { store: updated } = await storeApi.setPayments(store.id, methods);
      await saved(updated);
      showToast('Payment methods saved', 'success');
    } catch (err) {
      showToast(errorMessage(err), 'error');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="setup-section">
      <div className="setup-section-header">
        <h2 className="setup-section-title">How online customers pay</h2>
        <p className="setup-section-desc">Online covers UPI, cards and net banking through the payment provider. At the counter you can take anything.</p>
      </div>
      <div className="setup-section-content">
        <label className="switch" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <input type="checkbox" className="switch-input" checked={methods.cash} onChange={(e) => setMethods({ ...methods, cash: e.target.checked })} />
          <span className="switch-slider" /><span style={{ fontSize: 'var(--text-md)', fontWeight: 'var(--font-medium)' }}>Cash on pickup / delivery</span>
        </label>
        <label className="switch" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <input type="checkbox" className="switch-input" checked={methods.online} onChange={(e) => setMethods({ ...methods, online: e.target.checked })} />
          <span className="switch-slider" /><span style={{ fontSize: 'var(--text-md)', fontWeight: 'var(--font-medium)' }}>Online payment</span>
        </label>
        {!methods.cash && !methods.online && <p className="input-helper" style={{ color: 'var(--color-danger)' }}>Keep at least one on.</p>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--space-2)' }}>
          <button className="btn btn-primary" onClick={handleSave} disabled={isSaving || (!methods.cash && !methods.online)}>{isSaving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}

// ── Logo & cover ─────────────────────────────────────────────────────────────

function BrandingTab({ store }: { store: Store }) {
  const { showToast } = useToast();
  const saved = useStoreSaved();
  const [uploading, setUploading] = useState<'logo' | 'cover' | null>(null);

  const handleUpload = async (kind: 'logo' | 'cover', file: File) => {
    if (file.size > 5 * 1024 * 1024) {
      showToast('Photos can be at most 5 MB.', 'error');
      return;
    }
    setUploading(kind);
    try {
      const { store: updated } = kind === 'logo' ? await storeApi.uploadLogo(store.id, file) : await storeApi.uploadCover(store.id, file);
      await saved(updated);
      showToast(kind === 'logo' ? 'Logo updated' : 'Cover photo updated', 'success');
    } catch (err) {
      showToast(errorMessage(err, 'Upload failed.'), 'error');
    } finally {
      setUploading(null);
    }
  };

  return (
    <div className="setup-section">
      <div className="setup-section-header">
        <h2 className="setup-section-title">Logo & cover photo</h2>
        <p className="setup-section-desc">Shown on your store page. JPEG, PNG or WebP, up to 5 MB.</p>
      </div>
      <div className="setup-section-content">
        <div className="form-row" style={{ alignItems: 'flex-start' }}>
          <div className="input-wrapper">
            <label className="input-label">Logo</label>
            {store.logoUrl && <img src={store.logoUrl} alt="Store logo" style={{ width: 96, height: 96, borderRadius: 'var(--radius-lg)', objectFit: 'cover', marginBottom: 'var(--space-2)', border: '1px solid var(--color-border)' }} />}
            <input type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading !== null} onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) handleUpload('logo', file); }} />
            {uploading === 'logo' && <span className="input-helper">Uploading…</span>}
          </div>
          <div className="input-wrapper">
            <label className="input-label">Cover photo</label>
            {store.coverImageUrl && <img src={store.coverImageUrl} alt="Store cover" style={{ width: '100%', height: 140, borderRadius: 'var(--radius-lg)', objectFit: 'cover', marginBottom: 'var(--space-2)', border: '1px solid var(--color-border)' }} />}
            <input type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading !== null} onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) handleUpload('cover', file); }} />
            <span className="input-helper">{uploading === 'cover' ? 'Uploading…' : 'A wide photo works best, about 1200×400.'}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
