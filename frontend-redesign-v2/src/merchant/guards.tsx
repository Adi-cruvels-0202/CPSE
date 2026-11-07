import { useState, type ReactNode } from "react";
import { Loader2, Store, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/merchant/hooks/useAuth";
import { Navigate } from "@/merchant/router";

export function FullPageSpinner() {
  return (
    <div className="grid min-h-screen place-items-center bg-background" role="status" aria-label="Loading">
      <Loader2 className="h-8 w-8 animate-spin text-primary-strong" />
    </div>
  );
}

/** The account could not be loaded — offer a retry, not an empty shop. */
function UnavailableScreen() {
  const { refresh, logout } = useAuth();
  const [retrying, setRetrying] = useState(false);
  const retry = () => {
    setRetrying(true);
    refresh().catch(() => undefined).finally(() => setRetrying(false));
  };
  return (
    <div className="grid min-h-screen place-items-center bg-background p-4">
      <div className="surface flex max-w-sm flex-col items-center gap-3 p-8 text-center">
        <span className="grid h-14 w-14 place-items-center rounded-2xl bg-primary-soft text-primary-strong">
          <Store className="h-7 w-7" />
        </span>
        <h1 className="text-xl font-bold">Couldn’t reach CPSE</h1>
        <p className="text-muted-foreground">Check your connection and try again. Your shop and orders are safe.</p>
        <div className="mt-2 flex gap-2">
          <Button variant="ink" onClick={retry} disabled={retrying}>
            {retrying ? <Loader2 className="animate-spin" /> : <RotateCw />} {retrying ? "Trying…" : "Try again"}
          </Button>
          <Button variant="ghost" onClick={logout}>Sign out</Button>
        </div>
      </div>
    </div>
  );
}

/** Merchant screens: signed in, and a merchant. */
export function MerchantRoute({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  if (status === "loading") return <FullPageSpinner />;
  if (status === "unavailable") return <UnavailableScreen />;
  if (status === "signedOut") return <Navigate to="/login" replace />;
  return <>{children}</>;
}

/** Sign-in and sign-up: only while signed out. */
export function SignedOutRoute({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  if (status === "loading") return <FullPageSpinner />;
  if (status === "merchant") return <Navigate to="/dashboard" replace />;
  if (status === "unavailable") return <UnavailableScreen />;
  return <>{children}</>;
}
