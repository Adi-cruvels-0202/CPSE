import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, SearchX } from "lucide-react";
import { endpoints } from "@/lib/cpse/endpoints";
import { cpse } from "@/customer/hooks";
import { ProductTile, ProductTileSkeleton } from "@/customer/components/ProductTile";
import { EmptyState, ErrorState } from "@/components/cpse/States";

type Search = { q?: string };

export const Route = createFileRoute("/store/$slug/search")({
  validateSearch: (s: Record<string, unknown>): Search => ({ q: typeof s["q"] === "string" ? (s["q"] as string) : undefined }),
  head: () => ({
    meta: [
      { title: "Search this shop — CPSE" },
      { name: "description", content: "Search a neighbourhood shop's catalogue on CPSE." },
      { property: "og:title", content: "Search this shop — CPSE" },
      { property: "og:description", content: "Search a neighbourhood shop's catalogue." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: StoreSearchPage,
});

function StoreSearchPage() {
  const { slug } = Route.useParams();
  const { q = "" } = Route.useSearch();
  const query = q.trim();

  const store = useQuery({ queryKey: ["store", slug], queryFn: cpse<{ store: any }>(() => endpoints.stores.get(slug)) });
  const results = useQuery({
    queryKey: ["store-search-page", slug, query],
    queryFn: cpse<{ products: any[]; meta?: any }>(() => endpoints.stores.search(slug, { q: query, limit: 20 })),
    enabled: query.length >= 2,
  });

  const s = store.data?.store;
  const list = results.data?.products ?? [];

  return (
    <div>
      <Link to="/store/$slug" params={{ slug }} className="mb-4 inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to {s?.name ?? "the shop"}
      </Link>
      <h1 className="mb-1 text-3xl font-extrabold">{query ? <>Results for “{query}”</> : "Search this shop"}</h1>
      <p className="mb-6 text-muted-foreground" aria-live="polite">
        {query.length < 2
          ? "Type at least two letters in the search bar above."
          : results.isLoading
            ? "Searching…"
            : `${results.data?.meta?.total ?? list.length} found in ${s?.name ?? "this shop"}`}
      </p>

      {query.length < 2 ? null : results.isLoading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 5 }, (_, i) => <ProductTileSkeleton key={i} />)}
        </div>
      ) : results.error ? (
        <ErrorState error={results.error} onRetry={() => results.refetch()} />
      ) : list.length === 0 ? (
        <EmptyState icon={<SearchX />} title="Nothing matches" body="Try a shorter word, or check the spelling.">
          <Link to="/store/$slug" params={{ slug }} className="font-semibold underline">Browse the whole shop</Link>
        </EmptyState>
      ) : s ? (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {list.map((p: any) => (
            <li key={p.id}>
              <ProductTile product={p} store={s} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
