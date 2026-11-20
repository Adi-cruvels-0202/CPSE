import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { OrderStamp } from "@/components/cpse/Stamp";
import { useAuth } from "@/merchant/hooks/useAuth";
import { useActiveStore } from "@/merchant/hooks/useStore";
import { dashboardApi } from "@/merchant/api/endpoints";
import { errorMessage } from "@/merchant/api/client";
import { formatPaise } from "@/merchant/lib/money";
import { formatDateTime, PageLoadingSkeleton } from "@/merchant/components/common/ui";
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
    return <PageLoadingSkeleton />;

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const firstName = (merchant?.fullName ?? "").split(" ")[0];
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
      </header>

      {error ? (
        <p role="alert" className="mb-6 rounded-xl border border-destructive/40 bg-destructive-soft px-4 py-3 text-sm text-destructive">{errorMessage(error)}</p>
      ) : null}

      {dashboard ? (
        <>
          {/* Takings ledger */}
          <section aria-label="Today" className="mb-5 grid grid-cols-2 gap-2.5 sm:mb-6 sm:gap-3 lg:grid-cols-4">
            <div className="min-w-0 rounded-2xl bg-ink p-3.5 text-ink-foreground sm:p-5">
              <p className="text-xs text-ink-muted sm:text-sm">Today’s takings</p>
              <p className="numeric mt-1 truncate font-display text-2xl font-extrabold sm:text-4xl">{formatPaise(dashboard.today.ordersRevenuePaise + dashboard.today.salesRevenuePaise)}</p>
              <p className="mt-1 text-[10px] leading-tight text-ink-muted sm:text-xs">online orders and counter sales</p>
            </div>
            <Metric label="Online orders" value={dashboard.today.ordersCount} sub={`${formatPaise(dashboard.today.ordersRevenuePaise, { decimals: 0 })} today`} />
            <Metric label="Counter sales" value={dashboard.today.salesCount} sub={`${formatPaise(dashboard.today.salesRevenuePaise, { decimals: 0 })} today`} />
            <Metric label="Low stock" value={dashboard.lowStock.length} sub="at or below threshold" warn={dashboard.lowStock.length > 0} />
          </section>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
            <div className="space-y-6">
              <section className="surface p-4 sm:p-5" aria-labelledby="pipeline-h">
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
                    <li key={label} className="flex items-center gap-3 rounded-xl px-1.5 py-2 sm:px-2 sm:py-2.5">
                      <span className="numeric grid h-7 w-7 place-items-center rounded-full bg-sunk text-xs font-bold text-muted-foreground">{i + 1}</span>
                      <span className="flex-1 font-medium">{label}</span>
                      <span className={cn("numeric min-w-8 rounded-full px-2.5 py-0.5 text-center text-sm font-bold", count > 0 ? (s === "placed" ? "bg-primary text-primary-foreground" : "bg-info-soft text-info") : "text-muted-foreground")}>{count}</span>
                    </li>
                  ))}
                </ol>
              </section>

            </div>

            <section className="surface overflow-hidden" aria-labelledby="recent-h">
              <div className="flex items-center justify-between px-4 pt-4 sm:px-5 sm:pt-5">
                <h2 id="recent-h" className="text-lg font-bold">Recent orders</h2>
                <Link to="/orders" className="text-sm font-bold text-primary-strong hover:underline">All orders</Link>
              </div>
              {dashboard.recentOrders.length === 0 ? (
                <p className="px-5 py-10 text-center text-muted-foreground">No online orders yet.</p>
              ) : (
                <ul className="mt-3 divide-y divide-dashed">
                  {dashboard.recentOrders.map((order) => (
                    <li key={order.id}>
                      <Link to={`/orders?open=${order.id}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-4 py-3 hover:bg-accent/50 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:gap-x-4 sm:px-5">
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

        </>
      ) : null}
    </div>
  );
}

function Metric({ label, value, sub, warn }: { label: string; value: number; sub: string; warn?: boolean }) {
  return (
    <div className="surface min-w-0 p-3.5 sm:p-5">
      <p className="truncate text-xs text-muted-foreground sm:text-sm">{label}</p>
      <p className={cn("numeric mt-1 font-display text-2xl font-extrabold sm:text-3xl", warn && "text-warning")}>{value}</p>
      <p className="mt-1 text-[10px] leading-tight text-muted-foreground sm:text-xs">{sub}</p>
    </div>
  );
}
