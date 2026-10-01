import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { FullPageSpinner } from './FullPageSpinner.jsx';

/**
 * Gates a route on being signed in — checklist 11.1.
 *
 * Three states, not two. While a stored session is still being verified this
 * renders a spinner rather than redirecting: bouncing a returning customer to
 * the login screen for the half-second before their profile arrives, and then
 * bouncing them back, is the single most obvious way an app feels broken.
 *
 * The redirect remembers where they were going, so signing in lands them there
 * instead of on the home screen.
 */
export function RequireAuth({ children }) {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'loading') return <FullPageSpinner label="Checking your session" />;

  if (status === 'signedOut') {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }

  return children;
}
