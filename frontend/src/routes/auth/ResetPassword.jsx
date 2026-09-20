import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { endpoints } from '../../lib/endpoints.js';
import { useSubmit } from '../../hooks/useSubmit.js';
import { PasswordField } from '../../components/Field.jsx';
import { FormError } from '../../components/FormError.jsx';
import { AuthLayout, AuthSwitch } from './AuthLayout.jsx';

/**
 * Checklist 11.3 — set a new password from the emailed link.
 *
 * The link's one-time token arrives in the URL. Supabase puts recovery tokens in
 * the fragment (`#access_token=…`) for its own JS client, while our backend takes
 * an `accessToken` in the body, so both shapes are read: the query string first,
 * then the fragment.
 *
 * This URL must stay `/reset-password` — it is what `PASSWORD_RESET_REDIRECT_URL`
 * points at and what Supabase's redirect allowlist permits.
 */
export function ResetPassword() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [mismatch, setMismatch] = useState(null);
  const [done, setDone] = useState(false);

  const accessToken = readRecoveryToken(searchParams);

  const { submit, pending, error, fieldErrors } = useSubmit(
    () => endpoints.auth.resetPassword({ accessToken, password }),
    { onSuccess: () => setDone(true) },
  );

  // No token means the customer got here by typing the URL, or the link was
  // mangled by an email client. Say so plainly rather than showing a form that
  // cannot work.
  if (!accessToken) {
    return (
      <AuthLayout
        title="That link will not work"
        lead="A reset link is missing from this address, or it has already been used."
        footer={<AuthSwitch question="Need a new one?" to="/forgot-password" action="Start again" />}
      >
        <p className="notice notice--warning">
          Open the link straight from the email rather than copying part of it.
        </p>
      </AuthLayout>
    );
  }

  if (done) {
    return (
      <AuthLayout title="Password changed" lead="You can sign in with it now.">
        <p className="notice notice--success" role="status">
          Your password has been updated.
        </p>
        <Link to="/login" className="btn btn--block">
          Sign in
        </Link>
      </AuthLayout>
    );
  }

  const onSubmit = (event) => {
    event.preventDefault();

    // Checked here rather than server-side because the server never sees the
    // confirmation — it is the one rule this screen owns.
    if (password !== confirmation) {
      setMismatch('Both passwords must match.');
      return;
    }
    setMismatch(null);
    submit();
  };

  return (
    <AuthLayout
      title="Choose a new password"
      lead="Pick something you have not used here before."
      footer={<AuthSwitch question="Changed your mind?" to="/login" action="Back to sign in" />}
    >
      <form className="auth__form" onSubmit={onSubmit} noValidate>
        <FormError error={error} />

        <PasswordField
          label="New password"
          name="password"
          value={password}
          onChange={setPassword}
          error={fieldErrors.password}
          hint="At least 8 characters."
          autoComplete="new-password"
          disabled={pending}
          autoFocus
        />

        <PasswordField
          label="Confirm new password"
          name="passwordConfirmation"
          value={confirmation}
          onChange={(value) => {
            setConfirmation(value);
            if (mismatch) setMismatch(null);
          }}
          error={mismatch}
          autoComplete="new-password"
          disabled={pending}
        />

        <button type="submit" className="btn btn--block" disabled={pending}>
          {pending ? (
            <>
              <span className="spinner spinner--on-brand" />
              Saving…
            </>
          ) : (
            'Save new password'
          )}
        </button>
      </form>
    </AuthLayout>
  );
}

/**
 * Supabase sends the recovery token in the URL fragment; a plain redirect may
 * carry it in the query string instead. Both are read, and the fragment is
 * parsed rather than string-matched so a second parameter cannot be swallowed.
 */
export function readRecoveryToken(searchParams, hash = window.location.hash) {
  const fromQuery = searchParams.get('accessToken') ?? searchParams.get('access_token');
  if (fromQuery) return fromQuery;

  if (!hash) return null;
  const fragment = new URLSearchParams(hash.replace(/^#/, ''));
  return fragment.get('access_token') ?? fragment.get('accessToken') ?? null;
}
