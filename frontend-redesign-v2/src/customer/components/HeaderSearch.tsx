import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Search, X, Store as StoreIcon, CornerDownLeft, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { endpoints } from "@/lib/cpse/endpoints";
import { formatPaiseShort } from "@/lib/cpse/money";
import { describeStatus } from "@/lib/cpse/storeHours";
import { cpse, useDebounced, useDirectory, useSelectedCity } from "../hooks";
import { ShopAvatar } from "./ShopCard";

/** Bold the typed part of a suggestion, so the reader sees why it matched. */
function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return <>{text}</>;
  const i = text.toLocaleLowerCase().indexOf(q);
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark className="bg-primary-soft px-0.5 text-foreground">{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}

type Suggestion =
  | { kind: "shop"; id: string; store: any }
  | { kind: "product"; id: string; product: any }
  | { kind: "all"; id: string };

/**
 * Editable combobox (WAI-ARIA APG, list autocomplete with manual selection).
 * Outside a shop it suggests shops from the directory as you type; inside a
 * shop it suggests that shop's products from the store search endpoint.
 */
export function HeaderSearch({ store, className }: { store: { slug: string; name: string; id?: string } | null; className?: string }) {
  const navigate = useNavigate();
  const listId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const city = useSelectedCity();
  const directory = useDirectory();
  const debounced = useDebounced(query.trim(), 150);

  useEffect(() => {
    setQuery("");
    setOpen(false);
  }, [store?.slug]);

  const productSearch = useQuery({
    queryKey: ["store-search", store?.slug, debounced],
    queryFn: cpse<{ products: any[] }>(() => endpoints.stores.search(store!.slug, { q: debounced, limit: 6 })),
    enabled: Boolean(store && debounced.length >= 2),
    staleTime: 30_000,
  });

  const suggestions = useMemo<Suggestion[]>(() => {
    const q = query.trim().normalize("NFKC").toLocaleLowerCase();
    if (!q) return [];
    if (store) {
      if (q.length < 2) return [];
      const products = (productSearch.data?.products ?? []).slice(0, 6);
      return [
        ...products.map((product: any) => ({ kind: "product" as const, id: product.id, product })),
        { kind: "all" as const, id: "all" },
      ];
    }
    const terms = q.split(/\s+/).filter(Boolean);
    const shops = (directory.data?.stores ?? [])
      .filter((s: any) => {
        const name = String(s.name ?? "").normalize("NFKC").toLocaleLowerCase();
        return terms.every((t) => name.includes(t));
      })
      .sort((a: any, b: any) => Number(b.location?.city === city) - Number(a.location?.city === city))
      .slice(0, 8);
    return shops.map((s: any) => ({ kind: "shop" as const, id: s.id, store: s }));
  }, [query, store, productSearch.data, directory.data, city]);

  useEffect(() => setActive(0), [query]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const choose = (s: Suggestion | undefined) => {
    setOpen(false);
    if (!s) {
      if (store && query.trim()) navigate({ to: "/store/$slug/search", params: { slug: store.slug }, search: { q: query.trim() } });
      return;
    }
    if (s.kind === "shop") {
      setQuery("");
      navigate({ to: "/store/$slug", params: { slug: s.store.slug } });
    } else if (s.kind === "product" && store) {
      navigate({ to: "/store/$slug/product/$productId", params: { slug: store.slug, productId: s.product.id } });
    } else if (store) {
      navigate({ to: "/store/$slug/search", params: { slug: store.slug }, search: { q: query.trim() } });
    }
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, Math.max(suggestions.length - 1, 0)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(suggestions[active] ?? suggestions[0]);
    } else if (event.key === "Escape") {
      if (open) {
        event.preventDefault();
        setOpen(false);
      } else {
        setQuery("");
      }
    }
  };

  const trimmed = query.trim();
  const showPanel = open && trimmed.length > 0;
  const loading = store ? productSearch.isFetching || debounced !== trimmed : directory.isLoading;
  const activeId = showPanel && suggestions[active] ? `${listId}-${suggestions[active]!.id}` : undefined;

  return (
    <div ref={wrapRef} className={cn("relative", className)}>
      <label htmlFor={`${listId}-input`} className="sr-only">
        {store ? `Search ${store.name}` : "Search shops"}
      </label>
      <div
        className={cn(
          "flex h-12 items-center gap-2 rounded-full border border-border-strong/25 bg-card px-4 transition-colors focus-within:border-border-strong focus-within:bg-paper",
          showPanel && "border-border-strong",
        )}
      >
        <Search className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <input
          id={`${listId}-input`}
          ref={inputRef}
          role="combobox"
          aria-expanded={showPanel}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          autoComplete="off"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => trimmed && setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={store ? `Search in ${store.name}` : "Search shops near you"}
          className="h-full min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground"
        />
        {query ? (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              inputRef.current?.focus();
            }}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-accent"
            aria-label="Clear search"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      {showPanel ? (
        <div className="absolute inset-x-0 top-[calc(100%+6px)] z-[60] overflow-hidden rounded-2xl border border-border-strong/30 bg-popover shadow-pop animate-drop-in">
          <ul id={listId} role="listbox" aria-label={store ? "Products" : "Shops"} className="max-h-[60vh] overflow-y-auto p-1.5">
            {suggestions.map((s, index) => (
              <li
                key={s.id}
                id={`${listId}-${s.id}`}
                role="option"
                aria-selected={index === active}
                onPointerMove={() => setActive(index)}
                onClick={() => choose(s)}
                className={cn(
                  "flex min-h-12 cursor-pointer items-center gap-3 rounded-xl px-3 py-2",
                  index === active && "bg-accent",
                )}
              >
                {s.kind === "shop" ? (
                  <>
                    <ShopAvatar store={s.store} className="h-10 w-10 shrink-0 text-sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">
                        <Highlight text={s.store.name} query={trimmed} />
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {s.store.location?.city} · {describeStatus(s.store.hours).label}
                      </span>
                    </span>
                    {index === active ? <CornerDownLeft className="h-4 w-4 text-muted-foreground" aria-hidden="true" /> : null}
                  </>
                ) : s.kind === "product" ? (
                  <>
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-sunk text-xs font-bold text-muted-foreground">
                      {s.product.name.slice(0, 2).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-semibold">
                      <Highlight text={s.product.name} query={trimmed} />
                    </span>
                    <span className="numeric text-sm font-bold">{formatPaiseShort(s.product.pricePaise)}</span>
                  </>
                ) : (
                  <>
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary-soft">
                      <Search className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      See all results for <strong>“{trimmed}”</strong>
                    </span>
                  </>
                )}
              </li>
            ))}
          </ul>
          {suggestions.length === 0 || (store && suggestions.length === 1) ? (
            <div className="flex items-center gap-3 border-t px-4 py-3 text-sm text-muted-foreground" role="status">
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Searching…
                </>
              ) : store && trimmed.length < 2 ? (
                "Type at least 2 letters"
              ) : (
                <>
                  <StoreIcon className="h-4 w-4" />
                  {store ? `Nothing in ${store.name} matches “${trimmed}”.` : `No shop called “${trimmed}”. Try a shorter name.`}
                </>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
