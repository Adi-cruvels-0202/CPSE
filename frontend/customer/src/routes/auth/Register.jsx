import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { useSubmit } from '../../hooks/useSubmit.js';
import { Field, PasswordField } from '../../components/Field.jsx';
import { FormError } from '../../components/FormError.jsx';
import { AuthLayout, AuthSwitch } from './AuthLayout.jsx';

/**
 * Checklist 11.3 — create an account.
 *
 * Two outcomes, and the second is the one that gets forgotten: when Supabase has
 * email confirmation switched on, registering succeeds but returns no session.
 * The customer is not signed in and nothing appears to have happened unless the
 * screen says so, which is what `confirmationSent` below is for.
 *
 * Name and phone are optional here because the backend makes them optional — a
 * customer can fill them in later from the account screen, and a shorter form is
 * a form more people finish.
 */
export function Register() {
  const { register, status } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState({ email: '', password: '', fullName: '', phone: '' });
  const [confirmationSent, setConfirmationSent] = useState(false);

  const update = (key) => (value) => setForm((current) => ({ ...current, [key]: value }));

  const { submit, pending, error, fieldErrors } = useSubmit(
    () =>
      register({
        email: form.email,
        password: form.password,
        // Omitted rather than sent empty: the backend's schema is strict, and
        // '' fails `min(1)` where an absent field is simply not set.
        ...(form.fullName.trim() ? { fullName: form.fullName.trim() } : {}),
        ...(form.phone.trim() ? { phone: form.phone.trim() } : {}),
      }),
    {
      onSuccess: (result) => {
        if (result?.session) navigate('/', { replace: true });
        else setConfirmationSent(true);
      },
    },
  );

  if (status === 'signedIn' && !confirmationSent) return <Navigate to="/" replace />;

  if (confirmationSent) {
    return (
      <AuthLayout
        title="Check your email"
        lead={`We sent a confirmation link to ${form.email}. Open it to finish setting up your account.`}
        footer={<AuthSwitch question="Already confirmed?" to="/login" action="Sign in" />}
      >
        <p className="notice notice--success" role="status">
          Your account is created. It just needs confirming before you can sign in.
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Create account"
      lead="You can browse any store without one. You need an account to order."
      footer={<AuthSwitch question="Already have an account?" to="/login" action="Sign in" />}
    >
      <form
        className="auth__form"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        noValidate
      >
        <FormError error={error} />

        <Field
          label="Email"
          name="email"
          type="email"
          value={form.email}
          onChange={update('email')}
          error={fieldErrors.email}
          required
          autoComplete="email"
          inputMode="email"
          placeholder="you@example.com"
          disabled={pending}
          autoFocus
        />

        <PasswordField
          value={form.password}
          onChange={update('password')}
          error={fieldErrors.password}
          hint="At least 8 characters."
          autoComplete="new-password"
          disabled={pending}
        />

        <Field
          label="Full name"
          name="fullName"
          value={form.fullName}
          onChange={update('fullName')}
          error={fieldErrors.fullName}
          autoComplete="name"
          placeholder="Aditya Suresh"
          disabled={pending}
        />

        <Field
          label="Phone"
          name="phone"
          type="tel"
          value={form.phone}
          onChange={update('phone')}
          error={fieldErrors.phone}
          hint="So the store can reach you about an order."
          autoComplete="tel"
          inputMode="tel"
          placeholder="+91 98765 43210"
          disabled={pending}
        />

        <button type="submit" className="btn btn--block" disabled={pending}>
          {pending ? (
            <>
              <span className="spinner spinner--on-brand" />
              Creating your account…
            </>
          ) : (
            'Create account'
          )}
        </button>

        <p className="muted" style={{ textAlign: 'center' }}>
          Browsing works without an account — <Link to="/">have a look first</Link>.
        </p>
      </form>
    </AuthLayout>
  );
}
