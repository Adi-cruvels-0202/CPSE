import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Minus, Plus, Trash2, ShoppingBasket, ArrowRight, Loader2, AlertTriangle, Store as StoreIcon } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { endpoints } from "@/lib/cpse/endpoints";
import { formatPaise, formatPaiseShort } from "@/lib/cpse/money";
import { RequireAuth } from "@/customer/RequireAuth";
import { useCart } from "@/customer/hooks";
import { SmartImage } from "@/components/cpse/SmartImage";
import { EmptyState, ErrorState, InlineError, Skel } from "@/components/cpse/States";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/cart/$storeId")({
  head: () => ({
    meta: [
      { title: "Your cart — CPSE" },
      { name: "description", content: "Review quantities and totals before checkout." },
      { property: "og:title", content: "Your cart — CPSE" },
      { property: "og:description", content: "Review quantities and totals before checkout." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <RequireAuth>
      <CartPage />
    </RequireAuth>
  ),
});

const SEVERE = new Set(["ITEM_UNAVAILABLE", "OUT_OF_STOCK"]);

function describeIssue(issue: any) {
  if (issue.code === "PRICE_CHANGED" && issue.previousUnitPricePaise !== undefined) {
    return `Price changed from ${formatPaiseShort(issue.previousUnitPricePaise)} to ${formatPaiseShort(issue.unitPricePaise)}.`;
  }
  return issue.message ?? "Something needs your attention.";
}

function IssueList({ issues, className }: { issues?: any[]; className?: string }) {
  if (!issues?.length) return null;
  return (
    <ul role="status" className={cn("space-y-1.5", className)}>
      {issues.map((issue, i) => (
        <li
          key={`${issue.code}-${i}`}
          className={cn(
            "flex items-start gap-2 rounded-lg px-3 py-2 text-sm",
            SEVERE.has(issue.code) ? "bg-destructive-soft text-destructive" : "bg-warning-soft text-foreground",
          )}
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {describeIssue(issue)}
        </li>
      ))}
    </ul>
  );
}

function CartPage() {
  const { storeId } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const cartQuery = useCart(storeId);
  const [busyLine, setBusyLine] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [actionError, setActionError] = useState<any>(null);
  const [driftFound, setDriftFound] = useState(false);

  const cart = cartQuery.data?.cart;

  const mutate = async (lineId: string | null, fn: () => Promise<any>) => {
    setBusyLine(lineId);
    setActionError(null);
    setDriftFound(false);
    try {
      const { data } = await fn();
      if (data?.cart) queryClient.setQueryData(["cart", storeId], { cart: data.cart });
    } catch (e: any) {
      setActionError(e);
      toast.error(e?.message ?? "Could not update your cart.");
    } finally {
      setBusyLine(null);
    }
  };

  const goToCheckout = async () => {
    if (checking || !cart) return;
    setChecking(true);
    setActionError(null);
    try {
      const { data } = await endpoints.cart.validate({
        storeId,
        items: cart.lines.map((line: any) => ({ itemId: line.id, unitPricePaise: line.unitPricePaise })),
      });
      const fresh = data.cart;
      queryClient.setQueryData(["cart", storeId], { cart: fresh });
      const hasIssues = (fresh.issues?.length ?? 0) > 0 || fresh.lines.some((l: any) => (l.issues?.length ?? 0) > 0);
      if (hasIssues || !fresh.isCheckoutReady) {
        setDriftFound(true);
        return;
      }
      navigate({ to: "/checkout/$storeId", params: { storeId } });
    } catch (e) {
      setActionError(e);
    } finally {
      setChecking(false);
    }
  };

  if (cartQuery.isLoading) {
    return (
      <div role="status" aria-label="Loading your cart" className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-3">{[0, 1, 2].map((k) => <Skel key={k} className="h-24 rounded-2xl" />)}</div>
        <Skel className="h-64 rounded-2xl" />
      </div>
    );
  }
  if (cartQuery.error && !cart) return <ErrorState error={cartQuery.error} title="Could not load your cart" onRetry={() => cartQuery.refetch()} />;

  if (!cart || cart.lines.length === 0) {
    return (
      <EmptyState
        icon={<ShoppingBasket />}
        title="Nothing in this cart yet"
        body={cart?.storeName ? `Add a few things from ${cart.storeName} and they’ll show up here.` : "Open a shop and add something to start a cart."}
      >
        {cart?.storeSlug ? (
          <Button asChild variant="ink">
            <Link to="/store/$slug" params={{ slug: cart.storeSlug }}>Back to {cart.storeName}</Link>
          </Button>
        ) : null}
        <Button asChild variant="outline">
          <Link to="/">All shops</Link>
        </Button>
      </EmptyState>
    );
  }

  const t = cart.totals;

  return (
    <div>
      <header className="mb-6">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-primary-strong">Your cart</p>
        <h1 className="text-3xl font-extrabold sm:text-4xl">
          <Link to="/store/$slug" params={{ slug: cart.storeSlug }} className="hover:underline">{cart.storeName}</Link>
        </h1>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section aria-label="Items">
          <IssueList issues={cart.issues} className="mb-4" />
          {driftFound ? (
            <p role="alert" className="mb-4 rounded-xl border border-warning/40 bg-warning-soft px-4 py-3 text-sm font-medium">
              Something changed since you added these. Check the notes below, then continue.
            </p>
          ) : null}
          <ul className="surface divide-y divide-dashed">
            {cart.lines.map((line: any) => {
              const busy = busyLine === line.id;
              return (
                <li key={line.id} className={cn("grid grid-cols-[4rem_minmax(0,1fr)] gap-4 p-4 sm:grid-cols-[5rem_minmax(0,1fr)_auto]", busy && "opacity-70")}>
                  <SmartImage src={line.imageUrl} name={line.name} alt="" className="h-16 w-16 rounded-xl bg-sunk text-sm text-muted-foreground sm:h-20 sm:w-20" />
                  <div className="min-w-0">
                    <p className="font-semibold">{line.name}</p>
                    {line.variantName ? <p className="text-sm text-muted-foreground">{line.variantName}</p> : null}
                    <p className="numeric text-sm text-muted-foreground">
                      {formatPaiseShort(line.unitPricePaise)} each
                      {line.taxPercent > 0 ? ` · ${line.taxPercent}% GST` : ""}
                    </p>
                    <IssueList issues={line.issues} className="mt-2" />
                  </div>
                  <div className="col-span-2 flex items-center justify-between gap-3 sm:col-span-1 sm:flex-col sm:items-end">
                    <span className="numeric text-lg font-extrabold">{formatPaise(line.lineTotalPaise)}</span>
                    <div className="flex items-center gap-2">
                      <div className="inline-flex h-9 items-center rounded-full border border-border-strong/40 bg-card" role="group" aria-label={`Quantity of ${line.name}`}>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => mutate(line.id, () => (line.quantity <= 1 ? endpoints.cart.removeItem(line.id) : endpoints.cart.updateItem(line.id, { quantity: line.quantity - 1 })))}
                          className="grid h-9 w-9 place-items-center rounded-full hover:bg-accent"
                          aria-label="One fewer"
                        >
                          <Minus className="h-4 w-4" />
                        </button>
                        <span className="numeric w-8 text-center font-bold" aria-live="polite">
                          {busy ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : line.quantity}
                        </span>
                        <button
                          type="button"
                          disabled={busy || (line.stock !== null && line.stock !== undefined && line.quantity >= line.stock)}
                          onClick={() => mutate(line.id, () => endpoints.cart.updateItem(line.id, { quantity: line.quantity + 1 }))}
                          className="grid h-9 w-9 place-items-center rounded-full hover:bg-accent disabled:opacity-40"
                          aria-label="One more"
                        >
                          <Plus className="h-4 w-4" />
                        </button>
                      </div>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => mutate(line.id, () => endpoints.cart.removeItem(line.id))}
                        className="grid h-9 w-9 place-items-center rounded-full text-muted-foreground hover:bg-destructive-soft hover:text-destructive"
                        aria-label={`Remove ${line.name}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="mt-4 flex flex-wrap justify-between gap-2">
            <Button asChild variant="ghost">
              <Link to="/store/$slug" params={{ slug: cart.storeSlug }}>
                <StoreIcon /> Keep shopping
              </Link>
            </Button>
            <Button
              variant="ghost"
              className="text-destructive"
              onClick={() => {
                if (window.confirm(`Empty your ${cart.storeName} cart?`)) mutate(null, () => endpoints.cart.clear(storeId));
              }}
            >
              <Trash2 /> Empty cart
            </Button>
          </div>
        </section>

        <aside aria-label="Order summary" className="lg:sticky lg:top-28 lg:self-start">
          <div className="surface p-5">
            <h2 className="mb-4 text-lg font-bold">Summary</h2>
            <dl className="space-y-2 text-sm">
              <Row label={`Items (${t.totalQuantity})`} value={formatPaise(t.subtotalPaise)} />
              {t.discountPaise > 0 ? <Row label="Savings" value={`−${formatPaise(t.discountPaise)}`} tone="success" /> : null}
              <Row label="GST" value={formatPaise(t.taxPaise)} />
              <Row label="Delivery" value="Chosen at checkout" muted />
            </dl>
            <div className="mt-4 flex items-baseline justify-between border-t border-dashed pt-4">
              <span className="font-bold">Total</span>
              <span className="numeric font-display text-2xl font-extrabold">{formatPaise(t.totalPaise)}</span>
            </div>
            <InlineError error={actionError} className="mt-3" />
            <Button size="lg" className="mt-4 w-full" onClick={goToCheckout} disabled={checking || !cart.isCheckoutReady}>
              {checking ? <Loader2 className="animate-spin" /> : null}
              {checking ? "Checking prices…" : "Continue to checkout"}
              {!checking ? <ArrowRight /> : null}
            </Button>
            {!cart.isCheckoutReady ? <p className="mt-2 text-xs text-muted-foreground">Sort out the notes above to continue.</p> : null}
          </div>
        </aside>
      </div>
    </div>
  );
}

function Row({ label, value, tone, muted }: { label: string; value: string; tone?: "success"; muted?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn("numeric font-semibold", tone === "success" && "text-success", muted && "font-normal text-muted-foreground")}>{value}</dd>
    </div>
  );
}
