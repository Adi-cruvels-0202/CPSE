import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, LayoutGrid, MapPin, PackageSearch, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { endpoints } from "@/lib/cpse/endpoints";
import { formatPaise } from "@/lib/cpse/money";
import { formatSince, isTerminal, meaningFor, progressFor } from "@/lib/cpse/orderStatus";
import { saveSelectedCity } from "@/lib/cpse/cityPreference";
import { useAuth } from "@/customer/auth";
import { cpse, useDirectory, useSelectedCity } from "@/customer/hooks";
import { SHOP_CATEGORIES, categoryForStore, type ShopCategoryId } from "@/customer/categories";
import { ShopCard, ShopCardSkeleton, ShopAvatar } from "@/customer/components/ShopCard";
import { EmptyState, ErrorState } from "@/components/cpse/States";
import { OrderStamp } from "@/components/cpse/Stamp";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "CPSE — Shops near you, for pickup or delivery" },
      { name: "description", content: "Browse grocery, bakery, pharmacy and household shops in your city and order for pickup or delivery." },
      { property: "og:title", content: "CPSE — Shops near you" },
      { property: "og:description", content: "Browse neighbourhood shops in your city and order for pickup or delivery." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: HomePage,
});

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

function HomePage() {
  const { isSignedIn, customer } = useAuth();
  const city = useSelectedCity();
  const first = customer?.fullName?.split(" ")[0];

  return (
    <div className="space-y-10">
      <section className="relative overflow-hidden rounded-3xl bg-ink px-6 py-8 text-ink-foreground sm:px-10 sm:py-12">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-3 awning text-primary" aria-hidden="true" />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div className="max-w-2xl">
            <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-primary">
              <MapPin className="h-4 w-4" aria-hidden="true" />
              {city ? `Shops in ${city}` : "Shops in every city on CPSE"}
            </p>
            <h1 className="text-4xl font-extrabold leading-[1.02] sm:text-5xl lg:text-6xl">
              {isSignedIn && first ? (
                <>
                  {greeting()}, {first}.<br />
                  <span className="text-primary">What does the house need?</span>
                </>
              ) : (
                <>
                  Your street’s shops,
                  <br />
                  <span className="text-primary">one tap away.</span>
                </>
              )}
            </h1>
            <p className="mt-4 max-w-lg text-ink-muted">
              Order from the kirana, bakery and chemist you already trust. Pick it up on your way, or have it brought to your door.
            </p>
          </div>
          {isSignedIn ? <LiveOrder /> : null}
        </div>
      </section>

      <Directory />
    </div>
  );
}

function LiveOrder() {
  const query = useQuery({
    queryKey: ["orders", "live"],
    queryFn: cpse<{ orders: any[] }>(() => endpoints.orders.list({ limit: 5 })),
  });
  const live = (query.data?.orders ?? []).filter((o: any) => !isTerminal(o.status));
  const order = live[0];
  if (!order) return null;
  const progress = progressFor(order.status, order.fulfilmentMode);

  return (
    <Link
      to="/orders/$orderId"
      params={{ orderId: order.id }}
      className="block w-full rounded-2xl bg-paper p-4 text-foreground transition-transform hover:-translate-y-0.5 lg:w-80"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Happening now</span>
        <OrderStamp status={order.status} label={order.statusLabel} />
      </div>
      <p className="mt-2 font-display text-lg font-bold">{order.storeName}</p>
      <p className="text-sm text-muted-foreground">{meaningFor(order.status)}</p>
      {progress ? (
        <div className="mt-3 flex gap-1" aria-label={`Step ${progress.step} of ${progress.total}`}>
          {Array.from({ length: progress.total }, (_, i) => (
            <span key={i} className={cn("h-1.5 flex-1 rounded-full", i < progress.step ? "bg-success" : "bg-sunk")} />
          ))}
        </div>
      ) : null}
      <p className="mt-3 flex justify-between text-sm">
        <span className="numeric font-semibold">{formatPaise(order.totalPaise)}</span>
        <span className="text-muted-foreground">{formatSince(order.placedAt)}</span>
      </p>
      {live.length > 1 ? <p className="mt-2 text-xs font-semibold text-primary-strong">+{live.length - 1} more active</p> : null}
    </Link>
  );
}

function Directory() {
  const { isSignedIn } = useAuth();
  const city = useSelectedCity();
  const directory = useDirectory();
  const [category, setCategory] = useState<ShopCategoryId | "all">("all");
  const [sub, setSub] = useState("");
  const tilesRef = useRef<HTMLDivElement>(null);

  const saved = useQuery({
    queryKey: ["saved-stores", "home"],
    queryFn: cpse<{ savedStores: any[] }>(() => endpoints.savedStores.list({ limit: 100 })),
    enabled: isSignedIn,
  });
  const savedIds = useMemo(
    () => new Set((saved.data?.savedStores ?? []).map((e: any) => e?.store?.id).filter(Boolean)),
    [saved.data],
  );

  const all = directory.data?.stores ?? [];
  const cityStores = all.filter(
    (s: any) => !city || String(s.location?.city ?? "").localeCompare(city, undefined, { sensitivity: "accent" }) === 0,
  );
  const counts = new Map(SHOP_CATEGORIES.map((c) => [c.id, cityStores.filter((s: any) => categoryForStore(s) === c.id).length]));
  const inCategory = category === "all" ? cityStores : cityStores.filter((s: any) => categoryForStore(s) === category);
  const subcategories =
    category === "all"
      ? []
      : [...new Map(inCategory.flatMap((s: any) => s.productCategories ?? []).map((c: any) => [c.slug, c])).values()].sort(
          (a: any, b: any) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
        );
  const shown = sub ? inCategory.filter((s: any) => s.productCategories?.some((c: any) => c.slug === sub)) : inCategory;
  const isSaved = (s: any) => (isSignedIn ? savedIds.has(s.id) : null);
  const favourites = (saved.data?.savedStores ?? []).map((e: any) => e.store).filter(Boolean);

  const pick = (id: ShopCategoryId | "all") => {
    setCategory(id);
    setSub("");
  };

  const onTileKey = (event: React.KeyboardEvent) => {
    if (!["ArrowRight", "ArrowLeft"].includes(event.key)) return;
    const buttons = [...(tilesRef.current?.querySelectorAll<HTMLButtonElement>("button[data-tile]") ?? [])];
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    event.preventDefault();
    buttons[(i + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length]?.focus();
  };

  if (directory.error) return <ErrorState error={directory.error} onRetry={() => directory.refetch()} title="Could not load the shops" />;

  return (
    <div className="space-y-10">
      {favourites.length > 0 ? (
        <section aria-labelledby="fav-heading">
          <div className="mb-3 flex items-center justify-between">
            <h2 id="fav-heading" className="text-xl font-bold">Your favourites</h2>
            <Link to="/saved" className="text-sm font-semibold text-primary-strong hover:underline">Manage</Link>
          </div>
          <ul className="no-scrollbar -mx-1 flex gap-3 overflow-x-auto px-1 pb-1">
            {favourites.map((s: any) => (
              <li key={s.id} className="shrink-0">
                <Link to="/store/$slug" params={{ slug: s.slug }} className="surface press flex w-56 items-center gap-3 p-3">
                  <ShopAvatar store={s} className="h-11 w-11 shrink-0 text-sm" />
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{s.name}</span>
                    <span className={cn("text-xs font-semibold", s.hours?.isOpen ? "text-success" : "text-muted-foreground")}>
                      {s.hours?.isOpen ? "Open now" : "Closed"}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="cat-heading">
        <h2 id="cat-heading" className="mb-4 text-2xl font-extrabold sm:text-3xl">Browse by aisle</h2>
        <div
          ref={tilesRef}
          role="group"
          aria-label="Shop categories"
          onKeyDown={onTileKey}
          className="grid grid-cols-3 gap-2.5 sm:grid-cols-5 lg:grid-cols-9"
        >
          <CategoryTile
            selected={category === "all"}
            onClick={() => pick("all")}
            label="All shops"
            count={cityStores.length}
            icon={<LayoutGrid className="h-6 w-6" />}
            tint="bg-ink text-ink-foreground"
          />
          {SHOP_CATEGORIES.map((c) => {
            const Icon = c.icon;
            return (
              <CategoryTile
                key={c.id}
                selected={category === c.id}
                onClick={() => pick(c.id)}
                label={c.short}
                count={counts.get(c.id) ?? 0}
                icon={<Icon className="h-6 w-6" />}
                tint={cn(c.tint, c.ink)}
              />
            );
          })}
        </div>

        {subcategories.length > 1 ? (
          <div role="group" aria-label="Narrow by what they sell" className="no-scrollbar mt-4 flex gap-2 overflow-x-auto pb-1">
            <Chip active={!sub} onClick={() => setSub("")}>Everything</Chip>
            {subcategories.map((c: any) => (
              <Chip key={c.slug} active={sub === c.slug} onClick={() => setSub(c.slug)}>
                {c.name}
              </Chip>
            ))}
          </div>
        ) : null}
      </section>

      {directory.isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4" role="status" aria-label="Loading shops">
          {Array.from({ length: 8 }, (_, i) => <ShopCardSkeleton key={i} />)}
        </div>
      ) : cityStores.length === 0 ? (
        <EmptyState
          icon={<PackageSearch />}
          title={city ? `No shops in ${city} yet` : "No shops are open on CPSE yet"}
          body={city ? "Shops are joining all the time. Try another city for now." : "Check back soon."}
        >
          {city ? <Button variant="ink" onClick={() => saveSelectedCity("")}>Show all cities</Button> : null}
        </EmptyState>
      ) : category === "all" ? (
        SHOP_CATEGORIES.filter((c) => (counts.get(c.id) ?? 0) > 0).map((c) => {
          const shops = cityStores.filter((s: any) => categoryForStore(s) === c.id);
          return (
            <section key={c.id} aria-labelledby={`shelf-${c.id}`}>
              <div className="mb-4 flex items-end justify-between gap-4 border-b border-dashed pb-2">
                <h2 id={`shelf-${c.id}`} className="text-xl font-bold sm:text-2xl">
                  {c.label} <span className="numeric text-base font-semibold text-muted-foreground">· {shops.length}</span>
                </h2>
                {shops.length > 4 ? (
                  <button type="button" onClick={() => pick(c.id)} className="flex shrink-0 items-center gap-1 text-sm font-bold text-primary-strong hover:underline">
                    See all <ChevronRight className="h-4 w-4" />
                  </button>
                ) : null}
              </div>
              <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {shops.slice(0, 4).map((s: any) => (
                  <li key={s.id}>
                    <ShopCard store={s} saved={isSaved(s)} />
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      ) : shown.length === 0 ? (
        <EmptyState icon={<PackageSearch />} title="Nothing here yet" body="No shop in this aisle sells that in your city.">
          <Button variant="outline" onClick={() => pick("all")}>See all shops <ArrowRight /></Button>
        </EmptyState>
      ) : (
        <section aria-live="polite">
          <p className="mb-4 text-sm text-muted-foreground">
            <span className="numeric font-semibold text-foreground">{shown.length}</span> {shown.length === 1 ? "shop" : "shops"}
            {city ? ` in ${city}` : ""}
          </p>
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {shown.map((s: any) => (
              <li key={s.id} className="animate-rise-in">
                <ShopCard store={s} saved={isSaved(s)} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function CategoryTile({
  selected,
  onClick,
  label,
  count,
  icon,
  tint,
}: {
  selected: boolean;
  onClick: () => void;
  label: string;
  count: number;
  icon: React.ReactNode;
  tint: string;
}) {
  return (
    <button
      type="button"
      data-tile
      onClick={onClick}
      aria-pressed={selected}
      disabled={count === 0 && !selected}
      className={cn(
        "group relative flex flex-col items-center gap-2 rounded-2xl border bg-card px-2 py-3 text-center transition-[border-color,background-color] duration-150 disabled:opacity-40",
        selected ? "border-border-strong bg-paper" : "border-border hover:border-border-strong/60",
      )}
    >
      <span className={cn("grid h-12 w-12 place-items-center rounded-xl transition-transform duration-150", tint, selected && "scale-105")}>{icon}</span>
      <span className="text-[13px] font-semibold leading-tight">{label}</span>
      <span className="numeric text-[11px] text-muted-foreground">{count}</span>
      <span
        aria-hidden="true"
        className={cn(
          "absolute -bottom-px left-1/2 h-1 -translate-x-1/2 rounded-full bg-primary-strong transition-all duration-200",
          selected ? "w-10" : "w-0",
        )}
      />
    </button>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "h-9 shrink-0 rounded-full border px-4 text-sm font-semibold transition-colors",
        active ? "border-ink bg-ink text-ink-foreground" : "border-border bg-card hover:border-border-strong",
      )}
    >
      {children}
    </button>
  );
}
