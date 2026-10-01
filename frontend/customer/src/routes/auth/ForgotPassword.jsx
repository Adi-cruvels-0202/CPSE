import { useState } from 'react';
import { endpoints } from '../../lib/endpoints.js';
import { useSubmit } from '../../hooks/useSubmit.js';
import { Field } from '../../components/Field.jsx';
import { FormError } from '../../components/FormError.jsx';
import { AuthLayout, AuthSwitch } from './AuthLayout.jsx';

/**
 * Checklist 11.3 — ask for a reset link.
 *
 * The server answers 200 whether or not the address is registered (backend
 * D19), and this screen has to hold that line: the confirmation below says an
 * email has been sent *if the address is registered*, and never reveals which.
 * Wording that says "we've sent you a link" would leak the same fact the server
 * carefully does not.
 */
export function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);

  const { submit, pending, error, fieldErrors } = useSubmit(
    () => endpoints.auth.forgotPassword({ email }),
    { onSuccess: () => setSent(true) },
  );

  if (sent) {
    return (
      <AuthLayout
        title="Check your email"
        lead={`If ${email} has an account, a reset link is on its way. The link expires after an hour.`}
        footer={<AuthSwitch question="Remembered it?" to="/login" action="Sign in" />}
      >
        <p className="notice notice--success" role="status">
          Nothing in your inbox after a few minutes? Check the spam folder, then try again.
        </p>
        <button
          type="button"
          className="btn btn--secondary btn--block"
          onClick={() => setSent(false)}
        >
          Use a different email
        </button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Forgot password"
      lead="We will email you a link to choose a new one."
      footer={<AuthSwitch question="Remembered it?" to="/login" action="Sign in" />}
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

        <button type="submit" className="btn btn--block" disabled={pending}>
          {pending ? (
            <>
              <span className="spinner spinner--on-brand" />
              Sending…
            </>
          ) : (
            'Send reset link'
          )}
        </button>
      </form>
    </AuthLayout>
  );
}
