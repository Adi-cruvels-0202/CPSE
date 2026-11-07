import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { endpoints } from "@/lib/cpse/endpoints";
import { readActiveStore } from "@/lib/cpse/activeStore";
import { readSelectedCity } from "@/lib/cpse/cityPreference";
import { useAuth } from "./auth";

/** Unwraps the CPSE `{ data, meta }` envelope for TanStack Query. */
export function cpse<T = any>(call: () => Promise<{ data: any; meta: any }>) {
  return async (): Promise<T> => {
    const result = await call();
    return (result.meta ? { ...result.data, meta: result.meta } : result.data) as T;
  };
}

export function useDebounced<T>(value: T, delay = 150) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/** The city the customer picked; follows changes made anywhere in the app. */
export function useSelectedCity() {
  const [city, setCity] = useState("");
  useEffect(() => {
    const sync = () => setCity(readSelectedCity());
    sync();
    window.addEventListener("cpse:city-changed", sync);
    return () => window.removeEventListener("cpse:city-changed", sync);
  }, []);
  return city;
}

/** The last shop the customer was in — which cart "Cart" means. */
export function useActiveStore() {
  const [store, setStore] = useState<{ id: string; slug: string | null; name: string | null } | null>(null);
  useEffect(() => {
    const sync = () => setStore(readActiveStore());
    sync();
    window.addEventListener("cpse:active-store-changed", sync);
    return () => window.removeEventListener("cpse:active-store-changed", sync);
  }, []);
  return store;
}

/** The public shop directory, shared by header search, location and home. */
export function useDirectory() {
  return useQuery({
    queryKey: ["stores", "directory"],
    queryFn: cpse<{ stores: any[] }>(() => endpoints.stores.list({ limit: 50 })),
    staleTime: 60_000,
  });
}

/** One store's cart. Refreshes whenever any cart mutation fires `cpse:cart-updated`. */
export function useCart(storeId: string | null | undefined) {
  const { isSignedIn } = useAuth();
  return useQuery({
    queryKey: ["cart", storeId],
    queryFn: cpse<{ cart: any }>(() => endpoints.cart.get(storeId)),
    enabled: Boolean(isSignedIn && storeId),
  });
}

export function useCartCount(storeId: string | null | undefined) {
  const cart = useCart(storeId);
  const c = cart.data?.cart;
  return c?.totals?.totalQuantity ?? (c?.lines ?? []).reduce((sum: number, line: any) => sum + line.quantity, 0) ?? 0;
}

export function useUnreadCount() {
  const { isSignedIn } = useAuth();
  const query = useQuery({
    queryKey: ["notifications", "unread"],
    queryFn: cpse<{ unreadCount: number }>(() => endpoints.notifications.unreadCount()),
    enabled: isSignedIn,
    refetchInterval: 60_000,
  });
  return query.data?.unreadCount ?? 0;
}

export function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return reduced;
}
