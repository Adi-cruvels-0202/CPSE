import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { useSubmit } from '../../hooks/useSubmit.js';
import { Field, PasswordField } from '../../components/Field.jsx';
import { FormError } from '../../components/FormError.jsx';
import { AuthLayout, AuthSwitch } from './AuthLayout.jsx';

/**
 * Checklist 11.3 — sign in.
 *
 * Lands the customer back where they were going. `RequireAuth` puts the intended
 * path in location state, so someone who followed a link to an order gets the
 * order after signing in, not the home screen.
 *
 * The server answers a wrong password and an unknown email identically
 * (backend D19), so this screen must not try to be more specific than it — no
 * "no account with that email", which would turn the form into an
 * account-existence oracle.
 */
export function Login() {
  const { signIn, status } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const destination = location.state?.from ?? '/';

  const { submit, pending, error, fieldErrors } = useSubmit(
    () => signIn({ email, password }),
    { onSuccess: () => navigate(destination, { replace: true }) },
  );

  // Already signed in — nothing to do here.
  if (status === 'signedIn') return <Navigate to={destination} replace />;

  return (
    <AuthLayout
      title="Sign in"
      lead="To see your orders, addresses and khata."
      footer={
        <AuthSwitch question="New here?" to="/register" action="Create an account" />
      }
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
          value={email}
          onChange={setEmail}
          error={fieldErrors.email}
          required
          autoComplete="email"
          inputMode="email"
          placeholder="you@example.com"
          disabled={pending}
          autoFocus
        />

        <PasswordField
          value={password}
          onChange={setPassword}
          error={fieldErrors.password}
          autoComplete="current-password"
          disabled={pending}
        />

        <p className="auth__aside">
          <Link to="/forgot-password">Forgot your password?</Link>
        </p>

        <button type="submit" className="btn btn--block" disabled={pending}>
          {pending ? (
            <>
              <span className="spinner spinner--on-brand" />
              Signing in…
            </>
          ) : (
            'Sign in'
          )}
        </button>
      </form>
    </AuthLayout>
  );
}
