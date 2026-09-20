import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell.jsx';
import { RequireAuth } from './components/RequireAuth.jsx';
import { Home } from './routes/Home.jsx';
import { Login } from './routes/auth/Login.jsx';
import { Register } from './routes/auth/Register.jsx';
import { ForgotPassword } from './routes/auth/ForgotPassword.jsx';
import { ResetPassword } from './routes/auth/ResetPassword.jsx';
import { Account } from './routes/Account.jsx';
import { StorePage } from './routes/store/StorePage.jsx';
import { ProductDetail } from './routes/store/ProductDetail.jsx';
import { StoreSearch } from './routes/store/StoreSearch.jsx';
import { CartPage } from './routes/cart/CartPage.jsx';
import { AddressesPage } from './routes/addresses/AddressesPage.jsx';
import { CheckoutPage } from './routes/checkout/CheckoutPage.jsx';
import { NotFound } from './routes/NotFound.jsx';
import { Placeholder } from './routes/Placeholder.jsx';

/**
 * The whole URL map — checklist 11.1 and 11.18.
 *
 * Every Phase 11 screen is routed now, as a placeholder naming the checklist item
 * that fills it in. That means navigation can be walked end to end before the
 * screens exist, and a link added later cannot quietly point at nothing.
 *
 * Which routes are public is the load-bearing decision here. A store page must
 * open for someone who followed a shared link and has no account (spec: public
 * store pages, backend 3.5) — so `/store/*` sits outside RequireAuth, as do the
 * credential screens. Everything a customer owns is gated.
 *
 * `/store/:slug` uses the slug because that is what a shared link carries;
 * everything authenticated uses ids, matching the backend (D35).
 */
export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        {/* ── Public ─────────────────────────────────────────────────────── */}
        <Route index element={<Home />} />

        <Route path="login" element={<Login />} />
        <Route path="register" element={<Register />} />
        <Route path="forgot-password" element={<ForgotPassword />} />
        {/* The URL in the emailed link. It must match PASSWORD_RESET_REDIRECT_URL
            in the backend's .env and Supabase's redirect allowlist. */}
        <Route path="reset-password" element={<ResetPassword />} />

        {/* A shared link or a QR code lands here, with no session. */}
        <Route path="store/:slug" element={<StorePage />} />
        <Route path="store/:slug/search" element={<StoreSearch />} />
        <Route path="store/:slug/product/:productId" element={<ProductDetail />} />

        {/* The gateway sends the customer back here. Public, because the return
            trip may land in a fresh tab before the session is restored. */}
        <Route
          path="payment/:orderId"
          element={<Placeholder title="Payment result" item="11.9" />}
        />
        {/* The mock provider's stand-in checkout page (PAYMENT_MOCK_CHECKOUT_URL). */}
        <Route path="mock-payment" element={<Placeholder title="Mock gateway" item="11.9" />} />

        {/* ── Signed in ──────────────────────────────────────────────────── */}
        <Route
          path="cart/:storeId"
          element={
            <RequireAuth>
              <CartPage />
            </RequireAuth>
          }
        />
        <Route
          path="checkout/:storeId"
          element={
            <RequireAuth>
              <CheckoutPage />
            </RequireAuth>
          }
        />
        <Route
          path="orders"
          element={
            <RequireAuth>
              <Placeholder title="Your orders" item="11.10" />
            </RequireAuth>
          }
        />
        <Route
          path="orders/:orderId"
          element={
            <RequireAuth>
              <Placeholder title="Order" item="11.10" />
            </RequireAuth>
          }
        />
        <Route
          path="orders/:orderId/receipt"
          element={
            <RequireAuth>
              <Placeholder title="Receipt" item="11.10" />
            </RequireAuth>
          }
        />
        <Route
          path="saved"
          element={
            <RequireAuth>
              <Placeholder title="Saved stores" item="11.13" />
            </RequireAuth>
          }
        />
        <Route
          path="notifications"
          element={
            <RequireAuth>
              <Placeholder title="Notifications" item="11.14" />
            </RequireAuth>
          }
        />
        <Route
          path="khata"
          element={
            <RequireAuth>
              <Placeholder title="Khata" item="11.15" />
            </RequireAuth>
          }
        />
        <Route
          path="khata/:accountId"
          element={
            <RequireAuth>
              <Placeholder title="Khata account" item="11.15" />
            </RequireAuth>
          }
        />
        <Route
          path="account"
          element={
            <RequireAuth>
              <Account />
            </RequireAuth>
          }
        />
        <Route
          path="account/addresses"
          element={
            <RequireAuth>
              <AddressesPage />
            </RequireAuth>
          }
        />

        {/* A bare /cart has no store to show; the shop screen is where you pick one. */}
        <Route path="cart" element={<Navigate to="/" replace />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
