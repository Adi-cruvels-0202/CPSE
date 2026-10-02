import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { ApiError, errorMessage } from '../../api/client';
import Logo from '../../components/brand/Logo';
import { AuthBrand } from './LoginPage';
import './Auth.css';

export default function RegisterPage() {
  const [form, setForm] = useState({ fullName: '', email: '', phone: '', password: '', confirm: '' });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const { register } = useAuth();

  const set = (field: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm({ ...form, [field]: event.target.value });

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (form.password.length < 8) return setError('Use at least 8 characters for the password.');
    if (form.password !== form.confirm) return setError('The passwords do not match.');

    setIsLoading(true);
    try {
      const { confirmEmail } = await register({
        fullName: form.fullName,
        email: form.email,
        password: form.password,
        phone: form.phone.trim() || undefined,
      });
      if (confirmEmail) setSentTo(form.email);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 409
          ? 'An account with that email already exists. Sign in, and you can set up your shop from there.'
          : errorMessage(err, 'Could not create the account. Please try again.'),
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <AuthBrand />
      <div className="auth-form-panel">
        <div className="auth-form-container">
          <div className="auth-mobile-logo"><Logo size="lg" /></div>

          {sentTo ? (
            <div className="auth-form-header" role="status">
              <h2 className="auth-form-title">Check your inbox</h2>
              <p className="auth-form-subtitle">
                We sent a link to <strong>{sentTo}</strong>. Open it to confirm your email, then sign in.
              </p>
              <Link to="/login" className="btn btn-primary btn-lg auth-submit" style={{ marginTop: 'var(--space-6)' }}>Go to sign in</Link>
            </div>
          ) : (
            <>
              <div className="auth-form-header">
                <h2 className="auth-form-title">Open your shop</h2>
                <p className="auth-form-subtitle">One account for selling here — and for shopping too.</p>
              </div>

              <form className="auth-form" onSubmit={handleSubmit}>
                {error && <div className="auth-error" role="alert">{error}</div>}
                <div className="input-wrapper">
                  <label className="input-label" htmlFor="name">Your name</label>
                  <input id="name" className="input-field" value={form.fullName} onChange={set('fullName')} required autoComplete="name" autoFocus maxLength={120} />
                </div>
                <div className="input-wrapper">
                  <label className="input-label" htmlFor="email">Email</label>
                  <input id="email" type="email" className="input-field" value={form.email} onChange={set('email')} required autoComplete="email" />
                </div>
                <div className="input-wrapper">
                  <label className="input-label" htmlFor="phone">Phone (optional)</label>
                  <input id="phone" type="tel" className="input-field" value={form.phone} onChange={set('phone')} placeholder="+919876543210" autoComplete="tel" />
                </div>
                <div className="input-wrapper">
                  <label className="input-label" htmlFor="password">Password</label>
                  <input id="password" type="password" className="input-field" value={form.password} onChange={set('password')} placeholder="At least 8 characters" required minLength={8} autoComplete="new-password" />
                </div>
                <div className="input-wrapper">
                  <label className="input-label" htmlFor="confirm">Confirm password</label>
                  <input id="confirm" type="password" className="input-field" value={form.confirm} onChange={set('confirm')} required autoComplete="new-password" />
                </div>
                <button type="submit" className="btn btn-primary btn-lg auth-submit" disabled={isLoading}>
                  {isLoading && <span className="spinner spinner-sm" />}
                  {isLoading ? 'Creating account…' : 'Create account'}
                </button>
              </form>

              <p className="auth-footer">
                Already have an account? <Link to="/login" className="auth-link">Sign in</Link>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
