import { useState, type FormEvent } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { errorMessage } from '../../api/client';
import Logo from '../../components/brand/Logo';
import { AuthBrand } from './LoginPage';
import './Auth.css';

/**
 * Signed in with an account that only shops so far — the same login works
 * here (D-2). One tap makes it a merchant account too; nothing about the
 * customer side changes.
 */
export default function OnboardingPage() {
  const { onboard, logout } = useAuth();
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setIsLoading(true);
    try {
      await onboard({ fullName: fullName.trim() || undefined, phone: phone.trim() || undefined });
    } catch (err) {
      setError(errorMessage(err));
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
            <h2 className="auth-form-title">Set up selling</h2>
            <p className="auth-form-subtitle">
              You are signed in with your shopping account. Turn on selling to create your store — you can still shop with the same login.
            </p>
          </div>

          <form className="auth-form" onSubmit={handleSubmit}>
            {error && <div className="auth-error" role="alert">{error}</div>}
            <div className="input-wrapper">
              <label className="input-label" htmlFor="name">Name shown to customers (optional)</label>
              <input id="name" className="input-field" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Defaults to your profile name" maxLength={120} />
            </div>
            <div className="input-wrapper">
              <label className="input-label" htmlFor="phone">Phone (optional)</label>
              <input id="phone" type="tel" className="input-field" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+919876543210" />
            </div>
            <button type="submit" className="btn btn-primary btn-lg auth-submit" disabled={isLoading}>
              {isLoading && <span className="spinner spinner-sm" />}
              {isLoading ? 'Setting up…' : 'Start selling'}
            </button>
          </form>

          <p className="auth-footer">
            Not you? <button type="button" className="auth-link" style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer' }} onClick={() => logout()}>Sign out</button>
            {' · '}
            <a href="/" className="auth-link">Back to shopping</a>
          </p>
        </div>
      </div>
    </div>
  );
}
