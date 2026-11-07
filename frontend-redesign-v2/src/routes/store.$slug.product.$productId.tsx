import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Check, PackageCheck, Receipt } from "lucide-react";
import { cn } from "@/lib/utils";
import { endpoints } from "@/lib/cpse/endpoints";
import { discountPercent, formatPaiseShort } from "@/lib/cpse/money";
import { track } from "@/lib/cpse/track";
import { cpse } from "@/customer/hooks";
import { AddToCart } from "@/customer/components/AddToCart";
import { SmartImage } from "@/components/cpse/SmartImage";
import { ErrorState, Skel } from "@/components/cpse/States";

export const Route = createFileRoute("/store/$slug/product/$productId")({
  head: () => ({
    meta: [
      { title: "Product — CPSE" },
      { name: "description", content: "Price, options and availability from your neighbourhood shop on CPSE." },
      { property: "og:title", content: "Product on CPSE" },
      { property: "og:description", content: "Price, options and availability from your neighbourhood shop." },
      { property: "og:type", content: "product" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ProductPage,
});

function ProductPage() {
  const { slug, productId } = Route.useParams();
  const [variantId, setVariantId] = useState<string | null>(null);
  const [image, setImage] = useState(0);

  const query = useQuery({
    queryKey: ["product", slug, productId],
    queryFn: cpse<{ product: any; storeId: string }>(() => endpoints.stores.product(slug, productId)),
  });
  const storeQuery = useQuery({
    queryKey: ["store", slug],
    queryFn: cpse<{ store: any }>(() => endpoints.stores.get(slug)),
  });

  useEffect(() => {
    setVariantId(null);
    setImage(0);
  }, [productId]);

  const product = query.data?.product;
  useEffect(() => {
    if (product) track({ eventType: "product_view", storeId: product.storeId, productId: product.id });
  }, [product?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (query.isLoading) {
    return (
      <div role="status" aria-label="Loading the product" className="grid gap-8 md:grid-cols-2">
        <Skel className="aspect-square rounded-3xl" />
        <div className="space-y-4">
          <Skel className="h-8 w-3/4" />
          <Skel className="h-6 w-1/3" />
          <Skel className="h-24 w-full" />
        </div>
      </div>
    );
  }
  if (query.error || !product) {
    const err: any = query.error;
    return (
      <ErrorState
        error={err ?? { message: "This product could not be loaded." }}
        title={err?.status === 404 ? "That product isn’t here" : undefined}
        onRetry={err?.status === 404 ? undefined : () => query.refetch()}
      />
    );
  }

  const variants = product.variants ?? [];
  const selected = variants.find((v: any) => v.id === variantId) ?? null;
  const price = selected?.pricePaise ?? product.pricePaise;
  const mrp = selected?.mrpPaise ?? product.mrpPaise;
  const stock = selected ? selected.stock : product.stock;
  const purchasable = selected ? selected.isPurchasable : product.isPurchasable;
  const needsVariant = variants.length > 0 && !selected;
  const saving = discountPercent(price, mrp);
  const images = (product.images ?? []).length ? product.images : [{ url: product.imageUrl, altText: product.name }];
  const store = storeQuery.data?.store;
  const storeRef = { id: product.storeId ?? query.data?.storeId, slug };

  return (
    <article className="pb-10">
      <Link to="/store/$slug" params={{ slug }} className="mb-5 inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to {store?.name ?? "the shop"}
      </Link>

      <div className="grid gap-8 md:grid-cols-2 md:gap-12">
        <div>
          <div className="relative aspect-square overflow-hidden rounded-3xl border bg-sunk">
            <SmartImage
              src={images[image]?.url}
              name={product.name}
              alt={images[image]?.altText ?? product.name}
              className="h-full w-full"
              fallbackClassName="text-6xl text-muted-foreground/60"
            />
            {saving ? <span className="stamp absolute left-4 top-4 border-transparent bg-destructive text-base text-destructive-foreground">{saving}% off</span> : null}
          </div>
          {images.length > 1 ? (
            <div className="mt-3 flex gap-2" role="group" aria-label="Photos">
              {images.map((img: any, i: number) => (
                <button
                  key={img.url ?? i}
                  type="button"
                  onClick={() => setImage(i)}
                  aria-pressed={image === i}
                  aria-label={`Photo ${i + 1}`}
                  className={cn("h-16 w-16 overflow-hidden rounded-xl border-2", image === i ? "border-border-strong" : "border-transparent")}
                >
                  <SmartImage src={img.url} name={product.name} alt="" className="h-full w-full" fallbackClassName="bg-sunk text-xs" />
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="flex flex-col">
          <h1 className="text-3xl font-extrabold sm:text-4xl">{product.name}</h1>
          {product.unit ? <p className="mt-1 text-muted-foreground">Sold per {product.unit}</p> : null}

          <p className="mt-5 flex items-baseline gap-3">
            <span className="numeric font-display text-4xl font-extrabold">{formatPaiseShort(price)}</span>
            {mrp > price ? <s className="numeric text-lg text-muted-foreground">MRP {formatPaiseShort(mrp)}</s> : null}
          </p>
          {product.taxPercent > 0 ? <p className="text-sm text-muted-foreground">+ {product.taxPercent}% GST at checkout</p> : null}

          {variants.length > 0 ? (
            <fieldset className="mt-6">
              <legend className="mb-2 text-sm font-bold">Choose an option</legend>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {variants.map((v: any) => {
                  const out = !v.isPurchasable;
                  const on = variantId === v.id;
                  return (
                    <label
                      key={v.id}
                      className={cn(
                        "relative flex cursor-pointer flex-col rounded-xl border-2 bg-card p-3 transition-colors",
                        on ? "border-border-strong bg-primary-soft/50" : "border-border hover:border-border-strong/50",
                        out && "cursor-not-allowed opacity-50",
                      )}
                    >
                      <input type="radio" name="variant" value={v.id} checked={on} disabled={out} onChange={() => setVariantId(v.id)} className="sr-only" />
                      <span className="font-semibold">{v.name}</span>
                      <span className="numeric text-sm">{out ? "Sold out" : formatPaiseShort(v.pricePaise)}</span>
                      {on ? <Check className="absolute right-2 top-2 h-4 w-4" aria-hidden="true" /> : null}
                    </label>
                  );
                })}
              </div>
            </fieldset>
          ) : null}

          <div className="mt-6 flex flex-wrap items-center gap-3">
            {needsVariant ? (
              <p className="rounded-full bg-muted px-4 py-3 text-sm font-semibold">Pick an option to add it</p>
            ) : (
              <AddToCart storeId={storeRef.id} storeSlug={slug} productId={product.id} variantId={selected?.id ?? null} disabled={!purchasable} size="lg" />
            )}
          </div>

          <ul className="mt-6 space-y-2 text-sm">
            <li className="flex items-center gap-2">
              <PackageCheck className="h-4 w-4 text-success" />
              {!purchasable ? "Sold out right now" : stock === null || stock === undefined ? "In stock" : stock <= 5 ? `Only ${stock} left` : `${stock} available`}
            </li>
            {store ? (
              <li className="flex items-center gap-2">
                <Receipt className="h-4 w-4 text-muted-foreground" /> Sold by{" "}
                <Link to="/store/$slug" params={{ slug }} className="font-semibold underline-offset-4 hover:underline">
                  {store.name}
                </Link>
              </li>
            ) : null}
          </ul>

          {product.description ? (
            <section className="mt-8 border-t border-dashed pt-6">
              <h2 className="mb-2 text-lg font-bold">About this item</h2>
              <p className="leading-relaxed text-muted-foreground">{product.description}</p>
            </section>
          ) : null}
        </div>
      </div>
    </article>
  );
}
