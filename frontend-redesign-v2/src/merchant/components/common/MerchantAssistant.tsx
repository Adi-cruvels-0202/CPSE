import { useEffect, useRef, useState, type FormEvent } from "react";
import { Bot, Loader2, MessageCircle, Send, X } from "lucide-react";
import { intelligenceApi, type AssistantReply, type Proposal } from "@/merchant/api/ops";
import { useActiveStore } from "@/merchant/hooks/useStore";
import { useAuth } from "@/merchant/hooks/useAuth";
import { Link } from "@/merchant/router";

type Turn = {
  id: string;
  question: string;
  reply?: AssistantReply;
  error?: string;
  pending?: boolean;
  applied?: boolean;
  applyError?: string;
  applying?: boolean;
};
type Session = { turns: Turn[]; pending: boolean };

const suggestions = ["How much did I sell today?", "What stock is running low?", "Any new orders?"];

export function MerchantAssistant() {
  const { activeStoreId } = useActiveStore();
  const { stores } = useAuth();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [sessions, setSessions] = useState<Record<string, Session>>({});
  const inputRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const store = stores.find((item) => item.id === activeStoreId);
  const session = activeStoreId ? sessions[activeStoreId] ?? { turns: [], pending: false } : { turns: [], pending: false };

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    endRef.current?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "end" });
  }, [open, session.turns]);

  const updateSession = (storeId: string, update: (current: Session) => Session) => {
    setSessions((current) => ({
      ...current,
      [storeId]: update(current[storeId] ?? { turns: [], pending: false }),
    }));
  };

  async function ask(question: string) {
    const text = question.trim();
    if (!activeStoreId || !text || session.pending) return;
    const storeId = activeStoreId;
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setDraft("");
    updateSession(storeId, (current) => ({
      pending: true,
      turns: [...current.turns, { id, question: text, pending: true }],
    }));
    try {
      const { reply } = await intelligenceApi.ask(storeId, text);
      updateSession(storeId, (current) => ({
        ...current,
        pending: false,
        turns: current.turns.map((turn) => turn.id === id ? { ...turn, pending: false, reply } : turn),
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "I couldn’t get an answer just now. Please try again.";
      updateSession(storeId, (current) => ({
        ...current,
        pending: false,
        turns: current.turns.map((turn) => turn.id === id ? { ...turn, pending: false, error: message } : turn),
      }));
    }
  }

  async function confirm(turnId: string, proposal: Proposal) {
    if (!activeStoreId) return;
    const storeId = activeStoreId;
    updateSession(storeId, (current) => ({
      ...current,
      turns: current.turns.map((turn) => turn.id === turnId ? { ...turn, applying: true, applyError: undefined } : turn),
    }));
    try {
      await intelligenceApi.apply(storeId, proposal);
      updateSession(storeId, (current) => ({
        ...current,
        turns: current.turns.map((turn) => turn.id === turnId ? { ...turn, applying: false, applied: true } : turn),
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "That change couldn’t be applied. Please try again.";
      updateSession(storeId, (current) => ({
        ...current,
        turns: current.turns.map((turn) => turn.id === turnId ? { ...turn, applying: false, applyError: message } : turn),
      }));
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void ask(draft);
  }

  return (
    <>
      {open ? (
        <section role="dialog" aria-label="Merchant shop assistant" className="fixed bottom-[calc(8.5rem+env(safe-area-inset-bottom))] right-3 z-50 flex max-h-[min(72dvh,42rem)] w-[min(25rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-2xl border border-border-strong/20 bg-card text-foreground shadow-pop md:bottom-24 md:right-6">
          <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary-strong"><Bot className="h-4 w-4" /></span>
              <div className="min-w-0">
                <h2 className="truncate font-display font-bold">Shop assistant</h2>
                <p className="truncate text-xs text-muted-foreground">{store?.name ?? "Your shop"} · Ask or suggest a change</p>
              </div>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close shop assistant" className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><X className="h-4 w-4" /></button>
          </header>

          <div role="log" aria-label={`${store?.name ?? "Shop"} assistant conversation`} aria-live="polite" aria-relevant="additions text" className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-3">
            {session.turns.length === 0 ? (
              <div className="space-y-3 rounded-xl bg-paper p-3">
                <div className="flex items-start gap-2 text-sm"><Bot className="mt-0.5 h-4 w-4 shrink-0 text-primary-strong" /><p>Ask about sales, orders, stock or khata. I can suggest changes, and you choose whether to confirm them.</p></div>
                <div className="flex flex-wrap gap-2">
                  {suggestions.map((item) => <button key={item} type="button" disabled={session.pending || !activeStoreId} onClick={() => void ask(item)} className="rounded-full border bg-card px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">{item}</button>)}
                </div>
              </div>
            ) : session.turns.map((turn) => (
              <article key={turn.id} className="space-y-2">
                <p className="ml-auto max-w-[90%] rounded-2xl rounded-br-md bg-ink px-3 py-2 text-sm text-ink-foreground">{turn.question}</p>
                <div className="max-w-[96%] rounded-2xl rounded-bl-md border bg-paper p-3 text-sm">
                  {turn.pending ? <p role="status" className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Checking your shop…</p> : null}
                  {turn.error ? <p role="alert" className="text-destructive">{turn.error}</p> : null}
                  {turn.reply ? (
                    <>
                      <div className="flex items-start gap-2"><Bot className="mt-0.5 h-4 w-4 shrink-0 text-primary-strong" /><p>{turn.reply.answer}</p></div>
                      {turn.reply.problem ? <p className="mt-2 rounded-lg bg-warning-soft p-2 text-xs">{turn.reply.problem}{turn.reply.options?.length ? ` Options: ${turn.reply.options.map((option) => option.name).join(", ")}.` : ""}</p> : null}
                      {turn.reply.examples?.length ? <p className="mt-2 text-xs text-muted-foreground">Try: {turn.reply.examples.join(" · ")}</p> : null}
                      {turn.reply.proposal ? (
                        <div className="mt-2 rounded-xl border bg-card p-3">
                          <p className="font-semibold">{turn.reply.proposal.summary}</p>
                          {turn.reply.proposal.warning ? <p className="mt-1 text-xs text-muted-foreground">{turn.reply.proposal.warning}</p> : null}
                          {turn.applyError ? <p role="alert" className="mt-2 text-xs text-destructive">{turn.applyError}</p> : null}
                          {turn.applied ? <p role="status" className="mt-2 text-xs font-semibold text-success">Confirmed and applied</p> : <button type="button" disabled={turn.applying} onClick={() => void confirm(turn.id, turn.reply!.proposal!)} className="mt-3 inline-flex min-h-9 items-center gap-2 rounded-lg bg-primary px-3 text-xs font-bold text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60">{turn.applying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}{turn.applying ? "Applying…" : "Confirm change"}</button>}
                        </div>
                      ) : null}
                      {turn.reply.actions?.map((action) => <Link key={action.to} to={action.to as any} className="mt-2 inline-flex rounded-lg border bg-card px-3 py-2 text-xs font-semibold hover:bg-accent">{action.text}</Link>)}
                      {turn.reply.source ? <p className="mt-2 text-[11px] text-muted-foreground">From: {turn.reply.source}</p> : null}
                    </>
                  ) : null}
                </div>
              </article>
            ))}
            <div ref={endRef} aria-hidden="true" />
          </div>

          <form onSubmit={submit} className="flex gap-2 border-t border-border p-3">
            <input ref={inputRef} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Ask about your shop…" aria-label="Ask your shop assistant" maxLength={500} className="min-w-0 flex-1 rounded-xl border bg-background px-3 text-sm outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground focus:border-primary-strong focus:ring-2 focus:ring-ring/25" />
            <button type="submit" aria-label="Send question" disabled={!draft.trim() || session.pending || !activeStoreId} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-ink text-ink-foreground transition-colors hover:bg-primary-strong hover:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">{session.pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}</button>
          </form>
        </section>
      ) : null}

      <button type="button" onClick={() => setOpen((value) => !value)} aria-label={open ? "Close shop assistant" : "Open shop assistant"} aria-expanded={open} disabled={!activeStoreId} className="fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom))] right-4 z-40 grid h-14 w-14 place-items-center rounded-full bg-ink text-ink-foreground shadow-pop transition-[transform,background-color] hover:scale-105 hover:bg-primary-strong hover:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-60 md:bottom-6 md:right-6">
        {open ? <X className="h-5 w-5" /> : <MessageCircle className="h-5 w-5" />}
      </button>
    </>
  );
}
