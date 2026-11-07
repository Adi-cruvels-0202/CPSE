import { Link, useNavigate } from "@tanstack/react-router";
import { discountPercent, formatPaiseShort } from "@/lib/cpse/money";
import { SmartImage } from "@/components/cpse/SmartImage";
import { AddToCart } from "./AddToCart";
import { cn } from "@/lib/utils";

/** Product card for shop catalogues and search: image, name, unit, price, inline add. */
export function ProductTile({ product, store }: { product: any; store: { id: string; slug: string } }) {
  const navigate = useNavigate();
  const saving = discountPercent(product.pricePaise, product.mrpPaise);
  const soldOut = !product.isPurchasable;
  const lowStock = !soldOut && product.stock !== null && product.stock !== undefined && product.stock <= 5;

  return (
    <div className={cn("surface press group relative flex h-full flex-col overflow-hidden", soldOut && "opacity-70")}>
      <Link
        to="/store/$slug/product/$productId"
        params={{ slug: store.slug, productId: product.id }}
        className="flex flex-1 flex-col"
      >
        <div className="relative aspect-[4/3] bg-sunk">
          <SmartImage
            src={product.imageUrl}
            name={product.name}
            alt={product.name}
            className="h-full w-full"
            fallbackClassName="text-3xl text-muted-foreground/70"
          />
          {saving && !soldOut ? (
            <span className="stamp absolute left-2 top-2 border-transparent bg-destructive text-destructive-foreground">{saving}% off</span>
          ) : null}
          {soldOut ? (
            <span className="absolute inset-x-0 bottom-0 bg-ink/85 py-1 text-center text-xs font-bold text-ink-foreground">Sold out</span>
          ) : null}
        </div>
        <div className="flex flex-1 flex-col gap-0.5 px-3 pb-14 pt-3">
          <h3 className="line-clamp-2 font-semibold leading-snug">{product.name}</h3>
          {product.unit ? <p className="text-xs text-muted-foreground">per {product.unit}</p> : null}
          {lowStock ? (
            <p className="text-xs font-semibold text-warning">{product.stock === 1 ? "Last one" : `Only ${product.stock} left`}</p>
          ) : null}
        </div>
      </Link>
      <div className="absolute inset-x-3 bottom-3 flex items-end justify-between gap-2">
        <p className="min-w-0 leading-tight">
          <span className="numeric block text-lg font-extrabold">{formatPaiseShort(product.pricePaise)}</span>
          {product.mrpPaise > product.pricePaise ? (
            <s className="numeric text-xs text-muted-foreground">{formatPaiseShort(product.mrpPaise)}</s>
          ) : null}
        </p>
        <AddToCart
          storeId={store.id}
          storeSlug={store.slug}
          productId={product.id}
          disabled={soldOut}
          onNeedsVariant={() =>
            navigate({ to: "/store/$slug/product/$productId", params: { slug: store.slug, productId: product.id } })
          }
        />
      </div>
    </div>
  );
}

export function ProductTileSkeleton() {
  return (
    <div className="surface overflow-hidden" aria-hidden="true">
      <div className="aspect-[4/3] animate-pulse bg-sunk" />
      <div className="space-y-2 p-3">
        <div className="h-4 w-4/5 animate-pulse rounded bg-sunk" />
        <div className="h-3 w-1/3 animate-pulse rounded bg-sunk" />
        <div className="mt-6 h-6 w-1/2 animate-pulse rounded bg-sunk" />
      </div>
    </div>
  );
}
