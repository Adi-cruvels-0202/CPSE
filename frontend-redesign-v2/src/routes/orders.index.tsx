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
      <PageTitle eyebrow="Orders" title="What you’ve ordered" />
      <div role="group" aria-label="Filter orders" className="no-scrollbar -mx-1 mb-6 flex gap-2 overflow-x-auto px-1">
        {FILTERS.map((f) => {
          const active = status === f.value;
          return (
            <Link
              key={f.label}
              to="/orders"
              search={f.value ? { status: f.value } : {}}
              aria-current={active ? "true" : undefined}
              className={cn("h-10 shrink-0 rounded-full border px-4 text-sm font-semibold leading-10 transition-colors", active ? "border-ink bg-ink text-ink-foreground" : "border-border bg-card hover:border-border-strong")}
            >
              {f.label}
            </Link>
          );
        })}
      </div>

      {query.isLoading ? (
        <div role="status" aria-label="Loading orders" className="space-y-3">
          {[0, 1, 2].map((k) => <Skel key={k} className="h-28 rounded-2xl" />)}
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
              <ul className="space-y-3">{live.map((o: any) => <OrderRow key={o.id} order={o} live />)}</ul>
            </section>
          ) : null}
          {past.length ? (
            <section aria-labelledby="past-h">
              {live.length ? <h2 id="past-h" className="mb-3 text-lg font-bold">Past orders</h2> : null}
              <ul className="space-y-3">{past.map((o: any) => <OrderRow key={o.id} order={o} />)}</ul>
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
      <Link to="/orders/$orderId" params={{ orderId: order.id }} className={cn("surface press grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 p-4", live && "border-border-strong/40")}>
        <span className={cn("grid h-12 w-12 place-items-center rounded-xl", live ? "bg-primary text-primary-foreground" : "bg-sunk text-muted-foreground")}>
          {order.fulfilmentMode === "delivery" ? <Bike className="h-5 w-5" /> : <ShoppingBag className="h-5 w-5" />}
        </span>
        <span className="min-w-0">
          <span className="flex flex-wrap items-center gap-2">
            <span className="truncate font-bold">{order.storeName}</span>
            <OrderStamp status={order.status} label={order.statusLabel} />
          </span>
          <span className="block truncate text-sm text-muted-foreground">
            {live ? meaningFor(order.status) : `${order.itemCount} ${order.itemCount === 1 ? "item" : "items"} · ${order.orderNumber}`}
          </span>
          {live && progress ? (
            <span className="mt-2 flex max-w-xs gap-1" aria-label={`Step ${progress.step} of ${progress.total}`}>
              {Array.from({ length: progress.total }, (_, i) => (
                <span key={i} className={cn("h-1.5 flex-1 rounded-full", i < progress.step ? "bg-success" : "bg-sunk")} />
              ))}
            </span>
          ) : null}
        </span>
        <span className="text-right">
          <span className="numeric block font-bold">{formatPaise(order.totalPaise)}</span>
          <span className="block text-xs text-muted-foreground">{formatSince(order.placedAt)}</span>
          <ChevronRight className="ml-auto mt-1 h-4 w-4 text-muted-foreground" aria-hidden="true" />
        </span>
      </Link>
    </li>
  );
}
