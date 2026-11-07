import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { ArrowLeft, ShoppingBasket, ChevronRight, PackageOpen, Clock, Navigation, Share2, Bot, LayoutGrid } from "lucide-react";
import { cn } from "@/lib/utils";
import { endpoints } from "@/lib/cpse/endpoints";
import { formatPaise } from "@/lib/cpse/money";
import { describeStatus } from "@/lib/cpse/storeHours";
import { rememberStore } from "@/lib/cpse/activeStore";
import { track } from "@/lib/cpse/track";
import { useAuth } from "@/customer/auth";
import { cpse, useCart } from "@/customer/hooks";
import { visualForStore } from "@/customer/categories";
import { ShopAvatar } from "@/customer/components/ShopCard";
import { FavoriteButton } from "@/customer/components/FavoriteButton";
import { ProductTile, ProductTileSkeleton } from "@/customer/components/ProductTile";
import { HoursPanel, LocationPanel, ActionsPanel, AssistantPanel, OffersStrip } from "@/customer/components/StorePanels";
import { EmptyState, ErrorState, Skel } from "@/components/cpse/States";
import { Button } from "@/components/ui/button";

type Search = { category?: string };

export const Route = createFileRoute("/store/$slug/")({
  validateSearch: (search: Record<string, unknown>): Search => ({
    category: typeof search["category"] === "string" ? (search["category"] as string) : undefined,
  }),
  head: ({ params }) => {
    const name = params.slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    return {
      meta: [
        { title: `${name} — order on CPSE` },
        { name: "description", content: `Browse ${name}'s catalogue, check opening hours and order for pickup or delivery on CPSE.` },
        { property: "og:title", content: `${name} on CPSE` },
        { property: "og:description", content: `Order from ${name} for pickup or delivery.` },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary" },
      ],
    };
  },
  component: StorePage,
});

type Tab = "products" | "hours" | "location" | "actions" | "assistant";

function StorePage() {
  const { slug } = Route.useParams();
  const { category } = Route.useSearch();
  const navigate = useNavigate({ from: "/store/$slug/" });
  const { isSignedIn } = useAuth();
  const [tab, setTab] = useState<Tab>("products");

  const storeQuery = useQuery({
    queryKey: ["store", slug, isSignedIn],
    queryFn: cpse<{ store: any }>(() => endpoints.stores.get(slug)),
  });
  const store = storeQuery.data?.store;

  useEffect(() => {
    if (store) rememberStore(store);
  }, [store]);
  useEffect(() => {
    if (store?.id) track({ eventType: "store_view", storeId: store.id });
  }, [store?.id]);

  if (storeQuery.isLoading) return <StoreSkeleton />;
  if (storeQuery.error || !store) {
    const err: any = storeQuery.error;
    return (
      <ErrorState
        error={err ?? { message: "This shop could not be loaded." }}
        title={err?.status === 404 ? "That shop isn’t here" : undefined}
        onRetry={err?.status === 404 ? undefined : () => storeQuery.refetch()}
      />
    );
  }

  const status = describeStatus(store.hours);
  const visual = visualForStore(store);
  const setCategory = (id?: string) => navigate({ search: id ? { category: id } : {}, replace: true });

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "products", label: "Products", icon: <LayoutGrid /> },
    { id: "hours", label: "Hours", icon: <Clock /> },
    { id: "location", label: "Location", icon: <Navigation /> },
    { id: "actions", label: "Actions", icon: <Share2 /> },
    { id: "assistant", label: "Assistant", icon: <Bot /> },
  ];

  return (
    <div className="pb-20 md:pb-0">
      <header className={cn("relative mb-6 overflow-hidden rounded-3xl border border-border-strong/15", visual.tint, visual.ink)}>
        <div className="awning absolute inset-x-0 top-0 h-full opacity-60" aria-hidden="true" />
        <div className="relative flex items-start justify-between p-4 sm:p-6">
          <Link to="/" className="grid h-11 w-11 place-items-center rounded-full border bg-card/95 text-foreground hover:border-border-strong" aria-label="Back to shops">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <FavoriteButton storeId={store.id} storeName={store.name} isSaved={store.isSaved} size="lg" />
        </div>
        <div className="relative flex flex-col gap-4 bg-card/95 p-4 text-foreground sm:flex-row sm:items-end sm:p-6">
          <ShopAvatar store={store} className="-mt-14 h-20 w-20 shrink-0 text-2xl shadow-lift sm:-mt-16 sm:h-24 sm:w-24" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">{visual.label}</p>
            <h1 className="text-3xl font-extrabold sm:text-4xl">{store.name}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 text-sm">
              <span className={cn("flex items-center gap-1.5 font-bold", status.isOpen ? "text-success" : "text-muted-foreground")}>
                <span className={cn("h-2 w-2 rounded-full", status.isOpen ? "bg-success" : "bg-muted-foreground")} aria-hidden="true" />
                {status.label}
              </span>
              {status.detail ? <span className="text-muted-foreground">· {status.detail}</span> : null}
              <span className="text-muted-foreground">· {store.location?.city}</span>
            </p>
          </div>
        </div>
      </header>

      {/* Mobile: shop info lives in tabs under the header. */}
      <div role="tablist" aria-label="Shop sections" className="no-scrollbar -mx-4 mb-5 flex gap-2 overflow-x-auto px-4 lg:hidden">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            onClick={() => setTab(t.id)}
            className={cn(
              "flex h-10 shrink-0 items-center gap-1.5 rounded-full border px-4 text-sm font-semibold transition-colors [&_svg]:h-4 [&_svg]:w-4",
              tab === t.id ? "border-ink bg-ink text-ink-foreground" : "border-border bg-card",
            )}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div id="panel-products" role="tabpanel" aria-labelledby="tab-products" className={cn(tab !== "products" && "hidden lg:block")}>
          <OffersStrip slug={slug} />
          <Catalogue store={store} categoryId={category} onCategory={setCategory} />
        </div>

        <aside aria-label="About this shop" className={cn("lg:block", tab === "products" && "hidden")}>
          <div className="space-y-4 lg:sticky lg:top-28">
            {(["hours", "location", "actions", "assistant"] as Tab[]).map((id) => (
              <div
                key={id}
                id={`panel-${id}`}
                role="tabpanel"
                aria-labelledby={`tab-${id}`}
                className={cn("surface p-4", tab !== id && "hidden lg:block")}
              >
                {id === "hours" ? <HoursPanel store={store} /> : null}
                {id === "location" ? <LocationPanel store={store} /> : null}
                {id === "actions" ? <ActionsPanel store={store} /> : null}
                {id === "assistant" ? <AssistantPanel store={store} isSignedIn={isSignedIn} /> : null}
              </div>
            ))}
          </div>
        </aside>
      </div>

      <CartBar store={store} />
    </div>
  );
}

function Catalogue({ store, categoryId, onCategory }: { store: any; categoryId?: string; onCategory: (id?: string) => void }) {
  const categories = useQuery({
    queryKey: ["store-categories", store.slug],
    queryFn: cpse<{ categories: any[] }>(() => endpoints.stores.categories(store.slug)),
  });
  const products = useInfiniteQuery({
    queryKey: ["store-products", store.slug, categoryId ?? null],
    initialPageParam: 1,
    queryFn: async ({ pageParam }) => {
      const r = await endpoints.stores.products(store.slug, { categoryId, page: pageParam, limit: 12 });
      return { products: r.data?.products ?? [], meta: r.meta };
    },
    getNextPageParam: (last) => (last.meta?.hasNextPage ? last.meta.page + 1 : undefined),
  });

  const list = products.data?.pages.flatMap((p) => p.products) ?? [];
  const total = products.data?.pages[0]?.meta?.total;
  const cats = categories.data?.categories ?? [];
  const current = cats.find((c: any) => c.id === categoryId);

  return (
    <section aria-labelledby="catalogue-title">
      <div className="mb-4 flex items-end justify-between gap-4">
        <h2 id="catalogue-title" className="text-2xl font-extrabold">{current?.name ?? "Everything in the shop"}</h2>
        {total !== undefined ? <p className="numeric shrink-0 text-sm text-muted-foreground">{total} items</p> : null}
      </div>

      {cats.length > 1 ? (
        <div role="group" aria-label="Filter by category" className="no-scrollbar -mx-1 mb-5 flex gap-2 overflow-x-auto px-1 pb-1">
          {[{ id: undefined, name: "All" }, ...cats].map((c: any) => {
            const active = (categoryId ?? undefined) === c.id;
            return (
              <button
                key={c.id ?? "all"}
                type="button"
                aria-pressed={active}
                onClick={() => onCategory(c.id)}
                className={cn(
                  "relative h-10 shrink-0 rounded-full px-4 text-sm font-semibold transition-colors",
                  active ? "bg-primary text-primary-foreground" : "bg-card text-foreground hover:bg-accent",
                )}
              >
                {c.name}
              </button>
            );
          })}
        </div>
      ) : null}

      {products.isLoading ? (
        <div role="status" aria-label="Loading products" className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => <ProductTileSkeleton key={i} />)}
        </div>
      ) : products.error && list.length === 0 ? (
        <ErrorState error={products.error} title="Could not load the products" onRetry={() => products.refetch()} />
      ) : list.length === 0 ? (
        categoryId ? (
          <EmptyState icon={<PackageOpen />} title="Nothing in this category yet">
            <Button variant="outline" onClick={() => onCategory(undefined)}>Show everything</Button>
          </EmptyState>
        ) : (
          <EmptyState icon={<PackageOpen />} title="This shop hasn’t listed anything yet" body="Check back later, or give them a call." />
        )
      ) : (
        <>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4" aria-busy={products.isFetching || undefined}>
            {list.map((p: any) => (
              <li key={p.id}>
                <ProductTile product={p} store={store} />
              </li>
            ))}
          </ul>
          <div className="mt-6 flex flex-col items-center gap-2">
            <p className="numeric text-sm text-muted-foreground">
              Showing {list.length} of {total ?? list.length}
            </p>
            {products.hasNextPage ? (
              <Button variant="outline" onClick={() => products.fetchNextPage()} disabled={products.isFetchingNextPage}>
                {products.isFetchingNextPage ? "Loading…" : "Show more"}
              </Button>
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}

/** Sticky basket bar: appears once there's something in this shop's cart. */
function CartBar({ store }: { store: any }) {
  const cart = useCart(store.id);
  const c = cart.data?.cart;
  const count = c?.totals?.totalQuantity ?? 0;
  if (!count) return null;
  return (
    <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 px-4 pb-3 md:bottom-6 md:left-auto md:right-6 md:w-96 md:px-0 md:pb-0 animate-rise-in">
      <Link
        to="/cart/$storeId"
        params={{ storeId: store.id }}
        className="flex h-14 items-center gap-3 rounded-2xl bg-ink px-4 text-ink-foreground shadow-pop"
      >
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-primary-foreground">
          <ShoppingBasket className="h-5 w-5" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1 leading-tight">
          <span key={count} className="numeric block text-sm font-bold animate-tick">
            {count} {count === 1 ? "item" : "items"}
          </span>
          <span className="numeric text-xs text-ink-muted">{formatPaise(c.totals.totalPaise)} incl. tax</span>
        </span>
        <span className="flex items-center gap-1 font-bold">
          View cart <ChevronRight className="h-4 w-4" />
        </span>
      </Link>
    </div>
  );
}

function StoreSkeleton() {
  return (
    <div role="status" aria-label="Loading the shop" className="space-y-6">
      <Skel className="h-52 w-full rounded-3xl" />
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => <ProductTileSkeleton key={i} />)}
        </div>
        <div className="hidden space-y-4 lg:block">
          <Skel className="h-64 rounded-2xl" />
          <Skel className="h-36 rounded-2xl" />
        </div>
      </div>
    </div>
  );
}
