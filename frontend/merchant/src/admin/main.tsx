import React, { Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '../hooks/useToast';
import { Spinner } from '../components/common/ui';
import AdminApp from './AdminApp';
import '../styles/global.css';

/**
 * The CPSE admin portal as its own app at /admin — its own page, title, build
 * (vite.admin.config.ts → dist-admin/) and session, separate from the shop app
 * at /merchant and the customer app at /. It shares the shop app's components
 * and styles, so the two never drift apart. One admin controls both sides:
 * customer and shop accounts, stores, verification and support.
 */
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 15_000 } },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ToastProvider>
          <Suspense fallback={<Spinner large />}>
            <Routes>
              <Route path="/admin/*" element={<AdminApp />} />
              <Route path="*" element={<Navigate to="/admin" replace />} />
            </Routes>
          </Suspense>
        </ToastProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
