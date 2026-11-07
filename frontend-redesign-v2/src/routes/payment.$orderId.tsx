import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Clock, X, Loader2, CreditCard } from "lucide-react";
import { cn } from "@/lib/utils";
import { endpoints } from "@/lib/cpse/endpoints";
import { formatPaise } from "@/lib/cpse/money";
import { RequireAuth } from "@/customer/RequireAuth";
import { cpse } from "@/customer/hooks";
import { ErrorState, InlineError, Skel } from "@/components/cpse/States";
import { Button } from "@/components/ui/button";

type Search = { outcome?: string };

export const Route = createFileRoute("/payment/$orderId")({
  validateSearch: (s: Record<string, unknown>): Search => ({ outcome: typeof s["outcome"] === "string" ? (s["outcome"] as string) : undefined }),
  head: () => ({
    meta: [
      { title: "Payment — CPSE" },
      { name: "description", content: "Pay for your CPSE order and see whether the payment went through." },
      { property: "og:title", content: "Payment — CPSE" },
      { property: "og:description", content: "Pay for your CPSE order." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <RequireAuth>
      <PaymentPage />
    </RequireAuth>
  ),
});

const POLL_MS = 3000;
const POLL_LIMIT = 20;

/** The verdict comes from the ORDER, never from the URL the customer returned on. */
function outcomeOf(order: any) {
  if (order.paymentStatus === "paid") return { tone: "done", title: "Payment received", body: `Your order is confirmed and ${order.storeName} has it now.`, canRetry: false };
  if (order.status === "cancelled" || order.paymentStatus === "cancelled") return { tone: "stopped", title: "Payment cancelled", body: "Nothing has been charged, and the order was not placed.", canRetry: false };
  if (order.paymentStatus === "failed") return { tone: "stopped", title: "Payment didn’t go through", body: "Nothing has been charged. Your order is still here, so you can try again.", canRetry: true };
  return { tone: "waiting", title: "Waiting on your payment", body: "Pay with our payment partner, then come back here. We confirm with them directly.", canRetry: true };
}

/** Starts a payment attempt. The mock gateway page lives inside this app. */
async function startPayment(orderId: string, navigate: ReturnType<typeof useNavigate>) {
  const { data } = await endpoints.payments.initiate(orderId);
  const url: string | undefined = data?.clientPayload?.checkoutUrl;
  if (!url) throw new Error("The payment provider did not give us anywhere to go.");
  const parsed = new URL(url, window.location.origin);
  if (parsed.origin === window.location.origin || parsed.hostname === "cpse.onrender.com") {
    navigate({ href: `${parsed.pathname}${parsed.search}` });
  } else {
    window.location.assign(url);
  }
}

function PaymentPage() {
  const { orderId } = Route.useParams();
  const { outcome: claimed } = Route.useSearch();
  const navigate = useNavigate();
  const [verifying, setVerifying] = useState(false);
  const [starting, setStarting] = useState(false);
  const [actionError, setActionError] = useState<any>(null);
  const [polls, setPolls] = useState(0);
  const verifiedFor = useRef<string | null>(null);

  const order = useQuery({ queryKey: ["order", orderId], queryFn: cpse<{ order: any }>(() => endpoints.orders.get(orderId)) });
  const current = order.data?.order;

  const verify = useCallback(async () => {
    setVerifying(true);
    setActionError(null);
    try {
      await endpoints.payments.verify(orderId, claimed ? { outcome: claimed } : {});
    } catch (e) {
      setActionError(e);
    } finally {
      await order.refetch();
      setVerifying(false);
    }
  }, [orderId, claimed, order]);

  // Verify exactly once when the customer comes back from the gateway.
  useEffect(() => {
    if (!current || current.status !== "pending_payment" || !claimed) return;
    if (verifiedFor.current === orderId) return;
    verifiedFor.current = orderId;
    verify();
  }, [current, orderId, claimed, verify]);

  // While still pending after a gateway return, keep asking — bounded.
  useEffect(() => {
    if (!current || current.status !== "pending_payment" || !claimed || polls >= POLL_LIMIT) return undefined;
    const t = setTimeout(() => {
      setPolls((n) => n + 1);
      order.refetch();
    }, POLL_MS);
    return () => clearTimeout(t);
  }, [current?.status, polls, claimed]); // eslint-disable-line react-hooks/exhaustive-deps

  if (order.error && !current) {
    const err: any = order.error;
    return <ErrorState error={err} title={err?.status === 404 ? "That order isn’t here" : undefined} onRetry={err?.status === 404 ? undefined : () => order.refetch()} />;
  }
  if (!current) {
    return (
      <div role="status" aria-label="Checking your payment" className="mx-auto max-w-md space-y-4">
        <Skel className="mx-auto h-20 w-20 rounded-full" />
        <Skel className="h-8 w-2/3" />
        <Skel className="h-28 w-full rounded-2xl" />
      </div>
    );
  }

  const o = outcomeOf(current);
  const firstAttempt = o.tone === "waiting" && !claimed;

  const pay = async () => {
    setStarting(true);
    setActionError(null);
    try {
      await startPayment(orderId, navigate);
    } catch (e) {
      setActionError(e);
      setStarting(false);
    }
  };

  return (
    <div className="mx-auto max-w-md text-center">
      <div
        aria-hidden="true"
        className={cn(
          "mx-auto mb-5 grid h-20 w-20 place-items-center rounded-full animate-rise-in [&_svg]:h-9 [&_svg]:w-9",
          o.tone === "done" ? "bg-success text-success-foreground" : o.tone === "stopped" ? "bg-destructive text-destructive-foreground" : "bg-primary text-primary-foreground",
        )}
      >
        {o.tone === "done" ? <Check /> : o.tone === "stopped" ? <X /> : firstAttempt ? <CreditCard /> : <Clock />}
      </div>
      <h1 className="text-3xl font-extrabold" aria-live="polite">{firstAttempt ? "One step left: pay" : o.title}</h1>
      <p className="mt-2 text-muted-foreground">{o.body}</p>

      <dl className="surface mt-6 divide-y divide-dashed text-left text-sm">
        <div className="flex justify-between px-4 py-3"><dt className="text-muted-foreground">Order</dt><dd className="numeric font-semibold">{current.orderNumber}</dd></div>
        <div className="flex justify-between px-4 py-3"><dt className="text-muted-foreground">Shop</dt><dd className="font-semibold">{current.storeName}</dd></div>
        <div className="flex justify-between px-4 py-3"><dt className="text-muted-foreground">Amount</dt><dd className="numeric font-display text-lg font-extrabold">{formatPaise(current.totalPaise)}</dd></div>
      </dl>

      {o.tone === "waiting" && claimed ? (
        <p role="status" className="mt-4 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          {verifying ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {verifying ? "Checking with the payment provider…" : polls >= POLL_LIMIT ? "Still not confirmed. It can take a few minutes — reopen this order to check again." : "Waiting for confirmation…"}
        </p>
      ) : null}

      <InlineError error={actionError} className="mt-4 text-left" />

      <div className="mt-6 grid gap-2">
        {o.canRetry ? (
          <Button size="lg" onClick={pay} disabled={starting || verifying}>
            {starting ? <Loader2 className="animate-spin" /> : <CreditCard />} {firstAttempt ? `Pay ${formatPaise(current.totalPaise)}` : "Try paying again"}
          </Button>
        ) : null}
        {o.tone === "waiting" && claimed ? (
          <Button variant="outline" onClick={verify} disabled={verifying}>
            {verifying ? "Checking…" : "Check again now"}
          </Button>
        ) : null}
        <Button asChild variant={o.canRetry ? "outline" : "ink"} size="lg">
          <Link to="/orders/$orderId" params={{ orderId }}>View the order</Link>
        </Button>
      </div>
    </div>
  );
}
