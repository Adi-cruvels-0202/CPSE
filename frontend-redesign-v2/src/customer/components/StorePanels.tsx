import { useEffect, useRef, useState, type SetStateAction } from "react";
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
import { Button } from "@/components/ui/button";

function PanelTitle({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <h2 className="mb-3 flex items-center gap-2 text-base font-bold [&_svg]:h-4 [&_svg]:w-4 [&_svg]:text-primary-strong">
      {icon}
      {children}
    </h2>
  );
}

export function HoursPanel({ store, showTitle = true }: { store: any; showTitle?: boolean }) {
  const hours = store.hours;
  const status = describeStatus(hours);
  const week = weekSchedule(hours) as any[];
  const f = store.fulfilment ?? {};
  const modes = [f.pickupEnabled ? "Pickup" : null, f.deliveryEnabled ? "Delivery" : null].filter(Boolean);

  return (
    <section aria-labelledby="hours-title">
      {showTitle ? <PanelTitle icon={<Clock />}><span id="hours-title">Hours & ordering</span></PanelTitle> : null}
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

export function LocationPanel({ store, showTitle = true }: { store: any; showTitle?: boolean }) {
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
      {showTitle ? <PanelTitle icon={<Navigation />}><span id="loc-title">Location & directions</span></PanelTitle> : null}
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

export function ActionsPanel({ store, showTitle = true }: { store: any; showTitle?: boolean }) {
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
      {showTitle ? <PanelTitle icon={<Share2 />}><span id="act-title">Shop actions</span></PanelTitle> : null}
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

export type AssistantTurn = {
  id: string;
  question: string;
  reply?: any;
  error?: string;
  pending?: boolean;
};

export function AssistantPanel({
  store,
  isSignedIn,
  messages,
  setMessages,
}: {
  store: any;
  isSignedIn: boolean;
  messages: AssistantTurn[];
  setMessages: (update: SetStateAction<AssistantTurn[]>) => void;
}) {
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const transcriptEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    transcriptEnd.current?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "end" });
  }, [messages]);

  const askQuestion = async (question: string) => {
    if (!question || pending) return;
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setMessages((current) => [...current, { id, question, pending: true }]);
    setMessage("");
    setPending(true);
    try {
      const { data } = await endpoints.intelligence.assistant(store.slug, question);
      setMessages((current) => current.map((turn) => turn.id === id ? { ...turn, pending: false, reply: data.reply } : turn));
    } catch (e) {
      const message = e instanceof Error ? e.message : "I couldn’t get an answer just now. Please try again.";
      setMessages((current) => current.map((turn) => turn.id === id ? { ...turn, pending: false, error: message } : turn));
    } finally {
      setPending(false);
    }
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    void askQuestion(message.trim());
  };
  const prompts = ["Is the shop open now?", "Do you deliver?", "Find basmati rice"];

  return (
    <section aria-labelledby="ai-title" className="flex min-h-0 flex-col">
      <PanelTitle icon={<Bot />}><span id="ai-title">Shop assistant</span></PanelTitle>
      <p className="text-sm text-muted-foreground">Ask about products, prices, stock or hours.</p>
      {messages.length ? (
        <p className="my-2 text-xs text-muted-foreground" aria-live="polite">
          This shop’s chat · {messages.length} {messages.length === 1 ? "question" : "questions"}
        </p>
      ) : null}
      <div
        role="log"
        aria-label={`Conversation with ${store.name} shop assistant`}
        aria-live="polite"
        aria-relevant="additions text"
        className="my-3 max-h-[46vh] space-y-3 overflow-y-auto overscroll-contain pr-1"
      >
        {messages.length === 0 ? (
          <div className="space-y-2 rounded-xl bg-paper p-3">
            <p className="text-xs font-semibold text-muted-foreground">Try asking</p>
            <div className="flex flex-wrap gap-2">
              {prompts.map((prompt) => (
                <button key={prompt} type="button" disabled={pending} onClick={() => void askQuestion(prompt)} className="rounded-full border bg-card px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : messages.map((turn) => {
          const reply = turn.reply;
          const lines = reply?.proposals ?? reply?.results ?? [];
          return (
            <article key={turn.id} className="space-y-2">
              <div className="ml-auto max-w-[92%] rounded-2xl rounded-br-md bg-ink px-3 py-2.5 text-sm text-ink-foreground">
                <p className="mb-1 text-[11px] font-semibold text-ink-muted">You</p>
                <p className="whitespace-pre-wrap">{turn.question}</p>
              </div>
              <div className="max-w-[96%] rounded-2xl rounded-bl-md border bg-paper p-3 text-sm">
                <p className="mb-1 flex items-center gap-1.5 text-xs font-bold"><Bot className="h-3.5 w-3.5 text-primary-strong" /> Shop assistant</p>
                {turn.pending ? (
                  <p role="status" className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Checking this shop…</p>
                ) : turn.error ? (
                  <p role="alert" className="text-destructive">{turn.error}</p>
                ) : reply ? (
                  <>
                    {reply.answer ? <p>{reply.answer}</p> : null}
                    {reply.unmatched?.length ? <p className="mt-1 text-muted-foreground">Not found here: {reply.unmatched.map((u: any) => u.text).join(", ")}.</p> : null}
                    {lines.length > 0 ? (
                      isSignedIn ? (
                        <ul className="mt-2 divide-y divide-dashed">
                          {lines.slice(0, 8).map((line: any, i: number) => (
                            <li key={`${turn.id}-${line.product.id}-${i}`} className="flex items-center justify-between gap-2 py-2">
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
                        <p className="mt-2 text-muted-foreground">
                          <Link to="/login" search={{ next: `/store/${store.slug}` }} className="font-semibold text-foreground underline">Sign in</Link> to add these to your cart.
                        </p>
                      )
                    ) : null}
                    {reply.source ? <p className="mt-2 text-xs text-muted-foreground">From: {reply.source}</p> : null}
                  </>
                ) : null}
              </div>
            </article>
          );
        })}
        <div ref={transcriptEnd} aria-hidden="true" />
      </div>
      <form onSubmit={submit} className="flex gap-2 border-t border-dashed pt-3">
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
