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
import { OrdersPage } from './routes/orders/OrdersPage.jsx';
import { OrderPage } from './routes/orders/OrderPage.jsx';
import { ReceiptPage } from './routes/orders/ReceiptPage.jsx';
import { PaymentPage } from './routes/payment/PaymentPage.jsx';
import { MockPaymentPage } from './routes/payment/MockPaymentPage.jsx';
import { SavedStoresPage } from './routes/saved/SavedStoresPage.jsx';
import { NotificationsPage } from './routes/notifications/NotificationsPage.jsx';
import { KhataPage } from './routes/khata/KhataPage.jsx';
import { KhataAccountPage } from './routes/khata/KhataAccountPage.jsx';
import { NotFound } from './routes/NotFound.jsx';

/**
 * The whole URL map — checklist 11.1 and 11.18.
 *
 * Every Phase 11 screen through 11.15 is now a real screen. They were routed as
 * placeholders from the start so navigation could be walked end to end before they
 * existed; the last placeholder went with the khata view, and the component with it.
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
        {/* Public on purpose: a return from the gateway can land in a fresh tab
            before the session is restored, and the screen asks for a sign-in
            itself rather than losing the customer to a redirect. */}
        <Route path="payment/:orderId" element={<PaymentPage />} />
        {/* The mock provider's stand-in checkout page (PAYMENT_MOCK_CHECKOUT_URL). */}
        <Route path="mock-payment" element={<MockPaymentPage />} />

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
              <OrdersPage />
            </RequireAuth>
          }
        />
        <Route
          path="orders/:orderId"
          element={
            <RequireAuth>
              <OrderPage />
            </RequireAuth>
          }
        />
        <Route
          path="orders/:orderId/receipt"
          element={
            <RequireAuth>
              <ReceiptPage />
            </RequireAuth>
          }
        />
        <Route
          path="saved"
          element={
            <RequireAuth>
              <SavedStoresPage />
            </RequireAuth>
          }
        />
        <Route
          path="notifications"
          element={
            <RequireAuth>
              <NotificationsPage />
            </RequireAuth>
          }
        />
        <Route
          path="khata"
          element={
            <RequireAuth>
              <KhataPage />
            </RequireAuth>
          }
        />
        <Route
          path="khata/:accountId"
          element={
            <RequireAuth>
              <KhataAccountPage />
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
