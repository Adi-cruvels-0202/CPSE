import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { endpoints } from "@/lib/cpse/endpoints";
import { formatPaise } from "@/lib/cpse/money";
import { formatDate } from "@/lib/cpse/orderStatus";
import { RequireAuth } from "@/customer/RequireAuth";
import { cpse } from "@/customer/hooks";
import { EmptyState, ErrorState, Skel } from "@/components/cpse/States";

export const Route = createFileRoute("/khata/$accountId")({
  head: () => ({
    meta: [
      { title: "Khata statement — CPSE" },
      { name: "description", content: "Every entry in your khata with a shop." },
      { property: "og:title", content: "Khata statement — CPSE" },
      { property: "og:description", content: "Every entry in your khata with a shop." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <RequireAuth>
      <KhataAccountPage />
    </RequireAuth>
  ),
});

function KhataAccountPage() {
  const { accountId } = Route.useParams();
  const query = useQuery({
    queryKey: ["khata", accountId],
    queryFn: cpse<{ account: any; totals: any; transactions: any[] }>(() => endpoints.khata.statement(accountId, { limit: 50 })),
  });

  if (query.isLoading) return <Skel className="mx-auto h-96 max-w-3xl rounded-2xl" />;
  if (query.error || !query.data) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  const { account, totals, transactions } = query.data;

  return (
    <div className="mx-auto max-w-3xl">
      <Link to="/khata" className="mb-4 inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> All khata
      </Link>
      <h1 className="mb-4 text-3xl font-extrabold">{account?.store?.name ?? "Khata"}</h1>
      <dl className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Opening" value={formatPaise(totals?.openingPaise ?? 0)} />
        <Stat label="Added" value={formatPaise(totals?.debitPaise ?? 0)} />
        <Stat label="Paid" value={formatPaise(totals?.creditPaise ?? 0)} />
        <Stat label="Balance" value={formatPaise(totals?.closingPaise ?? 0)} strong />
      </dl>
      {transactions?.length ? (
        <ul className="surface divide-y divide-dashed">
          {transactions.map((t: any) => {
            const owed = (t.signedAmountPaise ?? 0) > 0;
            return (
              <li key={t.id ?? t.key} className="flex items-center gap-3 px-4 py-3">
                <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-full", owed ? "bg-destructive-soft text-destructive" : "bg-success-soft text-success")}>
                  {owed ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownLeft className="h-4 w-4" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{t.entryLabel ?? t.label ?? t.type}</span>
                  <span className="text-xs text-muted-foreground">
                    {formatDate(t.occurredAt)}
                    {t.description ? ` · ${t.description}` : ""}
                    {t.dueDate ? ` · due ${formatDate(t.dueDate)}` : ""}
                  </span>
                </span>
                <span className={cn("numeric font-bold", owed ? "text-destructive" : "text-success")}>
                  {owed ? "+" : "−"}
                  {formatPaise(Math.abs(t.signedAmountPaise ?? t.amountPaise ?? 0))}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState title="No entries yet" />
      )}
    </div>
  );
}

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cn("rounded-2xl border p-3", strong ? "bg-ink text-ink-foreground" : "bg-card")}>
      <dt className={cn("text-xs", strong ? "text-ink-muted" : "text-muted-foreground")}>{label}</dt>
      <dd className="numeric font-display text-lg font-extrabold">{value}</dd>
    </div>
  );
}
