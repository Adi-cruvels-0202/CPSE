import { useQuery } from "@tanstack/react-query";
import { Plus, ExternalLink, AlertTriangle, ArrowRight, Calculator, Package, ClipboardList, ReceiptText, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { OrderStamp } from "@/components/cpse/Stamp";
import { useAuth } from "@/merchant/hooks/useAuth";
import { useActiveStore } from "@/merchant/hooks/useStore";
import { dashboardApi } from "@/merchant/api/endpoints";
import { errorMessage } from "@/merchant/api/client";
import { formatPaise } from "@/merchant/lib/money";
import { formatDateTime } from "@/merchant/components/common/ui";
import { Link, Navigate } from "@/merchant/router";

export function Dashboard() {
  const { merchant, stores, status } = useAuth();
  const { activeStoreId } = useActiveStore();
  const currentStore = stores.find((s) => s.id === activeStoreId);
  const { data, isLoading, error } = useQuery({
    queryKey: ["dashboard", activeStoreId],
    queryFn: () => dashboardApi.get(activeStoreId!),
    enabled: !!activeStoreId,
    refetchInterval: 30_000,
  });
  const dashboard = data?.dashboard;

  if (status === "merchant" && stores.length === 0) return <Navigate to="/store/new" replace />;
  if (!activeStoreId || isLoading)
    return (
      <div className="grid place-items-center py-24" role="status" aria-label="Loading">
        <Loader2 className="h-7 w-7 animate-spin text-primary-strong" />
      </div>
    );

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const firstName = (merchant?.fullName ?? "").split(" ")[0];
  const waiting = dashboard ? dashboard.openOrders.placed : 0;

  return (
    <div>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold sm:text-4xl">
            {greeting}
            {firstName ? `, ${firstName}` : ""}
          </h1>
          <p className="mt-2 flex items-center gap-2 text-muted-foreground">
            <span className={cn("h-2 w-2 rounded-full", currentStore?.isPublished ? "bg-success" : "bg-muted-foreground")} aria-hidden="true" />
            <span className="font-semibold text-foreground">{currentStore?.name}</span>
            <span>· {currentStore?.isPublished ? "Published" : "Not published yet"}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="default" size="lg">
            <Link to="/sales/new"><Plus /> New counter sale</Link>
          </Button>
          {currentStore?.isPublished ? (
            <Button asChild variant="outline" size="lg">
              <a href={`/v2/store/${currentStore.slug}`} target="_blank" rel="noopener noreferrer">
                View store <ExternalLink />
              </a>
            </Button>
          ) : null}
        </div>
      </header>

      {error ? (
        <p role="alert" className="mb-6 rounded-xl border border-destructive/40 bg-destructive-soft px-4 py-3 text-sm text-destructive">{errorMessage(error)}</p>
      ) : null}

      {dashboard ? (
        <>
          {waiting > 0 ? (
            <Link
              to="/orders"
              className="mb-6 flex items-center gap-4 rounded-2xl bg-primary p-4 text-primary-foreground shadow-lift transition-transform hover:-translate-y-0.5 sm:p-5"
            >
              <span className="numeric grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-ink font-display text-2xl font-extrabold text-ink-foreground">{waiting}</span>
              <span className="flex-1">
                <span className="block text-lg font-extrabold">New order{waiting === 1 ? "" : "s"} waiting for you</span>
                <span className="text-sm font-medium opacity-80">Accept {waiting === 1 ? "it" : "them"} so the customer knows you’re on it.</span>
              </span>
              <ArrowRight className="h-5 w-5" />
            </Link>
          ) : null}

          {/* Takings ledger */}
          <section aria-label="Today" className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-2xl bg-ink p-5 text-ink-foreground sm:col-span-2 lg:col-span-1">
              <p className="text-sm text-ink-muted">Today’s takings</p>
              <p className="numeric mt-1 font-display text-4xl font-extrabold">{formatPaise(dashboard.today.ordersRevenuePaise + dashboard.today.salesRevenuePaise)}</p>
              <p className="mt-1 text-xs text-ink-muted">online orders and counter sales</p>
            </div>
            <Metric label="Online orders" value={dashboard.today.ordersCount} sub={`${formatPaise(dashboard.today.ordersRevenuePaise, { decimals: 0 })} today`} />
            <Metric label="Counter sales" value={dashboard.today.salesCount} sub={`${formatPaise(dashboard.today.salesRevenuePaise, { decimals: 0 })} today`} />
            <Metric label="Low stock" value={dashboard.lowStock.length} sub="at or below threshold" warn={dashboard.lowStock.length > 0} />
          </section>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
            <div className="space-y-6">
              <section className="surface p-5" aria-labelledby="pipeline-h">
                <h2 id="pipeline-h" className="mb-3 text-lg font-bold">Orders in progress</h2>
                <ol className="space-y-1">
                  {(
                    [
                      ["New — needs accepting", dashboard.openOrders.placed, "placed"],
                      ["Accepted", dashboard.openOrders.accepted, "accepted"],
                      ["Being prepared", dashboard.openOrders.preparing, "preparing"],
                      ["Ready / out for delivery", dashboard.openOrders.ready, "ready_for_pickup"],
                    ] as const
                  ).map(([label, count, s], i) => (
                    <li key={label} className="flex items-center gap-3 rounded-xl px-2 py-2.5">
                      <span className="numeric grid h-7 w-7 place-items-center rounded-full bg-sunk text-xs font-bold text-muted-foreground">{i + 1}</span>
                      <span className="flex-1 font-medium">{label}</span>
                      <span className={cn("numeric min-w-8 rounded-full px-2.5 py-0.5 text-center text-sm font-bold", count > 0 ? (s === "placed" ? "bg-primary text-primary-foreground" : "bg-info-soft text-info") : "text-muted-foreground")}>{count}</span>
                    </li>
                  ))}
                </ol>
              </section>

              <section aria-labelledby="quick-h">
                <h2 id="quick-h" className="mb-3 text-lg font-bold">Quick actions</h2>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { to: "/sales/new", icon: Calculator, t: "Counter sale", d: "Bill a walk-in customer" },
                    { to: "/products", icon: Package, t: "Products", d: "Manage the catalogue" },
                    { to: "/inventory", icon: ClipboardList, t: "Stock", d: "Receive and count stock" },
                    { to: "/orders", icon: ReceiptText, t: "Online orders", d: "Accept and fulfil" },
                  ].map((a) => (
                    <Link key={a.to} to={a.to} className="surface press flex flex-col gap-3 p-4 hover:border-border-strong">
                      <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary-soft text-primary-strong">
                        <a.icon className="h-5 w-5" />
                      </span>
                      <span>
                        <span className="block font-bold">{a.t}</span>
                        <span className="text-sm text-muted-foreground">{a.d}</span>
                      </span>
                    </Link>
                  ))}
                </div>
              </section>
            </div>

            <section className="surface overflow-hidden" aria-labelledby="recent-h">
              <div className="flex items-center justify-between px-5 pt-5">
                <h2 id="recent-h" className="text-lg font-bold">Recent orders</h2>
                <Link to="/orders" className="text-sm font-bold text-primary-strong hover:underline">All orders</Link>
              </div>
              {dashboard.recentOrders.length === 0 ? (
                <p className="px-5 py-10 text-center text-muted-foreground">No online orders yet.</p>
              ) : (
                <ul className="mt-3 divide-y divide-dashed">
                  {dashboard.recentOrders.map((order) => (
                    <li key={order.id}>
                      <Link to={`/orders?open=${order.id}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-5 py-3 hover:bg-accent/50 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
                        <span className="min-w-0">
                          <span className="numeric block font-bold">{order.orderNumber}</span>
                          <span className="text-xs text-muted-foreground">{formatDateTime(order.placedAt)} · {order.fulfilmentMode === "delivery" ? "Delivery" : "Pickup"}</span>
                        </span>
                        <span className="numeric text-right font-bold sm:order-last">{formatPaise(order.totalPaise)}</span>
                        <span className="col-span-2 sm:col-span-1">
                          <OrderStamp status={order.status} label={order.statusLabel} />
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          {dashboard.lowStock.length > 0 ? (
            <section className="surface mt-6 overflow-hidden" aria-labelledby="low-h">
              <div className="flex flex-wrap items-center gap-3 border-b border-dashed bg-warning-soft/60 px-5 py-4">
                <AlertTriangle className="h-5 w-5 text-warning" />
                <h2 id="low-h" className="flex-1 font-bold">Running low</h2>
                <Button asChild size="sm" variant="ink">
                  <Link to="/inventory">Restock</Link>
                </Button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-5 py-3 font-bold">Product</th>
                      <th className="px-5 py-3 font-bold">Variant</th>
                      <th className="px-5 py-3 text-right font-bold">Can still sell</th>
                      <th className="px-5 py-3 text-right font-bold">Alert at</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-dashed">
                    {dashboard.lowStock.map((row) => (
                      <tr key={row.variantId}>
                        <td className="px-5 py-3 font-semibold">{row.productName}</td>
                        <td className="px-5 py-3 text-muted-foreground">{row.variantName === "Default" ? "—" : row.variantName}</td>
                        <td className="px-5 py-3 text-right">
                          <span className={cn("numeric rounded-full px-2.5 py-0.5 font-bold", row.availableQuantity <= 0 ? "bg-destructive-soft text-destructive" : "bg-warning-soft text-warning")}>{row.availableQuantity}</span>
                        </td>
                        <td className="numeric px-5 py-3 text-right">{row.lowStockThreshold}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function Metric({ label, value, sub, warn }: { label: string; value: number; sub: string; warn?: boolean }) {
  return (
    <div className="surface p-5">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={cn("numeric mt-1 font-display text-3xl font-extrabold", warn && "text-warning")}>{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
    </div>
  );
}
