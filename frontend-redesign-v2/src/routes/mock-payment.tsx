import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FlaskConical } from "lucide-react";
import { endpoints } from "@/lib/cpse/endpoints";
import { formatPaise } from "@/lib/cpse/money";
import { RequireAuth } from "@/customer/RequireAuth";
import { cpse } from "@/customer/hooks";
import { ErrorState, Skel } from "@/components/cpse/States";
import { Button } from "@/components/ui/button";

type Search = { ref?: string };

export const Route = createFileRoute("/mock-payment")({
  validateSearch: (s: Record<string, unknown>): Search => ({ ref: typeof s["ref"] === "string" ? (s["ref"] as string) : undefined }),
  head: () => ({
    meta: [
      { title: "Test payment — CPSE" },
      { name: "description", content: "Stand-in payment page used while no live payment gateway is connected." },
      { property: "og:title", content: "Test payment — CPSE" },
      { property: "og:description", content: "Stand-in payment page for CPSE." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: () => (
    <RequireAuth>
      <MockPayment />
    </RequireAuth>
  ),
});

const OUTCOMES = [
  { value: "success", label: "Pay successfully", variant: "success" as const },
  { value: "failure", label: "Decline the card", variant: "destructive" as const },
  { value: "cancel", label: "Cancel and go back", variant: "outline" as const },
  { value: "pending", label: "Leave it pending", variant: "outline" as const },
];

/** Same behaviour as the original mock gateway: pick an outcome, return to the payment page with it. */
function MockPayment() {
  const { ref } = Route.useSearch();
  const [returning, setReturning] = useState<string | null>(null);
  const orders = useQuery({
    queryKey: ["orders", "pending_payment"],
    queryFn: cpse<{ orders: any[] }>(() => endpoints.orders.list({ status: "pending_payment", limit: 20 })),
  });
  const order = orders.data?.orders?.[0] ?? null;

  useEffect(() => {
    if (returning && order) window.location.assign(`/payment/${order.id}?outcome=${returning}`);
  }, [returning, order]);

  if (!ref) return <ErrorState title="Nothing to pay for" error={{ message: "This page is opened by the payment step; there is no payment to show." }} />;
  if (orders.isLoading) return <Skel className="mx-auto h-72 max-w-md rounded-2xl" />;

  return (
    <div className="mx-auto max-w-md">
      <p role="note" className="mb-4 flex items-center gap-2 rounded-xl bg-warning-soft px-4 py-3 text-sm">
        <FlaskConical className="h-4 w-4 shrink-0" /> Test payment page — no money moves.
      </p>
      <div className="surface p-6">
        <h1 className="text-2xl font-extrabold">Mock Payments</h1>
        <dl className="mt-4 space-y-2 text-sm">
          <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Reference</dt><dd className="numeric truncate">{ref}</dd></div>
          {order ? (
            <>
              <div className="flex justify-between"><dt className="text-muted-foreground">Order</dt><dd className="numeric">{order.orderNumber}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Amount</dt><dd className="numeric font-bold">{formatPaise(order.totalPaise)}</dd></div>
            </>
          ) : null}
        </dl>
        {order ? (
          <div className="mt-6 grid gap-2">
            <p className="text-sm text-muted-foreground">Choose what this payment should do:</p>
            {OUTCOMES.map((o) => (
              <Button key={o.value} variant={o.variant} disabled={Boolean(returning)} onClick={() => setReturning(o.value)}>
                {o.label}
              </Button>
            ))}
          </div>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">No order is waiting for payment.</p>
        )}
      </div>
    </div>
  );
}
