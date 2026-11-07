import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Heart } from "lucide-react";
import { endpoints } from "@/lib/cpse/endpoints";
import { RequireAuth } from "@/customer/RequireAuth";
import { cpse } from "@/customer/hooks";
import { ShopCard, ShopCardSkeleton } from "@/customer/components/ShopCard";
import { EmptyState, ErrorState, PageTitle } from "@/components/cpse/States";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/saved")({
  head: () => ({
    meta: [
      { title: "Favourite shops — CPSE" },
      { name: "description", content: "The neighbourhood shops you’ve saved on CPSE." },
      { property: "og:title", content: "Favourite shops — CPSE" },
      { property: "og:description", content: "The neighbourhood shops you’ve saved." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <RequireAuth>
      <SavedPage />
    </RequireAuth>
  ),
});

function SavedPage() {
  const query = useQuery({
    queryKey: ["saved-stores", "page"],
    queryFn: cpse<{ savedStores: any[] }>(() => endpoints.savedStores.list({ limit: 100 })),
  });
  const list = (query.data?.savedStores ?? []).filter((e: any) => e?.store);

  return (
    <div>
      <PageTitle eyebrow="Favourites" title="Shops you love" body="Tap the heart on any shop to keep it here." />
      {query.isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">{[0, 1, 2, 3].map((k) => <ShopCardSkeleton key={k} />)}</div>
      ) : query.error ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : list.length === 0 ? (
        <EmptyState icon={<Heart />} title="No favourites yet" body="Save the shops you order from often and they’ll be one tap away.">
          <Button asChild variant="ink"><Link to="/">Browse shops</Link></Button>
        </EmptyState>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {list.map((e: any) => (
            <li key={e.store.id}>
              <ShopCard store={e.store} saved />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
