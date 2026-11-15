import { Children, isValidElement, useCallback, useEffect, type MouseEvent, type ReactElement, type ReactNode } from "react";
import { useRouter, useRouterState } from "@tanstack/react-router";

/**
 * The admin console was written against react-router (NavLink, Routes,
 * Route, Navigate, useNavigate). This gives it the same small surface on top
 * of V2's TanStack router, so the console's screens are the original ones,
 * unchanged. Every address the console uses is absolute (`/admin/...`).
 */

export const BASE = "/admin";

export function useNavigate() {
  const router = useRouter();
  return useCallback((to: string, opts?: { replace?: boolean }) => router.navigate({ href: to, replace: opts?.replace }), [router]);
}

function usePathname() {
  return useRouterState({ select: (s) => s.location.pathname });
}

export function Navigate({ to, replace }: { to: string; replace?: boolean }) {
  const navigate = useNavigate();
  useEffect(() => {
    navigate(to, { replace });
  }, [navigate, to, replace]);
  return null;
}

type NavLinkProps = {
  to: string;
  className?: string | ((state: { isActive: boolean }) => string);
  children?: ReactNode;
  "aria-label"?: string;
};

export function NavLink({ to, className, children, ...rest }: NavLinkProps) {
  const router = useRouter();
  const pathname = usePathname();
  const isActive = pathname === to || pathname.startsWith(`${to}/`);
  const href = router.buildLocation({ to: to as never }).href;
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    router.navigate({ href: to });
  };
  return (
    <a href={href} onClick={onClick} aria-current={isActive ? "page" : undefined} className={typeof className === "function" ? className({ isActive }) : className} {...rest}>
      {children}
    </a>
  );
}

export function Route(_props: { path: string; element: ReactNode }) {
  return null;
}

/** Renders the first <Route> whose path is the current section under /admin ("*" matches anything). */
export function Routes({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const section = pathname.startsWith(`${BASE}/`) ? pathname.slice(BASE.length + 1).split("/")[0] : "";
  const routes = Children.toArray(children).filter(isValidElement) as ReactElement<{ path: string; element: ReactNode }>[];
  const match = routes.find((r) => r.props.path === section) ?? routes.find((r) => r.props.path === "*");
  return <>{match?.props.element ?? null}</>;
}
