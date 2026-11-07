import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, MapPinned, Plus, Star, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { endpoints } from "@/lib/cpse/endpoints";
import { RequireAuth } from "@/customer/RequireAuth";
import { cpse } from "@/customer/hooks";
import { AddressForm } from "@/customer/components/AddressForm";
import { EmptyState, ErrorState, PageTitle, Skel } from "@/components/cpse/States";
import { Stamp } from "@/components/cpse/Stamp";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/account/addresses")({
  head: () => ({
    meta: [
      { title: "Addresses — CPSE" },
      { name: "description", content: "Manage the delivery addresses on your CPSE account." },
      { property: "og:title", content: "Addresses — CPSE" },
      { property: "og:description", content: "Manage your delivery addresses." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <RequireAuth>
      <AddressesPage />
    </RequireAuth>
  ),
});

function AddressesPage() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["addresses"], queryFn: cpse<{ addresses: any[] }>(() => endpoints.addresses.list()) });
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const list = query.data?.addresses ?? [];
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["addresses"] });

  const act = async (fn: () => Promise<unknown>, msg: string) => {
    try {
      await fn();
      await refresh();
      toast.success(msg);
    } catch (e: any) {
      toast.error(e?.message ?? "That didn’t work.");
    }
  };

  return (
    <div className="mx-auto max-w-4xl">
      <Link to="/account" className="mb-4 inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Account
      </Link>
      <PageTitle
        eyebrow="Addresses"
        title="Where we deliver"
        actions={editing !== "new" ? <Button variant="ink" onClick={() => setEditing("new")}><Plus /> Add address</Button> : null}
      />

      {editing === "new" ? (
        <div className="surface mb-6 p-5 animate-rise-in">
          <h2 className="mb-4 text-lg font-bold">New address</h2>
          <AddressForm
            onCancel={() => setEditing(null)}
            onSubmit={async (payload) => {
              await endpoints.addresses.create(payload);
              await refresh();
              setEditing(null);
              toast.success("Address saved");
            }}
          />
        </div>
      ) : null}

      {query.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2">{[0, 1].map((k) => <Skel key={k} className="h-36 rounded-2xl" />)}</div>
      ) : query.error ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : list.length === 0 && editing !== "new" ? (
        <EmptyState icon={<MapPinned />} title="No saved addresses" body="Add one now, or at checkout when you choose delivery.">
          <Button variant="ink" onClick={() => setEditing("new")}><Plus /> Add address</Button>
        </EmptyState>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {list.map((a: any) =>
            editing === a.id ? (
              <li key={a.id} className="surface p-5 sm:col-span-2">
                <AddressForm
                  initial={a}
                  onCancel={() => setEditing(null)}
                  onSubmit={async (payload) => {
                    await endpoints.addresses.update(a.id, payload);
                    await refresh();
                    setEditing(null);
                    toast.success("Address updated");
                  }}
                />
              </li>
            ) : (
              <li key={a.id} className="surface flex flex-col p-5">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="font-bold">{a.label || a.recipientName}</span>
                  {a.isDefault ? <Stamp tone="done">Default</Stamp> : null}
                </div>
                <p className="text-sm">{a.recipientName} · {a.phone}</p>
                <p className="text-sm text-muted-foreground">{[a.line1, a.line2, a.landmark, a.city, a.state, a.postalCode].filter(Boolean).join(", ")}</p>
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {!a.isDefault ? <Button size="sm" variant="outline" onClick={() => act(() => endpoints.addresses.setDefault(a.id), "Default address updated")}><Star /> Make default</Button> : null}
                  <Button size="sm" variant="ghost" onClick={() => setEditing(a.id)}><Pencil /> Edit</Button>
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={() => window.confirm("Delete this address?") && act(() => endpoints.addresses.remove(a.id), "Address deleted")}><Trash2 /> Delete</Button>
                </div>
              </li>
            ),
          )}
        </ul>
      )}
    </div>
  );
}
