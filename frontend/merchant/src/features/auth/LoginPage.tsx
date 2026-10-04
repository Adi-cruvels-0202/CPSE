import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { errorMessage } from '../../api/client';
import Logo from '../../components/brand/Logo';
import './Auth.css';

export function AuthBrand() {
  return (
    <div className="auth-brand">
      <div className="auth-brand-content">
        <div style={{ marginBottom: 'var(--space-8)' }}><Logo size="xl" variant="inverse" /></div>
        <h1 className="auth-brand-heading">Your shop, online and at the counter.</h1>
        <p className="auth-brand-text">
          Take orders from your neighbourhood, keep stock straight and ring up walk-ins.
        </p>
      </div>
    </div>
  );
}

/**
 * Shop accounts only (MERGE_MAPPING D-2, revised). A customer account gets the
 * server's CUSTOMER_ACCOUNT message; a shopkeeper who also shops has a
 * separate customer account with another email.
 */
export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const { login } = useAuth();

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setIsLoading(true);
    try {
      // The route guards move on to the dashboard by themselves. A customer
      // account is refused by the server (CUSTOMER_ACCOUNT) and its message shown.
      await login(email, password);
    } catch (err) {
      setError(errorMessage(err, 'Sign in failed. Please try again.'));
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
          <div className="auth-form-header">
            <h2 className="auth-form-title">Welcome back</h2>
            <p className="auth-form-subtitle">Sign in to manage your shop</p>
          </div>

          <form className="auth-form" onSubmit={handleSubmit}>
            {error && <div className="auth-error" role="alert">{error}</div>}
            <div className="input-wrapper">
              <label className="input-label" htmlFor="email">Email</label>
              <input id="email" type="email" className="input-field" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required autoComplete="email" autoFocus />
            </div>
            <div className="input-wrapper">
              <label className="input-label" htmlFor="password">Password</label>
              <input id="password" type="password" className="input-field" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Your password" required autoComplete="current-password" />
            </div>
            <button type="submit" className="btn btn-primary btn-lg auth-submit" disabled={isLoading}>
              {isLoading && <span className="spinner spinner-sm" />}
              {isLoading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <p className="auth-footer">
            New to selling here? <Link to="/register" className="auth-link">Create a merchant account</Link>
          </p>
          <p className="auth-footer">
            Here to shop? <a href="/login" className="auth-link">Customer sign in</a>
          </p>
        </div>
      </div>
    </div>
  );
}
