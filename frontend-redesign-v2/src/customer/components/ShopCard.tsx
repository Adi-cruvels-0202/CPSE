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
        <div className={cn("relative h-16 awning sm:h-24", visual.tint, visual.ink)}>
          {store.coverImageUrl ? (
            <SmartImage src={store.coverImageUrl} name={store.name} alt="" className="absolute inset-0 h-full w-full" fallbackClassName="hidden" />
          ) : null}
          <Icon className="absolute bottom-2 right-11 h-9 w-9 opacity-25 sm:bottom-3 sm:right-14 sm:h-12 sm:w-12" strokeWidth={1.5} aria-hidden="true" />
          <div className="absolute -bottom-5 left-3 sm:-bottom-6 sm:left-4">
            <ShopAvatar store={store} className="h-10 w-10 text-sm shadow-lift sm:h-14 sm:w-14 sm:text-lg" />
          </div>
        </div>
        <div className="flex flex-1 flex-col gap-1 px-3 pb-3 pt-6 sm:gap-1.5 sm:px-4 sm:pb-4 sm:pt-8">
          <h3 className="line-clamp-2 text-sm font-bold leading-tight sm:text-lg">{store.name}</h3>
          <p className="truncate text-[11px] text-muted-foreground sm:text-sm">{product || visual.label}</p>
          <p className="mt-auto flex items-center gap-1 pt-1 text-xs sm:gap-1.5 sm:pt-2 sm:text-sm">
            <span className={cn("h-2 w-2 shrink-0 rounded-full", status.isOpen ? "bg-success" : "bg-muted-foreground/60")} aria-hidden="true" />
            <span className={cn("font-semibold", status.isOpen ? "text-success" : "text-muted-foreground")}>
              {status.isOpen ? "Open" : "Closed"}
            </span>
            {status.detail ? <span className="truncate text-muted-foreground">· {status.detail.replace(/^Closes at /, "till ").replace(/^Opens /, "opens ")}</span> : null}
          </p>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-dashed pt-2 text-[10px] text-muted-foreground sm:gap-3 sm:text-xs">
            <span className="flex min-w-0 items-center gap-1 truncate">
              <MapPin className="h-3 w-3 shrink-0 sm:h-3.5 sm:w-3.5" aria-hidden="true" />
              {store.location?.city ?? "—"}
            </span>
            {store.fulfilment?.deliveryEnabled ? (
              <span className="flex items-center gap-1"><Bike className="h-3 w-3 sm:h-3.5 sm:w-3.5" aria-hidden="true" /> Delivery</span>
            ) : null}
            {store.fulfilment?.pickupEnabled ? (
              <span className="flex items-center gap-1"><ShoppingBag className="h-3 w-3 sm:h-3.5 sm:w-3.5" aria-hidden="true" /> Pickup</span>
            ) : null}
          </div>
        </div>
      </Link>
        <div className="absolute right-2 top-2 sm:right-3 sm:top-3">
        <FavoriteButton storeId={store.id} storeName={store.name} isSaved={saved ?? store.isSaved} />
      </div>
    </div>
  );
}

export function ShopCardSkeleton() {
  return (
    <div className="surface overflow-hidden" aria-hidden="true">
      <div className="h-16 animate-pulse bg-sunk sm:h-24" />
      <div className="space-y-2 px-3 pb-3 pt-6 sm:px-4 sm:pb-4 sm:pt-8">
        <div className="h-5 w-3/4 animate-pulse rounded bg-sunk" />
        <div className="h-4 w-1/2 animate-pulse rounded bg-sunk" />
        <div className="h-4 w-2/3 animate-pulse rounded bg-sunk" />
      </div>
    </div>
  );
}
