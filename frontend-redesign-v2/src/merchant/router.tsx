import { forwardRef, useCallback, useEffect, useMemo, type AnchorHTMLAttributes, type MouseEvent } from "react";
import { useParams as useTanParams, useRouter, useRouterState } from "@tanstack/react-router";

/**
 * The merchant screens were written against react-router with
 * `basename="/merchant"`. This module gives them the same small surface
 * (Link, Navigate, useNavigate, useSearchParams, useParams, useLocation) on top
 * of the app's TanStack router, so their behaviour is preserved verbatim
 * while the URLs stay under /merchant.
 */
export const BASE = "/merchant";

export function toHref(to: string) {
  if (/^https?:\/\//.test(to)) return to;
  if (to === BASE || to.startsWith(`${BASE}/`) || to.startsWith(`${BASE}?`)) return to;
  return `${BASE}${to.startsWith("/") ? to : `/${to}`}`;
}

export function useNavigate() {
  const router = useRouter();
  return useCallback(
    (to: string | number, opts?: { replace?: boolean }) => {
      if (typeof to === "number") {
        router.history.go(to);
        return;
      }
      router.navigate({ href: toHref(to), replace: opts?.replace });
    },
    [router],
  );
}

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & { to: string; replace?: boolean };

export const Link = forwardRef<HTMLAnchorElement, LinkProps>(function Link({ to, replace, onClick, target, ...rest }, ref) {
  const router = useRouter();
  const href = toHref(to);
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || target === "_blank" || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    router.navigate({ href, replace });
  };
  return <a ref={ref} href={href} target={target} onClick={handle} {...rest} />;
});

export function Navigate({ to, replace }: { to: string; replace?: boolean }) {
  const navigate = useNavigate();
  useEffect(() => {
    navigate(to, { replace });
  }, [navigate, to, replace]);
  return null;
}

export function useLocation() {
  const loc = useRouterState({ select: (s) => s.location });
  const pathname = loc.pathname.startsWith(BASE) ? loc.pathname.slice(BASE.length) || "/" : loc.pathname;
  return { pathname, search: loc.searchStr, hash: loc.hash, state: loc.state };
}

export function useParams<T extends Record<string, string | undefined> = Record<string, string | undefined>>() {
  return (useTanParams as (opts: { strict: false }) => unknown)({ strict: false }) as T;
}

type ParamsInit = URLSearchParams | Record<string, string> | string;

export function useSearchParams(): [URLSearchParams, (next: ParamsInit | ((prev: URLSearchParams) => ParamsInit), opts?: { replace?: boolean }) => void] {
  const router = useRouter();
  const { pathname, searchStr } = useRouterState({ select: (s) => ({ pathname: s.location.pathname, searchStr: s.location.searchStr }) });
  const params = useMemo(() => new URLSearchParams(searchStr), [searchStr]);
  const set = useCallback(
    (next: ParamsInit | ((prev: URLSearchParams) => ParamsInit), opts?: { replace?: boolean }) => {
      const value = typeof next === "function" ? next(new URLSearchParams(router.state.location.searchStr)) : next;
      const qs = new URLSearchParams(value as any).toString();
      router.navigate({ href: `${pathname}${qs ? `?${qs}` : ""}`, replace: opts?.replace });
    },
    [router, pathname],
  );
  return [params, set];
}
