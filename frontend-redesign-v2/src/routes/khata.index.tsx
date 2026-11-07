import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { BookOpenText, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { endpoints } from "@/lib/cpse/endpoints";
import { formatPaise } from "@/lib/cpse/money";
import { RequireAuth } from "@/customer/RequireAuth";
import { cpse } from "@/customer/hooks";
import { EmptyState, ErrorState, PageTitle, Skel } from "@/components/cpse/States";

export const Route = createFileRoute("/khata/")({
  head: () => ({
    meta: [
      { title: "Khata — CPSE" },
      { name: "description", content: "What you owe and what’s in credit at each shop that keeps a khata for you." },
      { property: "og:title", content: "Khata — CPSE" },
      { property: "og:description", content: "Your store credit balances." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <RequireAuth>
      <KhataPage />
    </RequireAuth>
  ),
});

function KhataPage() {
  const query = useQuery({ queryKey: ["khata"], queryFn: cpse<{ accounts: any[]; totalOutstandingPaise: number }>(() => endpoints.khata.list()) });
  const accounts = query.data?.accounts ?? [];

  return (
    <div className="mx-auto max-w-3xl">
      <PageTitle eyebrow="Khata" title="Your shop credit" body="Shops keep this ledger; it’s read-only here." />
      {query.isLoading ? (
        <Skel className="h-48 rounded-2xl" />
      ) : query.error ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : accounts.length === 0 ? (
        <EmptyState icon={<BookOpenText />} title="No khata yet" body="When a shop opens a khata for you, the balance will show up here." />
      ) : (
        <>
          <div className="mb-6 rounded-3xl bg-ink p-6 text-ink-foreground">
            <p className="text-sm text-ink-muted">You owe in total</p>
            <p className="numeric font-display text-4xl font-extrabold">{formatPaise(query.data?.totalOutstandingPaise ?? 0)}</p>
          </div>
          <ul className="surface divide-y divide-dashed">
            {accounts.map((a: any) => (
              <li key={a.id}>
                <Link to="/khata/$accountId" params={{ accountId: a.id }} className="flex items-center gap-4 px-4 py-4 hover:bg-accent/50">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-bold">{a.store?.name ?? "Shop"}</span>
                    <span className="text-sm text-muted-foreground">{a.isSettled ? "All settled" : a.creditPaise > 0 ? "You’re in credit" : "Amount due"}</span>
                  </span>
                  <span className={cn("numeric text-lg font-extrabold", a.outstandingPaise > 0 ? "text-destructive" : a.creditPaise > 0 ? "text-success" : "")}>
                    {a.outstandingPaise > 0 ? formatPaise(a.outstandingPaise) : a.creditPaise > 0 ? `+${formatPaise(a.creditPaise)}` : formatPaise(0)}
                  </span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
