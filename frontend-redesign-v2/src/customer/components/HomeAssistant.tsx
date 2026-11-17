import { useEffect, useRef, useState } from "react";
import { Bot, Loader2, MessageCircle, Send, Sparkles, X } from "lucide-react";
import { endpoints } from "@/lib/cpse/endpoints";
import { useSelectedCity } from "@/customer/hooks";
import { Button } from "@/components/ui/button";
import { Link } from "@tanstack/react-router";

type Turn = {
  id: string;
  question: string;
  answer?: string;
  shops?: { store: any; reason: string }[];
  pending?: boolean;
  error?: string;
};

const starters = ["Where can I buy rice?", "Show me pharmacies", "I need fresh bread"];

export function HomeAssistant() {
  const city = useSelectedCity();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [pending, setPending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    endRef.current?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "end" });
  }, [turns, open]);

  async function ask(question: string) {
    const text = question.trim();
    if (!text || pending) return;
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setPending(true);
    setDraft("");
    setTurns((current) => [...current, { id, question: text, pending: true }]);
    try {
      const { data } = await endpoints.intelligence.homeAssistant(text, city);
      setTurns((current) => current.map((turn) => turn.id === id ? {
        ...turn,
        pending: false,
        answer: data.reply.answer,
        shops: data.reply.shops ?? [],
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
                      {turn.shops?.length ? (
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

          <form onSubmit={(event) => { event.preventDefault(); void ask(draft); }} className="flex gap-2 border-t border-border p-3">
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Try “rice” or “pharmacy”"
              aria-label="Ask CPSE to find a shop"
              maxLength={200}
              className="min-w-0 flex-1 rounded-xl border bg-background px-3 text-sm outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground focus:border-primary-strong focus:ring-2 focus:ring-ring/25"
            />
            <Button type="submit" size="icon" variant="ink" aria-label="Find shops" disabled={!draft.trim() || pending}>
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
