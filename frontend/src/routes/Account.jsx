import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { endpoints } from '../lib/endpoints.js';
import { useSubmit } from '../hooks/useSubmit.js';
import { Field } from '../components/Field.jsx';
import { FormError, FormSuccess } from '../components/FormError.jsx';
import './Account.css';

/**
 * Checklist 11.3 — the profile, and the way out of the app.
 *
 * Two halves. The profile is editable in place: name, phone, avatar. Email is
 * shown but not editable — the backend rejects an attempt to change it with a
 * 422 rather than ignoring it (D20), because it is the account's identity in
 * Supabase Auth, so this screen does not offer an input that could not work.
 *
 * Below that, the links to everything a customer owns, and sign out.
 */
export function Account() {
  const { customer, setCustomer, signOut } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState({
    fullName: customer?.fullName ?? '',
    phone: customer?.phone ?? '',
  });
  const [saved, setSaved] = useState(false);

  const update = (key) => (value) => {
    setForm((current) => ({ ...current, [key]: value }));
    setSaved(false);
  };

  const { submit, pending, error, fieldErrors } = useSubmit(
    async () => {
      const payload = {};
      const name = form.fullName.trim();
      const phone = form.phone.trim();

      // Only what changed. Sending the whole form would fail the backend's
      // "provide at least one field" check on a no-op save, and a cleared
      // optional field means null, not ''.
      if (name !== (customer?.fullName ?? '')) payload.fullName = name;
      if (phone !== (customer?.phone ?? '')) payload.phone = phone === '' ? null : phone;

      if (Object.keys(payload).length === 0) return { unchanged: true };

      const { data } = await endpoints.profile.update(payload);
      setCustomer(data.customer);
      return data;
    },
    { onSuccess: () => setSaved(true) },
  );

  const { submit: doSignOut, pending: signingOut } = useSubmit(signOut, {
    onSuccess: () => navigate('/', { replace: true }),
  });

  return (
    <div className="stack">
      <h1>Account</h1>

      <section className="card stack" aria-labelledby="profile-heading">
        <h2 id="profile-heading" className="account__section-title">
          Your details
        </h2>

        <div className="account__email">
          <span className="field__label">Email</span>
          <p>{customer?.email}</p>
          <p className="field__hint">
            Your email is how you sign in, so it cannot be changed here.
          </p>
        </div>

        <form
          className="stack"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
          noValidate
        >
          <FormError error={error} />
          {saved ? <FormSuccess>Saved.</FormSuccess> : null}

          <Field
            label="Full name"
            name="fullName"
            value={form.fullName}
            onChange={update('fullName')}
            error={fieldErrors.fullName}
            autoComplete="name"
            disabled={pending}
          />

          <Field
            label="Phone"
            name="phone"
            type="tel"
            value={form.phone}
            onChange={update('phone')}
            error={fieldErrors.phone}
            hint="So a store can reach you about an order."
            autoComplete="tel"
            inputMode="tel"
            disabled={pending}
          />

          <button type="submit" className="btn" disabled={pending}>
            {pending ? 'Saving…' : 'Save changes'}
          </button>
        </form>
      </section>

      <nav className="card account__links" aria-label="Your things">
        <AccountLink to="/account/addresses" label="Addresses" hint="Where your orders go" />
        <AccountLink to="/orders" label="Orders" hint="What you have bought" />
        <AccountLink to="/saved" label="Saved stores" hint="Shops you go back to" />
        <AccountLink to="/notifications" label="Notifications" hint="Order and payment updates" />
        <AccountLink to="/khata" label="Khata" hint="What you owe your stores" />
      </nav>

      <button
        type="button"
        className="btn btn--secondary btn--block"
        onClick={() => doSignOut()}
        disabled={signingOut}
      >
        {signingOut ? 'Signing out…' : 'Sign out'}
      </button>
    </div>
  );
}

function AccountLink({ to, label, hint }) {
  return (
    <Link to={to} className="account__link">
      <span className="account__link-text">
        <span className="account__link-label">{label}</span>
        <span className="account__link-hint">{hint}</span>
      </span>
      <ChevronRight />
    </Link>
  );
}

function ChevronRight() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}
