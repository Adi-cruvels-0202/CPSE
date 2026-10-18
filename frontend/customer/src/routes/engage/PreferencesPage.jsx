import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { endpoints } from '../../lib/endpoints.js';
import { useApiQuery } from '../../hooks/useApiQuery.js';
import { useSubmit } from '../../hooks/useSubmit.js';
import { ErrorState, LoadingBlock, Skeleton } from '../../components/states/States.jsx';
import { FormError, FormSuccess } from '../../components/FormError.jsx';
import { SUBSTITUTION_PREFERENCE } from '../orders/OrderExtras.jsx';
import './Engage.css';

/**
 * Preferences and consent (roadmap §5 P2/P3): how the customer likes to shop,
 * what we may remember, and what each shop may send them. Order updates for
 * an order they placed always reach them in the app; everything else is their
 * choice, and the server refuses to send what they turned off.
 */
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function PreferencesPage() {
  const query = useApiQuery(() => endpoints.preferences.get(), []);
  const stores = useApiQuery(() => endpoints.preferences.stores(), []);
  const [form, setForm] = useState(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (query.data?.preferences) setForm(query.data.preferences);
  }, [query.data]);

  const save = useSubmit(
    async () => {
      const { data } = await endpoints.preferences.update({
        preferredFulfilment: form.preferredFulfilment,
        preferredPaymentMethod: form.preferredPaymentMethod,
        preferredSubstitution: form.preferredSubstitution,
        activityTracking: form.activityTracking,
        occasionOffers: form.occasionOffers,
        birthday: form.birthday?.month && form.birthday?.day ? { month: Number(form.birthday.month), day: Number(form.birthday.day) } : null,
      });
      query.setData({ preferences: data.preferences });
    },
    { onSuccess: () => setSaved(true) },
  );

  if (query.loading || (!form && !query.error)) {
    return <LoadingBlock label="Loading your preferences"><Skeleton height="16rem" radius="var(--radius-md)" /></LoadingBlock>;
  }
  if (query.error) return <ErrorState error={query.error} onRetry={query.refetch} />;

  const set = (patch) => {
    setSaved(false);
    setForm({ ...form, ...patch });
  };
  const trackingOffWarning = query.data.preferences.activityTracking && !form.activityTracking;

  return (
    <div className="stack">
      <header>
        <h1>Preferences</h1>
        <p className="muted">Used to fill in checkout for you. Change them any time.</p>
      </header>

      <form
        className="card stack"
        onSubmit={(event) => {
          event.preventDefault();
          save.submit();
        }}
      >
        <h2 className="engage__title">How you like to shop</h2>
        <Choice label="Pickup or delivery" name="fulfilment" value={form.preferredFulfilment ?? ''} onChange={(v) => set({ preferredFulfilment: v || null })}
          options={[['', 'Ask me each time'], ['pickup', 'Pickup'], ['delivery', 'Delivery']]} />
        <Choice label="Paying" name="payment" value={form.preferredPaymentMethod ?? ''} onChange={(v) => set({ preferredPaymentMethod: v || null })}
          options={[['', 'Ask me each time'], ['cash', 'Cash'], ['online', 'Online'], ['khata', 'Khata (where the shop allows it)']]}
          hint="Only the method is saved — never a card, UPI or bank detail." />
        <Choice label="If something is out of stock" name="substitution" value={form.preferredSubstitution} onChange={(v) => set({ preferredSubstitution: v })}
          options={Object.entries(SUBSTITUTION_PREFERENCE)} />

        <h2 className="engage__title">What we may remember</h2>
        <label className="toggle-row">
          <input type="checkbox" checked={form.activityTracking} onChange={(event) => set({ activityTracking: event.target.checked })} />
          <span>
            Remember what I look at and search for
            <span className="muted" style={{ display: 'block' }}>Powers “Recently viewed”. Turning it off also deletes what was kept.</span>
          </span>
        </label>
        {trackingOffWarning ? <p className="notice notice--warning">Saving will delete your viewing history.</p> : null}
        <label className="toggle-row">
          <input type="checkbox" checked={form.occasionOffers} onChange={(event) => set({ occasionOffers: event.target.checked })} />
          <span>
            Birthday offers from shops I follow
            <span className="muted" style={{ display: 'block' }}>Shops never see your birthday — only that an offer applies this week.</span>
          </span>
        </label>
        {form.occasionOffers ? (
          <div className="row">
            <select className="field__input" aria-label="Birthday month" value={form.birthday?.month ?? ''} onChange={(event) => set({ birthday: { ...form.birthday, month: event.target.value } })}>
              <option value="">Month</option>
              {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
            <input className="field__input" aria-label="Birthday day" type="number" min={1} max={31} placeholder="Day" value={form.birthday?.day ?? ''} onChange={(event) => set({ birthday: { ...form.birthday, day: event.target.value } })} />
          </div>
        ) : null}

        <FormError error={save.error} />
        {saved ? <FormSuccess>Saved.</FormSuccess> : null}
        <button type="submit" className="btn" disabled={save.pending}>{save.pending ? 'Saving…' : 'Save preferences'}</button>
      </form>

      <section className="card stack" aria-labelledby="shops-heading">
        <h2 id="shops-heading" className="engage__title">What shops may send you</h2>
        <p className="muted">Order updates always reach you. These are for offers and reminders. Set them on a shop's page, or change them here.</p>
        {stores.loading ? <Skeleton height="4rem" /> : stores.error ? <ErrorState error={stores.error} onRetry={stores.refetch} /> : (stores.data?.stores ?? []).length === 0 ? (
          <p className="muted">You have not set anything for a shop yet — so no shop sends you offers.</p>
        ) : (
          <ul className="prows">
            {stores.data.stores.map((row) => (
              <StoreConsent key={row.store.id} row={row} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export function StoreConsent({ row, compact = false }) {
  const [prefs, setPrefs] = useState(row);
  const save = useSubmit(async (patch) => {
    const { data } = await endpoints.preferences.setStore(row.store.id, patch);
    setPrefs({ ...prefs, ...data.preferences });
  });
  const toggle = (key) => save.submit({ [key]: !prefs[key] });
  return (
    <li className="stack" style={{ gap: 'var(--space-1)' }}>
      {compact ? null : row.store.slug ? <Link to={`/store/${row.store.slug}`} className="prow__name">{row.store.name}</Link> : <strong>{row.store.name}</strong>}
      <label className="toggle-row">
        <input type="checkbox" checked={prefs.allowPromotions} disabled={save.pending} onChange={() => toggle('allowPromotions')} />
        <span>Offers and announcements</span>
      </label>
      <label className="toggle-row">
        <input type="checkbox" checked={prefs.allowReminders} disabled={save.pending} onChange={() => toggle('allowReminders')} />
        <span>Reminders (reorder, khata dues)</span>
      </label>
      <FormError error={save.error} />
    </li>
  );
}

function Choice({ label, name, value, onChange, options, hint }) {
  return (
    <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0, gap: 'var(--space-1)' }}>
      <legend className="field__label">{label}</legend>
      <div className="choices" role="radiogroup" aria-label={label}>
        {options.map(([code, text]) => (
          <label key={code || 'none'} className={`choice${value === code ? ' choice--selected' : ''}`}>
            <input type="radio" name={name} value={code} checked={value === code} onChange={() => onChange(code)} />
            <span className="choice__body"><span className="choice__label">{text}</span></span>
          </label>
        ))}
      </div>
      {hint ? <p className="field__hint">{hint}</p> : null}
    </fieldset>
  );
}
