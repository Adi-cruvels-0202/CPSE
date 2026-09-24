import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { endpoints } from '../lib/endpoints.js';
import { useSubmit } from '../hooks/useSubmit.js';
import { Field } from '../components/Field.jsx';
import { FormError, FormSuccess } from '../components/FormError.jsx';
import { RemoteImage } from '../components/RemoteImage.jsx';
import { Sheet } from '../components/Sheet.jsx';
import './Account.css';

/**
 * Checklist 11.3 — the profile, and the way out of the app.
 *
 * Laid out the way every account tab is: who you are at the top, the things you
 * own as one list of rows below it, and the way out at the bottom.
 *
 * The edit form used to sit open on this screen, which made the first thing a
 * customer saw a set of inputs they had not asked to fill in — and pushed the
 * links they actually came for below the fold. Editing a profile is a rare,
 * deliberate act, so it is behind "Edit profile" and opens in a sheet. What
 * stays on the screen is the answer to "which account am I signed in as".
 *
 * Notifications is not in this list: the bell in the header goes there from
 * every screen, and a second door to the same room is just something else to
 * scan past.
 */
export function Account() {
  const { customer, signOut } = useAuth();
  const navigate = useNavigate();

  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);

  const { submit: doSignOut, pending: signingOut } = useSubmit(signOut, {
    onSuccess: () => navigate('/', { replace: true }),
  });

  return (
    <div className="stack account">
      <h1>Account</h1>

      <section className="card account__identity" aria-labelledby="identity-heading">
        <h2 id="identity-heading" className="sr-only">
          Your details
        </h2>

        <RemoteImage
          src={customer?.avatarUrl}
          name={customer?.fullName ?? customer?.email}
          alt=""
          className="account__avatar"
          rounded="var(--radius-full)"
        />

        <div className="account__who">
          {/* A customer who registered without a name still has an account, and
              "Your account" beats an empty line where a name should be. */}
          <p className="account__name">{customer?.fullName || 'Your account'}</p>
          <p className="account__contact">{customer?.email}</p>
          {customer?.phone ? <p className="account__contact">{customer.phone}</p> : null}
        </div>

        <button
          type="button"
          className="btn btn--secondary btn--sm account__edit"
          onClick={() => {
            setSaved(false);
            setEditing(true);
          }}
        >
          <PencilIcon />
          Edit profile
        </button>

        {saved ? <FormSuccess>Saved.</FormSuccess> : null}
      </section>

      <nav className="card account__links" aria-label="Your things">
        <AccountLink
          to="/orders"
          icon={<ReceiptIcon />}
          label="Orders"
          hint="What you have bought"
        />
        <AccountLink
          to="/account/addresses"
          icon={<PinIcon />}
          label="Addresses"
          hint="Where your orders go"
        />
        <AccountLink
          to="/khata"
          icon={<LedgerIcon />}
          label="Khata"
          hint="What you owe your stores"
        />
      </nav>

      <button
        type="button"
        className="btn btn--block account__signout"
        onClick={() => doSignOut()}
        disabled={signingOut}
      >
        {signingOut ? 'Signing out…' : 'Sign out'}
      </button>

      {editing ? (
        <Sheet title="Edit profile" onClose={() => setEditing(false)}>
          <ProfileForm
            onSaved={() => {
              setSaved(true);
              setEditing(false);
            }}
          />
        </Sheet>
      ) : null}
    </div>
  );
}

function ProfileForm({ onSaved }) {
  const { customer, setCustomer } = useAuth();

  const [form, setForm] = useState({
    fullName: customer?.fullName ?? '',
    phone: customer?.phone ?? '',
  });

  const update = (key) => (value) => setForm((current) => ({ ...current, [key]: value }));

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
    { onSuccess: onSaved },
  );

  return (
    <form
      className="stack"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      noValidate
    >
      <FormError error={error} />

      <div className="account__email">
        <span className="field__label">Email</span>
        <p>{customer?.email}</p>
        <p className="field__hint">Your email is how you sign in, so it cannot be changed here.</p>
      </div>

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

      <button type="submit" className="btn btn--block" disabled={pending}>
        {pending ? 'Saving…' : 'Save changes'}
      </button>
    </form>
  );
}

function AccountLink({ to, icon, label, hint }) {
  return (
    <Link to={to} className="account__link">
      <span className="account__link-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="account__link-text">
        <span className="account__link-label">{label}</span>
        <span className="account__link-hint">{hint}</span>
      </span>
      <ChevronRight />
    </Link>
  );
}

/* ── Icons ──────────────────────────────────────────────────────────────── */

const iconProps = {
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: false,
};

function ReceiptIcon() {
  return (
    <svg {...iconProps}>
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" />
      <path d="M9 8h6M9 12h6" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg {...iconProps}>
      <path d="M12 21s-6.5-5.5-6.5-10a6.5 6.5 0 0 1 13 0c0 4.5-6.5 10-6.5 10Z" />
      <circle cx="12" cy="11" r="2.25" />
    </svg>
  );
}

function LedgerIcon() {
  return (
    <svg {...iconProps}>
      <path d="M5 4h11a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2V4Z" />
      <path d="M5 16h13M9 8h5" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg {...iconProps} width={16} height={16}>
      <path d="M4 20h4L19 9a2 2 0 0 0-3-3L5 17v3Z" />
      <path d="M14.5 6.5 17.5 9.5" />
    </svg>
  );
}

function ChevronRight() {
  return (
    <svg {...iconProps} className="account__chevron">
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}
