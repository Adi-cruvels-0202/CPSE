import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { ToastProvider } from './hooks/useToast';
import { StoreProvider } from './hooks/useStore';
import LiquidGlass from './components/glass/LiquidGlass';
import MerchantLayout from './components/layout/MerchantLayout';
import LoginPage from './features/auth/LoginPage';
import RegisterPage from './features/auth/RegisterPage';
import DashboardPage from './features/dashboard/DashboardPage';
import StoreSetupPage from './features/store/StoreSetupPage';
import CategoriesPage from './features/categories/CategoriesPage';
import ProductsPage from './features/products/ProductsPage';
import InventoryPage from './features/inventory/InventoryPage';
import InventoryHistoryPage from './features/inventory/InventoryHistoryPage';
import PurchasesPage from './features/purchases/PurchasesPage';
import BatchesPage from './features/batches/BatchesPage';
import NewSalePage from './features/sales/NewSalePage';
import SalesHistoryPage from './features/sales/SalesHistoryPage';
import OrdersPage from './features/orders/OrdersPage';
import StorefrontPage from './features/storefront/StorefrontPage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
});

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--color-bg)' }}>
      <div className="spinner spinner-lg" />
    </div>
  );
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--color-bg)' }}>
      <div className="spinner spinner-lg" />
    </div>
  );
  if (isAuthenticated) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <ToastProvider>
            <StoreProvider>
              <LiquidGlass />
              <Routes>
                {/* Public routes */}
                <Route path="/login" element={<PublicRoute><LoginPage /></PublicRoute>} />
                <Route path="/register" element={<PublicRoute><RegisterPage /></PublicRoute>} />

                {/* Public storefront */}
                <Route path="/shop/:slug" element={<StorefrontPage />} />

                {/* Protected merchant routes */}
                <Route path="/" element={<ProtectedRoute><MerchantLayout /></ProtectedRoute>}>
                  <Route index element={<Navigate to="/dashboard" replace />} />
                  <Route path="dashboard" element={<DashboardPage />} />
                  {/* Store */}
                  <Route path="store/setup" element={<StoreSetupPage isNewStore={false} />} />
                  <Route path="store/new" element={<StoreSetupPage isNewStore={true} />} />
                  <Route path="store/hours" element={<StoreSetupPage isNewStore={false} />} />
                  <Route path="store/delivery" element={<StoreSetupPage isNewStore={false} />} />
                  <Route path="store/payments" element={<StoreSetupPage isNewStore={false} />} />
                  <Route path="store/storefront" element={<StoreSetupPage isNewStore={false} />} />
                  {/* Catalogue */}
                  <Route path="categories" element={<CategoriesPage />} />
                  <Route path="products" element={<ProductsPage />} />
                  {/* Inventory */}
                  <Route path="inventory" element={<InventoryPage />} />
                  <Route path="inventory/history" element={<InventoryHistoryPage />} />
                  {/* Purchases & Batches */}
                  <Route path="purchases" element={<PurchasesPage />} />
                  <Route path="batches" element={<BatchesPage />} />
                  {/* Orders */}
                  <Route path="orders" element={<OrdersPage />} />
                  {/* Sales */}
                  <Route path="sales/new" element={<NewSalePage />} />
                  <Route path="sales" element={<SalesHistoryPage />} />
                </Route>

                {/* Catch-all */}
                <Route path="*" element={<Navigate to="/dashboard" replace />} />
              </Routes>
            </StoreProvider>
          </ToastProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
