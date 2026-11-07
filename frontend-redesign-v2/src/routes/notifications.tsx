import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCheck, Package, CreditCard, BookOpenText, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { endpoints } from "@/lib/cpse/endpoints";
import { formatDayGroup, formatSince } from "@/lib/cpse/orderStatus";
import { RequireAuth } from "@/customer/RequireAuth";
import { cpse } from "@/customer/hooks";
import { EmptyState, ErrorState, PageTitle, Skel } from "@/components/cpse/States";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/notifications")({
  head: () => ({
    meta: [
      { title: "Notifications — CPSE" },
      { name: "description", content: "Order updates, payments and khata changes from your shops." },
      { property: "og:title", content: "Notifications — CPSE" },
      { property: "og:description", content: "Order updates, payments and khata changes." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <RequireAuth>
      <NotificationsPage />
    </RequireAuth>
  ),
});

const ICON: Record<string, any> = {
  order_placed: Package,
  order_status_changed: Package,
  order_cancelled: XCircle,
  payment_succeeded: CreditCard,
  payment_failed: CreditCard,
  khata_updated: BookOpenText,
};

function NotificationsPage() {
  const queryClient = useQueryClient();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const query = useQuery({
    queryKey: ["notifications", "list", unreadOnly],
    queryFn: cpse<{ notifications: any[]; unreadCount: number }>(() => endpoints.notifications.list({ unreadOnly: unreadOnly || undefined, limit: 50 })),
  });
  const list = query.data?.notifications ?? [];
  const unread = query.data?.unreadCount ?? 0;

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["notifications"] });
  const markAll = async () => {
    await endpoints.notifications.markAllRead().catch(() => undefined);
    refresh();
  };
  const markOne = async (id: string) => {
    await endpoints.notifications.markRead(id).catch(() => undefined);
    refresh();
  };

  const groups: { label: string; items: any[] }[] = [];
  for (const n of list) {
    const label = formatDayGroup(n.createdAt);
    const g = groups.find((x) => x.label === label);
    if (g) g.items.push(n);
    else groups.push({ label, items: [n] });
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageTitle
        eyebrow="Notifications"
        title="What’s new"
        body={unread ? `${unread} unread` : "You’re all caught up."}
        actions={unread ? <Button variant="outline" size="sm" onClick={markAll}><CheckCheck /> Mark all read</Button> : null}
      />
      <div role="group" aria-label="Show" className="mb-5 flex gap-2">
        {[false, true].map((v) => (
          <button key={String(v)} type="button" aria-pressed={unreadOnly === v} onClick={() => setUnreadOnly(v)} className={cn("h-9 rounded-full border px-4 text-sm font-semibold", unreadOnly === v ? "border-ink bg-ink text-ink-foreground" : "border-border bg-card")}>
            {v ? "Unread" : "All"}
          </button>
        ))}
      </div>

      {query.isLoading ? (
        <div className="space-y-2">{[0, 1, 2, 3].map((k) => <Skel key={k} className="h-20 rounded-2xl" />)}</div>
      ) : query.error ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : list.length === 0 ? (
        <EmptyState icon={<Bell />} title={unreadOnly ? "Nothing unread" : "No notifications yet"} body="Order and payment updates will appear here." />
      ) : (
        <div className="space-y-6">
          {groups.map((g) => (
            <section key={g.label} aria-label={g.label}>
              <h2 className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">{g.label}</h2>
              <ul className="surface divide-y divide-dashed">
                {g.items.map((n) => {
                  const Icon = ICON[n.type] ?? Bell;
                  const orderId = n.payload?.order_id;
                  const body = (
                    <>
                      <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-xl", n.isRead ? "bg-sunk text-muted-foreground" : "bg-primary text-primary-foreground")}>
                        <Icon className="h-5 w-5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={cn("block", !n.isRead && "font-bold")}>{n.title}</span>
                        {n.body ? <span className="block text-sm text-muted-foreground">{n.body}</span> : null}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground" title={new Date(n.createdAt).toLocaleString("en-IN")}>{formatSince(n.createdAt)}</span>
                      {!n.isRead ? <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-destructive" aria-label="Unread" /> : null}
                    </>
                  );
                  return (
                    <li key={n.id}>
                      {orderId ? (
                        <Link to="/orders/$orderId" params={{ orderId }} onClick={() => !n.isRead && markOne(n.id)} className="flex items-center gap-3 px-4 py-3 hover:bg-accent/50">
                          {body}
                        </Link>
                      ) : (
                        <button type="button" onClick={() => !n.isRead && markOne(n.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-accent/50">
                          {body}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
