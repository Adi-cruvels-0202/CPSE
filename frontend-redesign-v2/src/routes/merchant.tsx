import { createFileRoute, Outlet } from "@tanstack/react-router";
import merchantCss from "@/merchant/merchant.css?url";
import { AuthProvider } from "@/merchant/hooks/useAuth";
import { ToastProvider } from "@/merchant/hooks/useToast";
import { StoreProvider } from "@/merchant/hooks/useStore";
import { merchantHead } from "@/merchant/head";

/**
 * The merchant app. Its own session (cpse.merchant.session), its own
 * providers and stylesheet — nothing here is shared with the shopper's login.
 */
export const Route = createFileRoute("/merchant")({
  head: () => ({
    ...merchantHead("Your shop", "Run your neighbourhood shop: orders, stock, counter sales and customers."),
    links: [{ rel: "stylesheet", href: merchantCss }],
  }),
  component: MerchantRoot,
});

function MerchantRoot() {
  return (
    <div className="merchant-app min-h-screen bg-background">
      <AuthProvider>
        <ToastProvider>
          <StoreProvider>
            <Outlet />
          </StoreProvider>
        </ToastProvider>
      </AuthProvider>
    </div>
  );
}
