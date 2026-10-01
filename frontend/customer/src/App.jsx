import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext.jsx';
import { ErrorBoundary } from './components/ErrorBoundary.jsx';
import { AppRoutes } from './router.jsx';

/**
 * Providers, outermost first: an error boundary that can still render when
 * everything below it has failed, then the router (AuthProvider needs no router,
 * but RequireAuth needs both), then auth.
 */
export function App() {
  return (
    <ErrorBoundary>
      {/* Opted into the v7 behaviour now rather than carrying a deprecation
          warning until the upgrade forces it. */}
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
