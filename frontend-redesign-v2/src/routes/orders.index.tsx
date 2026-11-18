import { createFileRoute, Link } from "@tanstack/react-router";
import { useInfiniteQuery } from "@tanstack/react-query";
import { ReceiptText, ChevronRight, Bike, ShoppingBag } from "lucide-react";
import { cn } from "@/lib/utils";
import { endpoints } from "@/lib/cpse/endpoints";
import { formatPaise } from "@/lib/cpse/money";
import { formatSince, isTerminal, meaningFor, progressFor } from "@/lib/cpse/orderStatus";
import { RequireAuth } from "@/customer/RequireAuth";
import { OrderStamp } from "@/components/cpse/Stamp";
import { EmptyState, ErrorState, PageTitle, Skel } from "@/components/cpse/States";
import { Button } from "@/components/ui/button";

type Search = { status?: string };

export const Route = createFileRoute("/orders/")({
  validateSearch: (s: Record<string, unknown>): Search => ({ status: typeof s["status"] === "string" ? (s["status"] as string) : undefined }),
  head: () => ({
    meta: [
      { title: "Your orders — CPSE" },
      { name: "description", content: "Track live orders and look back at past ones from your neighbourhood shops." },
      { property: "og:title", content: "Your orders — CPSE" },
      { property: "og:description", content: "Track live and past orders." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <RequireAuth>
      <OrdersPage />
    </RequireAuth>
  ),
});

const FILTERS = [
  { value: undefined, label: "All" },
  { value: "placed", label: "Placed" },
  { value: "preparing", label: "Preparing" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];

function OrdersPage() {
  const { status } = Route.useSearch();
  const query = useInfiniteQuery({
    queryKey: ["orders", "list", status ?? null],
    initialPageParam: 1,
    queryFn: async ({ pageParam }) => {
      const r = await endpoints.orders.list({ status, page: pageParam, limit: 10 });
      return { orders: r.data?.orders ?? [], meta: r.meta };
    },
    getNextPageParam: (last) => (last.meta?.hasNextPage ? last.meta.page + 1 : undefined),
  });
  const orders = query.data?.pages.flatMap((p) => p.orders) ?? [];
  const live = status ? [] : orders.filter((o: any) => !isTerminal(o.status));
  const past = status ? orders : orders.filter((o: any) => isTerminal(o.status));

  return (
    <div className="mx-auto max-w-4xl">
      <PageTitle eyebrow="Orders" title="What you’ve ordered" className="mb-4 md:mb-6 [&_h1]:text-2xl sm:[&_h1]:text-4xl" />
      <div role="group" aria-label="Filter orders" className="mb-4 flex flex-wrap gap-2 md:mb-6">
        {FILTERS.map((f) => {
          const active = status === f.value;
          return (
            <Link
              key={f.label}
              to="/orders"
              search={f.value ? { status: f.value } : {}}
              aria-current={active ? "true" : undefined}
              className={cn("h-9 shrink-0 rounded-full border px-3 text-xs font-semibold leading-9 transition-colors sm:h-10 sm:px-4 sm:text-sm sm:leading-10", active ? "border-ink bg-ink text-ink-foreground" : "border-border bg-card hover:border-border-strong")}
            >
              {f.label}
            </Link>
          );
        })}
      </div>

      {query.isLoading ? (
        <div role="status" aria-label="Loading orders" className="space-y-2.5 sm:space-y-3">
          {[0, 1, 2].map((k) => <Skel key={k} className="h-24 rounded-2xl sm:h-28" />)}
        </div>
      ) : query.error ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : orders.length === 0 ? (
        <EmptyState icon={<ReceiptText />} title={status ? "No orders like that" : "No orders yet"} body={status ? "Try another filter." : "When you order from a shop, it’ll show up here."}>
          <Button asChild variant="ink"><Link to="/">Find a shop</Link></Button>
        </EmptyState>
      ) : (
        <div className="space-y-8">
          {live.length ? (
            <section aria-labelledby="live-h">
              <h2 id="live-h" className="mb-3 text-lg font-bold">Happening now</h2>
              <ul className="space-y-2.5 sm:space-y-3">{live.map((o: any) => <OrderRow key={o.id} order={o} live />)}</ul>
            </section>
          ) : null}
          {past.length ? (
            <section aria-labelledby="past-h">
              {live.length ? <h2 id="past-h" className="mb-3 text-lg font-bold">Past orders</h2> : null}
              <ul className="space-y-2.5 sm:space-y-3">{past.map((o: any) => <OrderRow key={o.id} order={o} />)}</ul>
            </section>
          ) : null}
          {query.hasNextPage ? (
            <div className="text-center">
              <Button variant="outline" onClick={() => query.fetchNextPage()} disabled={query.isFetchingNextPage}>
                {query.isFetchingNextPage ? "Loading…" : "Show older orders"}
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function OrderRow({ order, live }: { order: any; live?: boolean }) {
  const progress = progressFor(order.status, order.fulfilmentMode);
  return (
    <li>
      <Link to="/orders/$orderId" params={{ orderId: order.id }} className={cn("surface press grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-3 p-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:gap-4 sm:p-4", live && "border-border-strong/40")}>
        <span className={cn("grid h-10 w-10 place-items-center rounded-lg sm:h-12 sm:w-12 sm:rounded-xl", live ? "bg-primary text-primary-foreground" : "bg-sunk text-muted-foreground")}>
          {order.fulfilmentMode === "delivery" ? <Bike className="h-5 w-5" /> : <ShoppingBag className="h-5 w-5" />}
        </span>
        <span className="min-w-0">
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="truncate text-sm font-bold sm:text-base">{order.storeName}</span>
            <OrderStamp status={order.status} label={order.statusLabel} className="px-1.5 text-[10px] sm:px-2 sm:text-xs" />
          </span>
          <span className="mt-1 block truncate text-xs text-muted-foreground sm:text-sm">
            {live ? meaningFor(order.status) : `${order.itemCount} ${order.itemCount === 1 ? "item" : "items"} · ${order.orderNumber}`}
          </span>
          {live && progress ? (
            <span className="mt-1.5 flex max-w-xs gap-1 sm:mt-2" aria-label={`Step ${progress.step} of ${progress.total}`}>
              {Array.from({ length: progress.total }, (_, i) => (
                <span key={i} className={cn("h-1.5 flex-1 rounded-full", i < progress.step ? "bg-success" : "bg-sunk")} />
              ))}
            </span>
          ) : null}
        </span>
        <span className="text-right">
          <span className="numeric block text-sm font-bold sm:text-base">{formatPaise(order.totalPaise)}</span>
          <span className="block text-[10px] text-muted-foreground sm:text-xs">{formatSince(order.placedAt)}</span>
          <ChevronRight className="ml-auto mt-0.5 h-3.5 w-3.5 text-muted-foreground sm:mt-1 sm:h-4 sm:w-4" aria-hidden="true" />
        </span>
      </Link>
    </li>
  );
}
