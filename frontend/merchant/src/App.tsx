import type { ReactNode } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { ToastProvider } from './hooks/useToast';
import { StoreProvider } from './hooks/useStore';
import LiquidGlass from './components/glass/LiquidGlass';
import MerchantLayout from './components/layout/MerchantLayout';
import LoginPage from './features/auth/LoginPage';
import RegisterPage from './features/auth/RegisterPage';
import OnboardingPage from './features/auth/OnboardingPage';
import DashboardPage from './features/dashboard/DashboardPage';
import StoreSetupPage from './features/store/StoreSetupPage';
import CategoriesPage from './features/categories/CategoriesPage';
import ProductsPage from './features/products/ProductsPage';
import InventoryPage from './features/inventory/InventoryPage';
import InventoryHistoryPage from './features/inventory/InventoryHistoryPage';
import NewSalePage from './features/sales/NewSalePage';
import SalesHistoryPage from './features/sales/SalesHistoryPage';
import OrdersPage from './features/orders/OrdersPage';

/**
 * The merchant app, served by the backend at /merchant (the customer app is
 * at /). Same login as the customer app — see lib/session.ts.
 */

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 15_000 },
  },
});

function FullPageSpinner() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--color-bg)' }}>
      <div className="spinner spinner-lg" role="status" aria-label="Loading" />
    </div>
  );
}

/** Merchant screens: signed in, and a merchant. */
function MerchantRoute({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  if (status === 'loading') return <FullPageSpinner />;
  if (status === 'signedOut') return <Navigate to="/login" replace />;
  if (status === 'needsOnboarding') return <Navigate to="/onboarding" replace />;
  return <>{children}</>;
}

/** Sign-in and sign-up: only while signed out. */
function SignedOutRoute({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  if (status === 'loading') return <FullPageSpinner />;
  if (status === 'merchant') return <Navigate to="/dashboard" replace />;
  if (status === 'needsOnboarding') return <Navigate to="/onboarding" replace />;
  return <>{children}</>;
}

/** "Set up my shop": signed in, not yet a merchant. */
function OnboardingRoute({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  if (status === 'loading') return <FullPageSpinner />;
  if (status === 'signedOut') return <Navigate to="/login" replace />;
  if (status === 'merchant') return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter basename="/merchant">
        <AuthProvider>
          <ToastProvider>
            <StoreProvider>
              <LiquidGlass />
              <Routes>
                <Route path="/login" element={<SignedOutRoute><LoginPage /></SignedOutRoute>} />
                <Route path="/register" element={<SignedOutRoute><RegisterPage /></SignedOutRoute>} />
                <Route path="/onboarding" element={<OnboardingRoute><OnboardingPage /></OnboardingRoute>} />

                <Route path="/" element={<MerchantRoute><MerchantLayout /></MerchantRoute>}>
                  <Route index element={<Navigate to="/dashboard" replace />} />
                  <Route path="dashboard" element={<DashboardPage />} />
                  <Route path="store/new" element={<StoreSetupPage isNewStore />} />
                  <Route path="store/:tab" element={<StoreSetupPage />} />
                  <Route path="categories" element={<CategoriesPage />} />
                  <Route path="products" element={<ProductsPage />} />
                  <Route path="inventory" element={<InventoryPage />} />
                  <Route path="inventory/history" element={<InventoryHistoryPage />} />
                  <Route path="orders" element={<OrdersPage />} />
                  <Route path="sales/new" element={<NewSalePage />} />
                  <Route path="sales" element={<SalesHistoryPage />} />
                </Route>

                <Route path="*" element={<Navigate to="/dashboard" replace />} />
              </Routes>
            </StoreProvider>
          </ToastProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
