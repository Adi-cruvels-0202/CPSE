import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Check, CircleDot, PartyPopper, RotateCcw, XCircle, Loader2, Phone, MapPin, CreditCard, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { endpoints } from "@/lib/cpse/endpoints";
import { formatPaise } from "@/lib/cpse/money";
import { formatWhen, isTerminal, meaningFor, paymentFor, REFUND_WORKING_DAYS } from "@/lib/cpse/orderStatus";
import { RequireAuth } from "@/customer/RequireAuth";
import { cpse } from "@/customer/hooks";
import { SmartImage } from "@/components/cpse/SmartImage";
import { OrderStamp, Stamp } from "@/components/cpse/Stamp";
import { ErrorState, InlineError, Skel } from "@/components/cpse/States";
import { Button } from "@/components/ui/button";

type Search = { placed?: boolean };

export const Route = createFileRoute("/orders/$orderId")({
  validateSearch: (s: Record<string, unknown>): Search => ({ placed: s["placed"] === true || s["placed"] === "true" ? true : undefined }),
  head: () => ({
    meta: [
      { title: "Order — CPSE" },
      { name: "description", content: "Track your order step by step, see the bill and contact the shop." },
      { property: "og:title", content: "Order — CPSE" },
      { property: "og:description", content: "Track your order step by step." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <RequireAuth>
      <OrderPage />
    </RequireAuth>
  ),
});

const SUB_PREF: Record<string, string> = {
  contact_me: "Ask me before replacing anything",
  allow_similar: "Replace with a similar item if needed",
  no_substitutions: "No replacements — leave it out",
};
const SUB_STATUS: Record<string, string> = { pending: "Waiting for you", approved: "Accepted", rejected: "Declined", withdrawn: "Withdrawn by the shop" };

function OrderPage() {
  const { orderId } = Route.useParams();
  const { placed } = Route.useSearch();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<"cancel" | "reorder" | null>(null);
  const [actionError, setActionError] = useState<any>(null);

  const query = useQuery({
    queryKey: ["order", orderId],
    queryFn: cpse<{ order: any }>(() => endpoints.orders.get(orderId)),
    // A live order moves on its own; check every 20 s while it is still happening.
    refetchInterval: (q) => (q.state.data && !isTerminal((q.state.data as any).order?.status) ? 20_000 : false),
  });
  const order = query.data?.order;

  // Announce status changes once, politely.
  const lastStatus = useRef<string | null>(null);
  const [changed, setChanged] = useState(false);
  useEffect(() => {
    if (!order) return;
    if (lastStatus.current && lastStatus.current !== order.status) {
      setChanged(true);
      toast(`Order is now: ${order.statusLabel}`);
    }
    lastStatus.current = order.status;
  }, [order?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  if (query.isLoading) {
    return (
      <div role="status" aria-label="Loading the order" className="mx-auto max-w-4xl space-y-4">
        <Skel className="h-24 rounded-2xl" />
        <div className="grid gap-4 md:grid-cols-[1fr_1.3fr]">
          <Skel className="h-72 rounded-2xl" />
          <Skel className="h-72 rounded-2xl" />
        </div>
      </div>
    );
  }
  if (query.error || !order) {
    const err: any = query.error;
    return <ErrorState error={err ?? { message: "That order could not be loaded." }} title={err?.status === 404 ? "That order isn’t here" : undefined} onRetry={err?.status === 404 ? undefined : () => query.refetch()} />;
  }

  const payment = paymentFor(order.paymentStatus);
  const steps = order.timeline?.steps ?? [];

  const cancel = async () => {
    if (!window.confirm("Cancel this order?")) return;
    setBusy("cancel");
    setActionError(null);
    try {
      await endpoints.orders.cancel(orderId, {});
      await query.refetch();
      toast.success("Order cancelled");
    } catch (e) {
      setActionError(e);
    } finally {
      setBusy(null);
    }
  };

  const reorder = async () => {
    setBusy("reorder");
    setActionError(null);
    try {
      const { data } = await endpoints.orders.reorder(orderId);
      const skipped = (data?.skipped ?? data?.notAdded ?? []).length;
      toast.success(skipped ? `Added to your cart. ${skipped} item(s) couldn’t be added.` : "Everything’s back in your cart");
      navigate({ to: "/cart/$storeId", params: { storeId: data?.storeId ?? order.storeId } });
    } catch (e) {
      setActionError(e);
    } finally {
      setBusy(null);
    }
  };

  const addr = order.fulfilment?.deliveryAddress ?? order.fulfilment?.address;
  const pickup = order.fulfilment?.pickupFrom ?? order.store;

  return (
    <div className="mx-auto max-w-5xl">
      <Link to="/orders" className="mb-4 inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> All orders
      </Link>

      {placed ? (
        <div role="status" className="mb-6 flex items-center gap-4 rounded-2xl bg-success px-5 py-4 text-success-foreground animate-rise-in">
          <PartyPopper className="h-7 w-7 shrink-0" />
          <div>
            <p className="font-display text-xl font-bold">Order placed</p>
            <p className="text-sm opacity-90">{order.storeName} has it now. We’ll keep this page updated.</p>
          </div>
        </div>
      ) : null}

      <header className="mb-6 grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4">
        <div className="min-w-0">
          <p className="numeric text-sm font-semibold text-muted-foreground">{order.orderNumber}</p>
          <h1 className="text-3xl font-extrabold sm:text-4xl">{order.storeName}</h1>
          <p className="mt-1 text-muted-foreground">{formatWhen(order.placedAt)} · {order.fulfilmentMode === "delivery" ? "Delivery" : "Pickup"}</p>
        </div>
        <OrderStamp status={order.status} label={order.statusLabel} className={cn("text-sm", changed && "animate-highlight")} />
      </header>

      {order.status === "pending_payment" ? (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-warning/40 bg-warning-soft px-5 py-4">
          <p className="font-semibold">Not confirmed until the payment goes through.</p>
          <Button asChild size="sm"><Link to="/payment/$orderId" params={{ orderId }}><CreditCard /> Finish paying</Link></Button>
        </div>
      ) : null}

      <div className="grid gap-5 md:grid-cols-[1fr_1.3fr]">
        <section aria-labelledby="progress-h" className="surface p-5">
          <h2 id="progress-h" className="mb-1 text-lg font-bold">Progress</h2>
          <p className="mb-5 text-sm text-muted-foreground" aria-live="polite">{meaningFor(order.status)}</p>
          <ol className="relative space-y-0">
            {steps.map((s: any, i: number) => {
              const reached = Boolean(s.reachedAt);
              const last = i === steps.length - 1;
              return (
                <li key={s.status} className="relative grid grid-cols-[1.75rem_minmax(0,1fr)] gap-3 pb-5">
                  {!last ? <span aria-hidden="true" className={cn("absolute left-[0.8rem] top-7 h-[calc(100%-1.25rem)] w-0.5", reached ? "bg-success" : "bg-border")} /> : null}
                  <span
                    className={cn(
                      "relative z-10 grid h-7 w-7 place-items-center rounded-full border-2",
                      s.isCurrent ? "border-ink bg-primary text-primary-foreground" : reached ? "border-success bg-success text-success-foreground" : "border-border bg-card text-muted-foreground",
                    )}
                    aria-hidden="true"
                  >
                    {s.isCurrent ? <CircleDot className="h-4 w-4" /> : reached ? <Check className="h-4 w-4" /> : null}
                  </span>
                  <span>
                    <span className={cn("block font-semibold", !reached && "text-muted-foreground")}>
                      {s.label}
                      {s.isCurrent ? <span className="sr-only"> (current)</span> : null}
                    </span>
                    {s.reachedAt ? <span className="numeric text-xs text-muted-foreground">{formatWhen(s.reachedAt)}</span> : null}
                  </span>
                </li>
              );
            })}
            {order.status === "cancelled" || order.status === "rejected" ? (
              <li className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-3">
                <span className="grid h-7 w-7 place-items-center rounded-full bg-destructive text-destructive-foreground"><XCircle className="h-4 w-4" /></span>
                <span>
                  <span className="block font-semibold">{order.statusLabel}</span>
                  {order.cancellationReason ? <span className="text-sm text-muted-foreground">Reason: {order.cancellationReason}</span> : null}
                </span>
              </li>
            ) : null}
          </ol>

          <div className="mt-2 space-y-2 border-t border-dashed pt-4 text-sm">
            {order.fulfilmentMode === "delivery" && addr ? (
              <p className="flex gap-2"><MapPin className="mt-0.5 h-4 w-4 shrink-0" /> {[addr.recipientName, addr.line1 ?? addr.addressLine1, addr.city].filter(Boolean).join(", ")}</p>
            ) : pickup ? (
              <p className="flex gap-2"><MapPin className="mt-0.5 h-4 w-4 shrink-0" /> Pick up from {[pickup.addressLine1, pickup.addressLine2, pickup.city].filter(Boolean).join(", ")}</p>
            ) : null}
            {order.store?.phone ? (
              <a href={`tel:${order.store.phone}`} className="flex items-center gap-2 font-semibold hover:underline"><Phone className="h-4 w-4" /> Call {order.storeName}</a>
            ) : null}
            {SUB_PREF[order.substitutionPreference] ? <p className="text-muted-foreground">If something is out of stock: {SUB_PREF[order.substitutionPreference]}.</p> : null}
          </div>
        </section>

        <div className="space-y-5">
          <Substitutions order={order} onChanged={() => query.refetch()} />
          <Refunds order={order} />

          <section aria-labelledby="items-h" className="surface p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 id="items-h" className="text-lg font-bold">{order.itemCount} {order.itemCount === 1 ? "item" : "items"}</h2>
              {payment ? <Stamp tone={payment.tone}>{payment.label}</Stamp> : null}
            </div>
            <ul className="divide-y divide-dashed">
              {(order.items ?? []).map((item: any) => (
                <li key={item.id} className="flex items-center gap-3 py-3">
                  <SmartImage src={item.imageUrl} name={item.name} alt="" className="h-12 w-12 shrink-0 rounded-lg bg-sunk text-xs text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{item.name}{item.variantName ? <span className="font-normal text-muted-foreground"> · {item.variantName}</span> : null}</span>
                    <span className="numeric text-sm text-muted-foreground">{item.quantity} × {formatPaise(item.unitPricePaise)}</span>
                  </span>
                  <span className="numeric font-semibold">{formatPaise(item.lineSubtotalPaise ?? item.lineTotalPaise)}</span>
                </li>
              ))}
            </ul>
            <dl className="mt-3 space-y-1.5 border-t border-dashed pt-3 text-sm">
              <Row label="Subtotal" value={formatPaise(order.totals.subtotalPaise)} />
              {order.totals.discountPaise > 0 ? <Row label="Savings" value={`−${formatPaise(order.totals.discountPaise)}`} /> : null}
              {order.totals.taxPaise > 0 ? <Row label="GST" value={formatPaise(order.totals.taxPaise)} /> : null}
              {order.totals.deliveryFeePaise > 0 ? <Row label="Delivery" value={formatPaise(order.totals.deliveryFeePaise)} /> : null}
              <div className="flex items-baseline justify-between pt-2">
                <dt className="font-bold">Total</dt>
                <dd className="numeric font-display text-2xl font-extrabold">{formatPaise(order.totals.totalPaise)}</dd>
              </div>
            </dl>
            {order.status === "cancelled" && !order.refund && order.paymentStatus === "paid" ? (
              <p className="mt-3 rounded-lg bg-info-soft px-3 py-2 text-sm">{formatPaise(order.totals.totalPaise)} will be refunded to the account you paid from. Banks usually take {REFUND_WORKING_DAYS} working days.</p>
            ) : null}
          </section>

          <InlineError error={actionError} />
          <div className="flex flex-wrap gap-2">
            {order.isCancellable ? (
              <Button variant="outline" className="text-destructive" onClick={cancel} disabled={busy !== null}>
                {busy === "cancel" ? <Loader2 className="animate-spin" /> : <XCircle />} Cancel order
              </Button>
            ) : null}
            {isTerminal(order.status) ? (
              <Button variant="ink" onClick={reorder} disabled={busy !== null}>
                {busy === "reorder" ? <Loader2 className="animate-spin" /> : <RotateCcw />} Order again
              </Button>
            ) : (
              <Button variant="ghost" onClick={() => query.refetch()} disabled={query.isFetching}>
                <RefreshCw className={cn(query.isFetching && "animate-spin")} /> Refresh
              </Button>
            )}
          </div>
          {order.cancellation?.rule && !isTerminal(order.status) ? <p className="text-xs text-muted-foreground">{order.cancellation.rule}</p> : null}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="numeric">{value}</dd>
    </div>
  );
}

function Substitutions({ order, onChanged }: { order: any; onChanged: () => void }) {
  const subs = order.substitutions ?? [];
  if (!subs.length) return null;
  return (
    <section aria-labelledby="subs-h" className="surface border-warning/40 p-5">
      <h2 id="subs-h" className="mb-3 text-lg font-bold">Replacements</h2>
      <ul className="space-y-4">{subs.map((s: any) => <SubRow key={s.id} sub={s} onChanged={onChanged} />)}</ul>
    </section>
  );
}

function SubRow({ sub, onChanged }: { sub: any; onChanged: () => void }) {
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<any>(null);
  const respond = async (approve: boolean) => {
    setPending(true);
    setError(null);
    try {
      await endpoints.substitutions.respond(sub.id, { approve, ...(note.trim() ? { note: note.trim() } : {}) });
      onChanged();
    } catch (e) {
      setError(e);
    } finally {
      setPending(false);
    }
  };
  const o = sub.original;
  return (
    <li className="rounded-xl bg-paper p-3 text-sm">
      <div className="flex items-start justify-between gap-2">
        <p>
          {o ? `${o.name}${o.variantName ? ` · ${o.variantName}` : ""}` : "An item"} → <strong>{sub.proposed.name}{sub.proposed.variantName ? ` · ${sub.proposed.variantName}` : ""}</strong> × {sub.proposed.quantity}
        </p>
        <Stamp tone={sub.status === "pending" ? "waiting" : sub.status === "approved" ? "done" : "neutral"}>{SUB_STATUS[sub.status] ?? sub.status}</Stamp>
      </div>
      <p className="numeric mt-1 text-muted-foreground">
        {formatPaise(sub.proposed.linePaise)} instead of {formatPaise(sub.originalLinePaise)}
        {sub.savingPaise > 0 ? ` — you pay ${formatPaise(sub.savingPaise)} less` : ""}
      </p>
      {sub.merchantNote ? <p className="mt-1">The shop says: “{sub.merchantNote}”</p> : null}
      {sub.status === "pending" ? (
        <div className="mt-3 space-y-2">
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Note to the shop (optional)" aria-label="Note to the shop" className="h-10 w-full rounded-full border border-input bg-card px-4 outline-none focus:border-border-strong" />
          <InlineError error={error} />
          <div className="flex gap-2">
            <Button size="sm" variant="success" disabled={pending} onClick={() => respond(true)}>Accept</Button>
            <Button size="sm" variant="outline" disabled={pending} onClick={() => respond(false)}>Decline</Button>
          </div>
          <p className="text-xs text-muted-foreground">If you decline, the item is left out and you’re not charged for it.</p>
        </div>
      ) : null}
    </li>
  );
}

function Refunds({ order }: { order: any }) {
  const list = [order.refund, ...(order.refundAdjustments ?? [])].filter(Boolean);
  if (!list.length) return null;
  return (
    <section aria-labelledby="refund-h" className="surface p-5">
      <h2 id="refund-h" className="mb-3 text-lg font-bold">Your money back</h2>
      <ul className="space-y-3">
        {list.map((r: any) => (
          <li key={r.id} className="rounded-xl bg-info-soft p-3 text-sm">
            <div className="flex justify-between gap-2">
              <strong>{r.kind === "adjustment" ? "Partial refund" : "Refund"} of {formatPaise(r.amountPaise)}</strong>
              <Stamp tone="active">{r.statusLabel}</Stamp>
            </div>
            <p>{r.methodLabel}</p>
            {r.reason ? <p className="text-muted-foreground">Why: {r.reason}</p> : null}
            {r.nextStep ? <p>{r.nextStep}</p> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
