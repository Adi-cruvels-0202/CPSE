import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, Loader2, Minus, Plus, ShoppingBasket, Store as StoreIcon, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { endpoints } from "@/lib/cpse/endpoints";
import { formatPaise, formatPaiseShort } from "@/lib/cpse/money";
import { RequireAuth } from "@/customer/RequireAuth";
import { useAllCarts } from "@/customer/hooks";
import { SmartImage } from "@/components/cpse/SmartImage";
import { EmptyState, ErrorState, Skel } from "@/components/cpse/States";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/cart/")({
  head: () => ({
    meta: [
      { title: "Your cart — CPSE" },
      { name: "description", content: "Review items from all your CPSE shops." },
      { property: "og:title", content: "Your cart — CPSE" },
      { property: "og:description", content: "Review items from all your CPSE shops." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <RequireAuth>
      <CartIndex />
    </RequireAuth>
  ),
});

function CartIndex() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const query = useAllCarts();
  const [busyLine, setBusyLine] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<any>(null);
  const carts = query.data?.carts ?? [];
  const total = carts.reduce((sum: number, entry: any) => sum + (entry.cart.totals?.totalPaise ?? 0), 0);
  const itemCount = carts.reduce((sum: number, entry: any) => sum + (entry.cart.totals?.totalQuantity ?? 0), 0);
  const ready = carts.length > 0 && carts.every((entry: any) => entry.cart.isCheckoutReady);

  const mutate = async (lineId: string, fn: () => Promise<any>) => {
    setBusyLine(lineId);
    setError(null);
    try {
      await fn();
      await queryClient.invalidateQueries({ queryKey: ["cart"] });
    } catch (cause: any) {
      setError(cause);
      toast.error(cause?.message ?? "Could not update your cart.");
    } finally {
      setBusyLine(null);
    }
  };

  const checkout = async () => {
    if (checking || !ready) return;
    setChecking(true);
    setError(null);
    try {
      for (const entry of carts) {
        const cart = entry.cart;
        const { data } = await endpoints.cart.validate({
          storeId: cart.storeId,
          items: cart.lines.map((line: any) => ({ itemId: line.id, unitPricePaise: line.unitPricePaise })),
        });
        const fresh = data.cart;
        const hasIssues = (fresh.issues?.length ?? 0) > 0 || fresh.lines.some((line: any) => (line.issues?.length ?? 0) > 0);
        if (hasIssues || !fresh.isCheckoutReady) {
          await queryClient.invalidateQueries({ queryKey: ["cart"] });
          setError(new Error(`${cart.storeName}’s cart changed. Review it before checkout.`));
          return;
        }
      }
      if (carts.length === 1) {
        await navigate({ to: "/checkout/$storeId", params: { storeId: carts[0].cart.storeId } });
      } else {
        await navigate({ to: "/checkout/group" });
      }
    } catch (cause) {
      setError(cause);
    } finally {
      setChecking(false);
    }
  };

  if (query.isLoading) {
    return (
      <div role="status" aria-label="Loading your carts" className="mx-auto grid max-w-5xl gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-4">{[0, 1].map((n) => <Skel key={n} className="h-64 rounded-2xl" />)}</div>
        <Skel className="h-64 rounded-2xl" />
      </div>
    );
  }
  if (query.error) return <ErrorState error={query.error} title="Could not load your cart" onRetry={() => query.refetch()} />;
  if (!carts.length) {
    return (
      <EmptyState icon={<ShoppingBasket />} title="Your cart is empty" body="Add items from any shop and they’ll all be collected here.">
        <Button asChild variant="ink"><Link to="/">Find a shop</Link></Button>
      </EmptyState>
    );
  }

  return (
    <div className="mx-auto max-w-6xl">
      <header className="mb-5">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-primary-strong">Your cart</p>
        <h1 className="text-3xl font-extrabold sm:text-4xl">{itemCount} {itemCount === 1 ? "item" : "items"} from {carts.length} {carts.length === 1 ? "shop" : "shops"}</h1>
        <p className="mt-1 text-sm text-muted-foreground">Each shop prepares and fulfils its own part of your order.</p>
      </header>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-4">
          {error ? <p role="alert" className="rounded-xl border border-warning/40 bg-warning-soft px-4 py-3 text-sm">{error.message ?? "Something needs your attention."}</p> : null}
          {carts.map(({ cart, store }: any) => (
            <section key={cart.storeId} className="overflow-hidden rounded-2xl border border-border bg-card">
              <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-paper px-4 py-3">
                <div className="min-w-0">
                  <h2 className="truncate text-lg font-bold"><Link to="/store/$slug" params={{ slug: cart.storeSlug }} className="hover:underline">{cart.storeName}</Link></h2>
                  <p className="text-xs text-muted-foreground">{store.location?.city ?? "Local shop"} · {cart.totals.totalQuantity} {cart.totals.totalQuantity === 1 ? "item" : "items"}</p>
                </div>
                <span className="numeric font-bold">{formatPaise(cart.totals.totalPaise)}</span>
              </header>
              {cart.issues?.length ? <ul className="space-y-1 px-4 pt-3 text-sm text-destructive">{cart.issues.map((issue: any, index: number) => <li key={`${issue.code}-${index}`} className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{issue.message}</li>)}</ul> : null}
              <ul className="divide-y divide-dashed divide-border">
                {cart.lines.map((line: any) => {
                  const busy = busyLine === line.id;
                  return (
                    <li key={line.id} className={cn("grid grid-cols-[3.5rem_minmax(0,1fr)] gap-3 p-3 sm:grid-cols-[4rem_minmax(0,1fr)_auto] sm:items-center sm:gap-4 sm:p-4", busy && "opacity-60")}>
                      <SmartImage src={line.imageUrl} name={line.name} alt="" className="h-14 w-14 rounded-xl bg-sunk text-xs text-muted-foreground sm:h-16 sm:w-16" />
                      <div className="min-w-0">
                        <p className="truncate font-semibold">{line.name}</p>
                        {line.variantName ? <p className="truncate text-xs text-muted-foreground">{line.variantName}</p> : null}
                        <p className="numeric mt-0.5 text-xs text-muted-foreground">{formatPaiseShort(line.unitPricePaise)} each</p>
                        {line.issues?.length ? <p className="mt-1 text-xs text-destructive">{line.issues[0].message}</p> : null}
                      </div>
                      <div className="col-span-2 flex items-center justify-between gap-3 sm:col-span-1 sm:justify-end">
                        <span className="numeric font-bold sm:hidden">{formatPaise(line.lineTotalPaise)}</span>
                        <div className="flex items-center gap-2">
                          <div className="inline-flex h-9 items-center rounded-full border border-border-strong/30 bg-background" role="group" aria-label={`Quantity of ${line.name}`}>
                            <button type="button" disabled={busy} onClick={() => mutate(line.id, () => line.quantity <= 1 ? endpoints.cart.removeItem(line.id) : endpoints.cart.updateItem(line.id, { quantity: line.quantity - 1 }))} className="grid h-9 w-9 place-items-center rounded-full hover:bg-accent" aria-label="Remove one"><Minus className="h-4 w-4" /></button>
                            <span className="numeric w-7 text-center text-sm font-bold" aria-live="polite">{busy ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : line.quantity}</span>
                            <button type="button" disabled={busy || (line.stock != null && line.quantity >= line.stock)} onClick={() => mutate(line.id, () => endpoints.cart.updateItem(line.id, { quantity: line.quantity + 1 }))} className="grid h-9 w-9 place-items-center rounded-full hover:bg-accent disabled:opacity-40" aria-label="Add one"><Plus className="h-4 w-4" /></button>
                          </div>
                          <button type="button" disabled={busy} onClick={() => mutate(line.id, () => endpoints.cart.removeItem(line.id))} className="grid h-9 w-9 place-items-center rounded-full text-muted-foreground hover:bg-destructive-soft hover:text-destructive" aria-label={`Remove ${line.name}`}><Trash2 className="h-4 w-4" /></button>
                        </div>
                        <span className="numeric hidden font-bold sm:inline">{formatPaise(line.lineTotalPaise)}</span>
                      </div>
                    </li>
                  );
                })}
              </ul>
              <footer className="flex flex-wrap justify-between gap-2 border-t border-border px-4 py-3">
                <Button asChild variant="ghost" size="sm"><Link to="/store/$slug" params={{ slug: cart.storeSlug }}><StoreIcon /> Keep shopping</Link></Button>
                <Button variant="ghost" size="sm" className="text-destructive" onClick={() => { if (window.confirm(`Empty your ${cart.storeName} cart?`)) void mutate(cart.storeId, () => endpoints.cart.clear(cart.storeId)); }}><Trash2 /> Empty shop cart</Button>
              </footer>
            </section>
          ))}
        </div>

        <aside aria-label="Combined cart summary" className="lg:sticky lg:top-28">
          <div className="rounded-2xl border border-border bg-card p-5">
            <h2 className="text-lg font-bold">Basket summary</h2>
            <div className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between gap-4"><span className="text-muted-foreground">Items before delivery</span><span className="numeric font-semibold">{formatPaise(total)}</span></div>
              <div className="flex justify-between gap-4"><span className="text-muted-foreground">Delivery</span><span className="text-muted-foreground">Set per shop</span></div>
              <div className="flex justify-between gap-4"><span className="text-muted-foreground">Shop orders</span><span className="font-semibold">{carts.length}</span></div>
            </div>
            <Button size="lg" className="mt-5 w-full" onClick={() => void checkout()} disabled={!ready || checking}>
              {checking ? <Loader2 className="animate-spin" /> : null}
              {checking ? "Checking shop carts…" : carts.length > 1 ? "Checkout all shops" : "Continue to checkout"}
              {!checking ? <ArrowRight /> : null}
            </Button>
            {!ready ? <p className="mt-2 text-xs text-muted-foreground">Fix the item availability notes above to continue.</p> : null}
          </div>
        </aside>
      </div>
    </div>
  );
}
