import { useEffect, useRef, useState } from "react";
import { Bot, ClipboardList, Loader2, MessageCircle, Send, Sparkles, X } from "lucide-react";
import { endpoints } from "@/lib/cpse/endpoints";
import { formatPaise } from "@/lib/cpse/money";
import { useSelectedCity } from "@/customer/hooks";
import { Button } from "@/components/ui/button";
import { Link } from "@tanstack/react-router";

type Turn = {
  id: string;
  question: string;
  answer?: string;
  shops?: { store: any; reason: string }[];
  comparison?: {
    items: { text: string; quantity: number }[];
    shops: {
      store: any;
      itemCount: number;
      totalItems: number;
      complete: boolean;
      items: { requestedText: string; productName: string; variantName: string | null; quantity: number; lineTotalPaise: number; onOffer: boolean }[];
      unmatched: string[];
      subtotalPaise: number;
      taxPaise: number;
      deliveryFeePaise: number;
      estimatedTotalPaise: number;
      fulfilmentMode: "delivery" | "pickup";
      minimumOrderPaise: number;
      meetsMinimumOrder: boolean;
      minimumOrderShortfallPaise: number;
    }[];
    note: string;
  };
  pending?: boolean;
  error?: string;
};

const starters = ["Where can I buy rice?", "Show me pharmacies", "I need fresh bread"];

export function HomeAssistant() {
  const city = useSelectedCity();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [compareMode, setCompareMode] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [pending, setPending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    endRef.current?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "end" });
  }, [turns, open]);

  async function ask(question: string) {
    const text = question.trim();
    if (!text || pending) return;
    const shouldCompare = compareMode;
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setPending(true);
    setDraft("");
    setCompareMode(false);
    setTurns((current) => [...current, { id, question: text, pending: true }]);
    try {
      const { data } = await endpoints.intelligence.homeAssistant(text, city, shouldCompare);
      setTurns((current) => current.map((turn) => turn.id === id ? {
        ...turn,
        pending: false,
        answer: data.reply.answer,
        shops: data.reply.shops ?? [],
        comparison: data.reply.kind === "list_comparison" ? data.reply : undefined,
      } : turn));
    } catch (error) {
      const message = error instanceof Error ? error.message : "I couldn’t find shops just now. Please try again.";
      setTurns((current) => current.map((turn) => turn.id === id ? { ...turn, pending: false, error: message } : turn));
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      {open ? (
        <section
          role="dialog"
          aria-label="CPSE shop finder"
          className="fixed bottom-40 right-4 z-50 flex max-h-[min(70dvh,38rem)] w-[min(24rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-border-strong/20 bg-card shadow-pop md:bottom-24"
        >
          <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary-strong"><Sparkles className="h-4 w-4" /></span>
              <div className="min-w-0">
                <h2 className="font-display font-bold">Find a local shop</h2>
                <p className="truncate text-xs text-muted-foreground">{city ? `Recommendations in ${city}` : "Search products or shop categories"}</p>
              </div>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close shop finder" className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <X className="h-4 w-4" />
            </button>
          </header>

          <div role="log" aria-label="Shop finder conversation" aria-live="polite" aria-relevant="additions text" className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-3">
            {turns.length === 0 ? (
              <div className="space-y-3 rounded-xl bg-paper p-3">
                <div className="flex items-start gap-2 text-sm">
                  <Bot className="mt-0.5 h-4 w-4 shrink-0 text-primary-strong" />
                  <p>Tell me what you need or which kind of shop you’re looking for. I’ll find nearby matches.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {starters.map((item) => (
                    <button key={item} type="button" disabled={pending} onClick={() => void ask(item)} className="rounded-full border bg-card px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
                      {item}
                    </button>
                  ))}
                </div>
                <p className="border-t border-border pt-3 text-xs text-muted-foreground">Comparing several products? Choose <strong className="text-foreground">List</strong> below to see estimated totals across local shops.</p>
              </div>
            ) : turns.map((turn) => (
              <article key={turn.id} className="space-y-2">
                <p className="ml-auto max-w-[90%] rounded-2xl rounded-br-md bg-ink px-3 py-2 text-sm text-ink-foreground">{turn.question}</p>
                <div className="max-w-[96%] rounded-2xl rounded-bl-md border bg-paper p-3 text-sm">
                  {turn.pending ? (
                    <p role="status" className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Looking through local shops…</p>
                  ) : turn.error ? (
                    <p role="alert" className="text-destructive">{turn.error}</p>
                  ) : (
                    <>
                      <div className="flex items-start gap-2"><Bot className="mt-0.5 h-4 w-4 shrink-0 text-primary-strong" /><p>{turn.answer}</p></div>
                      {turn.comparison ? <ComparisonResults comparison={turn.comparison} /> : turn.shops?.length ? (
                        <ul className="mt-2 space-y-2">
                          {turn.shops.map(({ store, reason }) => (
                            <li key={store.id}>
                              <Link to="/store/$slug" params={{ slug: store.slug }} className="block rounded-xl border bg-card p-2.5 transition-colors hover:border-border-strong/60 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                                <span className="block font-semibold">{store.name}</span>
                                <span className="mt-0.5 block text-xs text-muted-foreground">{reason}</span>
                                {store.location?.city ? <span className="mt-1 block text-[11px] text-muted-foreground">{store.location.city}</span> : null}
                              </Link>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </>
                  )}
                </div>
              </article>
            ))}
            <div ref={endRef} aria-hidden="true" />
          </div>

          <form onSubmit={(event) => { event.preventDefault(); void ask(draft); }} className="flex items-end gap-2 border-t border-border p-3">
            <button
              type="button"
              aria-pressed={compareMode}
              aria-label={compareMode ? "Turn off shopping list comparison" : "Compare a shopping list"}
              title={compareMode ? "Turn off list comparison" : "Compare a shopping list"}
              onClick={() => { setCompareMode((value) => !value); composerRef.current?.focus(); }}
              className={`grid h-10 shrink-0 place-items-center rounded-xl border px-2.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${compareMode ? "border-primary-strong bg-primary-soft text-foreground" : "bg-card text-muted-foreground hover:bg-accent"}`}
            >
              <span className="flex items-center gap-1.5"><ClipboardList className="h-4 w-4" /><span>List</span></span>
            </button>
            <textarea
              ref={composerRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }}
              rows={compareMode ? 2 : 1}
              placeholder={compareMode ? "e.g. 2 kg rice, 1 litre oil, 6 eggs" : "Try “rice” or “pharmacy”"}
              aria-label="Ask CPSE to find a shop"
              maxLength={2000}
              className="min-h-10 min-w-0 flex-1 resize-none rounded-xl border bg-background px-3 py-2 text-sm leading-5 outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground focus:border-primary-strong focus:ring-2 focus:ring-ring/25"
            />
            <Button type="submit" size="icon" variant="ink" className="h-10 w-10 shrink-0" aria-label={compareMode ? "Compare shops" : "Find shops"} disabled={!draft.trim() || pending}>
              {pending ? <Loader2 className="animate-spin" /> : <Send />}
            </Button>
          </form>
        </section>
      ) : null}

      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={open ? "Close shop finder" : "Open shop finder"}
        aria-expanded={open}
        className="fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom))] right-4 z-50 grid h-14 w-14 place-items-center rounded-full bg-ink text-ink-foreground shadow-pop transition-[transform,background-color] hover:scale-105 hover:bg-primary-strong hover:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 md:bottom-6"
      >
        {open ? <X className="h-5 w-5" /> : <MessageCircle className="h-5 w-5" />}
      </button>
    </>
  );
}

function ComparisonResults({ comparison }: { comparison: NonNullable<Turn["comparison"]> }) {
  if (!comparison.shops.length) return null;
  return (
    <div className="mt-3 space-y-2">
      {comparison.shops.map((shop, index) => (
        <article key={shop.store.id} className="rounded-xl border bg-card p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-1.5 font-semibold">
                <span className="truncate">{shop.store.name}</span>
                {index === 0 && shop.complete ? <span className="rounded-full bg-primary-soft px-2 py-0.5 text-[10px] font-bold">Best complete total</span> : null}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">{shop.itemCount} of {shop.totalItems} items · {shop.fulfilmentMode === "delivery" ? "Delivery" : "Pickup"}</p>
            </div>
            <div className="shrink-0 text-right">
              <strong className="block text-sm">{formatPaise(shop.estimatedTotalPaise)}</strong>
              <span className="text-[10px] text-muted-foreground">estimated total</span>
            </div>
          </div>
          <details className="mt-2 border-t border-border pt-2 text-xs">
            <summary className="cursor-pointer font-semibold text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">See item prices and availability</summary>
            <ul className="mt-2 space-y-1.5">
              {shop.items.map((item, itemIndex) => (
                <li key={`${item.productName}-${itemIndex}`} className="flex justify-between gap-3">
                  <span className="min-w-0">{item.requestedText} → {item.quantity} × {item.productName}{item.variantName ? ` · ${item.variantName}` : ""}{item.onOffer ? <span className="ml-1 text-success">Offer</span> : null}</span>
                  <span className="shrink-0 font-semibold">{formatPaise(item.lineTotalPaise)}</span>
                </li>
              ))}
              {shop.unmatched.map((item) => <li key={item} className="text-muted-foreground">Not found: {item}</li>)}
            </ul>
            <div className="mt-2 space-y-1 border-t border-border pt-2 text-muted-foreground">
              <p className="flex justify-between gap-3"><span>Items, before tax</span><span>{formatPaise(shop.subtotalPaise)}</span></p>
              <p className="flex justify-between gap-3"><span>Tax</span><span>{formatPaise(shop.taxPaise)}</span></p>
              <p className="flex justify-between gap-3"><span>{shop.fulfilmentMode === "delivery" ? "Delivery" : "Pickup"}</span><span>{shop.deliveryFeePaise ? formatPaise(shop.deliveryFeePaise) : "Free"}</span></p>
              {!shop.meetsMinimumOrder ? <p className="pt-1 text-destructive">₹{(shop.minimumOrderShortfallPaise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })} below the shop’s minimum order.</p> : null}
            </div>
          </details>
          <Link to="/store/$slug" params={{ slug: shop.store.slug }} className="mt-3 inline-flex min-h-10 items-center rounded-lg bg-ink px-3 py-2 text-xs font-semibold text-ink-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Review at this shop
          </Link>
        </article>
      ))}
      <p className="text-[11px] leading-relaxed text-muted-foreground">{comparison.note}</p>
    </div>
  );
}
