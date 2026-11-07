import { Link } from "@tanstack/react-router";
import { Bike, ShoppingBag, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { describeStatus } from "@/lib/cpse/storeHours";
import { visualForStore } from "../categories";
import { SmartImage } from "@/components/cpse/SmartImage";
import { FavoriteButton } from "./FavoriteButton";

/** A shop's monogram/logo on its category tint. */
export function ShopAvatar({ store, className }: { store: any; className?: string }) {
  const visual = visualForStore(store);
  return (
    <SmartImage
      src={store.logoUrl}
      name={store.name}
      alt=""
      className={cn("rounded-xl border border-border-strong/15", className)}
      fallbackClassName={cn(visual.tint, visual.ink)}
    />
  );
}

/**
 * Directory card. The whole card is one link; the heart is a separate button
 * pinned top-right with its own hit area so it never steals the card tap.
 */
export function ShopCard({ store, saved }: { store: any; saved?: boolean | null }) {
  const visual = visualForStore(store);
  const status = describeStatus(store.hours);
  const Icon = visual.icon;
  const product = (store.productCategories ?? []).slice(0, 2).map((c: any) => c.name).join(" · ");

  return (
    <div className="group relative h-full">
      <Link
        to="/store/$slug"
        params={{ slug: store.slug }}
        className="surface press flex h-full flex-col overflow-hidden"
      >
        <div className={cn("relative h-24 awning", visual.tint, visual.ink)}>
          {store.coverImageUrl ? (
            <SmartImage src={store.coverImageUrl} name={store.name} alt="" className="absolute inset-0 h-full w-full" fallbackClassName="hidden" />
          ) : null}
          <Icon className="absolute bottom-3 right-14 h-12 w-12 opacity-25" strokeWidth={1.5} aria-hidden="true" />
          <div className="absolute -bottom-6 left-4">
            <ShopAvatar store={store} className="h-14 w-14 text-lg shadow-lift" />
          </div>
        </div>
        <div className="flex flex-1 flex-col gap-1.5 px-4 pb-4 pt-8">
          <h3 className="line-clamp-2 text-lg font-bold leading-tight">{store.name}</h3>
          <p className="truncate text-sm text-muted-foreground">{product || visual.label}</p>
          <p className="mt-auto flex items-center gap-1.5 pt-2 text-sm">
            <span className={cn("h-2 w-2 shrink-0 rounded-full", status.isOpen ? "bg-success" : "bg-muted-foreground/60")} aria-hidden="true" />
            <span className={cn("font-semibold", status.isOpen ? "text-success" : "text-muted-foreground")}>
              {status.isOpen ? "Open" : "Closed"}
            </span>
            {status.detail ? <span className="truncate text-muted-foreground">· {status.detail.replace(/^Closes at /, "till ").replace(/^Opens /, "opens ")}</span> : null}
          </p>
          <div className="flex items-center gap-3 border-t border-dashed pt-2 text-xs text-muted-foreground">
            <span className="flex min-w-0 items-center gap-1 truncate">
              <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {store.location?.city ?? "—"}
            </span>
            {store.fulfilment?.deliveryEnabled ? (
              <span className="flex items-center gap-1"><Bike className="h-3.5 w-3.5" aria-hidden="true" /> Delivery</span>
            ) : null}
            {store.fulfilment?.pickupEnabled ? (
              <span className="flex items-center gap-1"><ShoppingBag className="h-3.5 w-3.5" aria-hidden="true" /> Pickup</span>
            ) : null}
          </div>
        </div>
      </Link>
      <div className="absolute right-3 top-3">
        <FavoriteButton storeId={store.id} storeName={store.name} isSaved={saved ?? store.isSaved} />
      </div>
    </div>
  );
}

export function ShopCardSkeleton() {
  return (
    <div className="surface overflow-hidden" aria-hidden="true">
      <div className="h-24 animate-pulse bg-sunk" />
      <div className="space-y-2 px-4 pb-4 pt-8">
        <div className="h-5 w-3/4 animate-pulse rounded bg-sunk" />
        <div className="h-4 w-1/2 animate-pulse rounded bg-sunk" />
        <div className="h-4 w-2/3 animate-pulse rounded bg-sunk" />
      </div>
    </div>
  );
}
