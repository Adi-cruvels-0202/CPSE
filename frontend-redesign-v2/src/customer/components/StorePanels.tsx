import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Clock,
  Navigation,
  Phone,
  Copy,
  Check,
  Share2,
  MessageCircle,
  Bot,
  Send,
  Loader2,
  Bike,
  ShoppingBag,
  Wallet,
  Tag,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { endpoints } from "@/lib/cpse/endpoints";
import { formatPaise, formatPaiseShort } from "@/lib/cpse/money";
import { describeStatus, weekSchedule } from "@/lib/cpse/storeHours";
import { formatWhen } from "@/lib/cpse/orderStatus";
import { cpse } from "../hooks";
import { AddToCart } from "./AddToCart";
import { InlineError } from "@/components/cpse/States";
import { Button } from "@/components/ui/button";

function PanelTitle({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <h2 className="mb-3 flex items-center gap-2 text-base font-bold [&_svg]:h-4 [&_svg]:w-4 [&_svg]:text-primary-strong">
      {icon}
      {children}
    </h2>
  );
}

export function HoursPanel({ store }: { store: any }) {
  const hours = store.hours;
  const status = describeStatus(hours);
  const week = weekSchedule(hours) as any[];
  const f = store.fulfilment ?? {};
  const modes = [f.pickupEnabled ? "Pickup" : null, f.deliveryEnabled ? "Delivery" : null].filter(Boolean);

  return (
    <section aria-labelledby="hours-title">
      <PanelTitle icon={<Clock />}>
        <span id="hours-title">Hours & ordering</span>
      </PanelTitle>
      <p className={cn("mb-3 flex items-center gap-2 font-semibold", status.isOpen ? "text-success" : "text-muted-foreground")}>
        <span className={cn("h-2 w-2 rounded-full", status.isOpen ? "bg-success" : "bg-muted-foreground")} aria-hidden="true" />
        {status.label}
        {status.detail ? <span className="font-normal text-muted-foreground">· {status.detail}</span> : null}
      </p>
      <dl className="divide-y divide-dashed rounded-xl border bg-paper text-sm">
        {week.map((day) => (
          <div key={day.key} className={cn("flex justify-between px-3 py-1.5", day.isToday && "bg-primary-soft/60 font-semibold")}>
            <dt>
              {day.name}
              {day.isToday ? <span className="sr-only"> (today)</span> : null}
            </dt>
            <dd className="numeric">{day.text}</dd>
          </div>
        ))}
      </dl>
      {hours?.timezone ? <p className="mt-2 text-xs text-muted-foreground">Shop’s local time ({hours.timezone}).</p> : null}

      <ul className="mt-4 grid grid-cols-2 gap-2 text-sm">
        <Fact icon={<ShoppingBag />} label="Get it by" value={modes.length ? modes.join(" or ") : "Not taking orders"} />
        {f.deliveryEnabled ? (
          <Fact icon={<Bike />} label="Delivery" value={f.deliveryFeePaise > 0 ? formatPaiseShort(f.deliveryFeePaise) : "Free"} />
        ) : null}
        {f.minOrderPaise > 0 ? <Fact icon={<Wallet />} label="Minimum order" value={formatPaiseShort(f.minOrderPaise)} /> : null}
        {f.freeDeliveryThresholdPaise ? (
          <Fact icon={<Tag />} label="Free delivery over" value={formatPaiseShort(f.freeDeliveryThresholdPaise)} />
        ) : null}
        <Fact
          icon={<Wallet />}
          label="Pay by"
          value={[store.payment?.cashOnDelivery ? "Cash" : null, store.payment?.online ? "Online" : null, store.payment?.khata ? "Khata" : null].filter(Boolean).join(", ") || "—"}
        />
      </ul>
      {store.description ? <p className="mt-4 text-sm text-muted-foreground">{store.description}</p> : null}
    </section>
  );
}

function Fact({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <li className="rounded-xl border bg-paper p-2.5 [&_svg]:h-4 [&_svg]:w-4">
      <span className="mb-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        {label}
      </span>
      <span className="numeric font-semibold">{value}</span>
    </li>
  );
}

export function LocationPanel({ store }: { store: any }) {
  const { contact, location } = store;
  const [copied, setCopied] = useState(false);
  const address = [location?.addressLine1, location?.addressLine2, location?.city, location?.state, location?.postalCode]
    .filter(Boolean)
    .join(", ");
  const mapHref =
    location?.latitude && location?.longitude
      ? `https://www.google.com/maps/search/?api=1&query=${location.latitude},${location.longitude}`
      : address
        ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`
        : null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard refused — nothing else to do.
    }
  };

  return (
    <section aria-labelledby="loc-title">
      <PanelTitle icon={<Navigation />}>
        <span id="loc-title">Location & directions</span>
      </PanelTitle>
      {address ? <p className="text-sm leading-relaxed">{address}</p> : <p className="text-sm text-muted-foreground">The shop hasn’t added an address.</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        {mapHref ? (
          <Button asChild variant="ink" size="sm">
            <a href={mapHref} target="_blank" rel="noreferrer noopener">
              <Navigation /> Directions
            </a>
          </Button>
        ) : null}
        {contact?.phone ? (
          <Button asChild variant="outline" size="sm">
            <a href={`tel:${contact.phone}`}>
              <Phone /> Call
            </a>
          </Button>
        ) : null}
        {address ? (
          <Button variant="outline" size="sm" onClick={copy}>
            {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy address"}
          </Button>
        ) : null}
      </div>
      <p className="sr-only" role="status">{copied ? "Address copied." : ""}</p>
    </section>
  );
}

export function ActionsPanel({ store }: { store: any }) {
  const [status, setStatus] = useState("");
  const url = typeof window === "undefined" ? `/store/${store.slug}` : `${window.location.origin}/store/${store.slug}`;

  const share = async () => {
    try {
      if (navigator.share) {
        await navigator.share({ title: store.name, text: `Order from ${store.name}`, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setStatus("Link copied.");
    } catch {
      setStatus(url);
    }
  };

  return (
    <section aria-labelledby="act-title">
      <PanelTitle icon={<Share2 />}>
        <span id="act-title">Shop actions</span>
      </PanelTitle>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={share} className="flex min-h-12 items-center gap-2 rounded-xl border bg-paper px-3 text-sm font-semibold hover:border-border-strong">
          <Share2 className="h-4 w-4" /> Share shop
        </button>
        <a
          href={`https://wa.me/?text=${encodeURIComponent(`Order from ${store.name}: ${url}`)}`}
          target="_blank"
          rel="noreferrer"
          className="flex min-h-12 items-center gap-2 rounded-xl border bg-paper px-3 text-sm font-semibold hover:border-border-strong"
        >
          <MessageCircle className="h-4 w-4" /> WhatsApp
        </a>
      </div>
      {status ? <p role="status" className="mt-2 text-sm text-success">{status}</p> : null}
    </section>
  );
}

export function AssistantPanel({ store, isSignedIn }: { store: any; isSignedIn: boolean }) {
  const [message, setMessage] = useState("");
  const [reply, setReply] = useState<any>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<any>(null);

  const ask = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!message.trim() || pending) return;
    setPending(true);
    setError(null);
    try {
      const { data } = await endpoints.intelligence.assistant(store.slug, message.trim());
      setReply(data.reply);
    } catch (e) {
      setError(e);
    } finally {
      setPending(false);
    }
  };

  const lines = reply?.proposals ?? reply?.results ?? [];

  return (
    <section aria-labelledby="ai-title">
      <PanelTitle icon={<Bot />}>
        <span id="ai-title">Shop assistant</span>
      </PanelTitle>
      <p className="mb-3 text-sm text-muted-foreground">Ask about products, prices, stock or hours.</p>
      <form onSubmit={ask} className="flex gap-2">
        <input
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          maxLength={500}
          aria-label={`Ask ${store.name}`}
          placeholder="Do you have basmati rice?"
          className="h-11 min-w-0 flex-1 rounded-full border border-input bg-paper px-4 text-sm outline-none focus:border-border-strong"
        />
        <Button type="submit" size="icon" variant="ink" disabled={pending || !message.trim()} aria-label="Ask">
          {pending ? <Loader2 className="animate-spin" /> : <Send />}
        </Button>
      </form>
      <InlineError error={error} className="mt-2" />
      {reply ? (
        <div role="status" className="mt-3 space-y-2 rounded-xl bg-paper p-3 text-sm animate-rise-in">
          {reply.answer ? <p>{reply.answer}</p> : null}
          {reply.unmatched?.length ? (
            <p className="text-muted-foreground">Not found here: {reply.unmatched.map((u: any) => u.text).join(", ")}.</p>
          ) : null}
          {lines.length > 0 ? (
            isSignedIn ? (
              <ul className="divide-y divide-dashed">
                {lines.slice(0, 8).map((line: any, i: number) => (
                  <li key={`${line.product.id}-${i}`} className="flex items-center justify-between gap-2 py-2">
                    <Link to="/store/$slug/product/$productId" params={{ slug: store.slug, productId: line.product.id }} className="min-w-0">
                      <span className="block truncate font-semibold">{line.product.name}</span>
                      <span className="numeric text-xs text-muted-foreground">
                        {formatPaiseShort(line.product.pricePaise)}
                        {line.suggestion?.variantName ? ` · ${line.suggestion.variantName}` : ""}
                      </span>
                    </Link>
                    <AddToCart
                      storeId={store.id}
                      storeSlug={store.slug}
                      productId={line.product.id}
                      variantId={line.add?.variantId ?? line.suggestion?.variantId}
                      disabled={line.product.isPurchasable === false}
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground">
                <Link to="/login" search={{ next: `/store/${store.slug}` }} className="font-semibold text-foreground underline">Sign in</Link> to add these to your cart.
              </p>
            )
          ) : null}
          {reply.source ? <p className="text-xs text-muted-foreground">From: {reply.source}</p> : null}
        </div>
      ) : null}
    </section>
  );
}

export function OffersStrip({ slug }: { slug: string }) {
  const query = useQuery({
    queryKey: ["store-offers", slug],
    queryFn: cpse<{ offers: any[]; coupons: any[] }>(() => endpoints.stores.offers(slug)),
  });
  const offers = query.data?.offers ?? [];
  const coupons = query.data?.coupons ?? [];
  if (offers.length === 0 && coupons.length === 0) return null;

  return (
    <section aria-labelledby="offers-title" className="mb-6">
      <h2 id="offers-title" className="mb-3 text-lg font-bold">Offers here</h2>
      <ul className="no-scrollbar -mx-1 flex gap-3 overflow-x-auto px-1 pb-1">
        {offers.map((offer: any) => (
          <li key={offer.id} className="w-64 shrink-0 rounded-2xl border border-dashed border-primary-strong/50 bg-primary-soft/60 p-4">
            <p className="font-bold">{offer.title}</p>
            <p className="text-sm text-muted-foreground">
              {offer.productName}
              {offer.variantName && offer.variantName !== "Default" ? ` · ${offer.variantName}` : ""}
            </p>
            <p className="mt-2">
              <span className="numeric text-lg font-extrabold">{formatPaise(offer.offerPricePaise)}</span>
              {offer.listPricePaise ? <s className="numeric ml-2 text-sm text-muted-foreground">{formatPaise(offer.listPricePaise)}</s> : null}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Until {formatWhen(offer.endsAt)}
              {offer.unitsLeft !== null && offer.unitsLeft !== undefined ? ` · ${offer.unitsLeft} left` : ""}
            </p>
            <Link to="/store/$slug/product/$productId" params={{ slug, productId: offer.productId }} className="mt-2 inline-block text-sm font-bold text-primary-strong hover:underline">
              See it →
            </Link>
          </li>
        ))}
        {coupons.map((coupon: any) => (
          <li key={coupon.id ?? coupon.code} className="w-64 shrink-0 rounded-2xl border border-dashed border-success/50 bg-success-soft/60 p-4">
            <p className="font-bold">{coupon.title}</p>
            <p className="mt-1 text-sm">
              Code <span className="numeric rounded bg-card px-1.5 py-0.5 font-bold">{coupon.code}</span>
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              {coupon.minOrderPaise ? `On orders of ${formatPaise(coupon.minOrderPaise)}+. ` : ""}
              {coupon.endsAt ? `Until ${formatWhen(coupon.endsAt)}.` : ""}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
