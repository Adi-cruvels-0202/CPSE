import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useLocation,
  HeadContent,
  Scripts,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { AuthProvider } from "@/customer/auth";
import { CustomerShell } from "@/customer/components/CustomerShell";
import { Toaster } from "@/components/ui/sonner";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <p className="font-display text-8xl font-extrabold text-primary">404</p>
        <h1 className="mt-4 text-2xl font-bold">This aisle is empty</h1>
        <p className="mt-2 text-muted-foreground">The page you were looking for isn’t here or has moved.</p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex h-11 items-center justify-center rounded-full bg-ink px-6 font-semibold text-ink-foreground"
          >
            Back to shops
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-bold">This page didn’t load</h1>
        <p className="mt-2 text-muted-foreground">Something went wrong on our end. Try again, or head back to the shops.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex h-11 items-center justify-center rounded-full bg-primary px-6 font-semibold text-primary-foreground"
          >
            Try again
          </button>
          <a href="/v2/" className="inline-flex h-11 items-center justify-center rounded-full border border-border-strong px-6 font-semibold">
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { title: "CPSE — Shop your neighbourhood" },
      { name: "description", content: "Order from the neighbourhood shops around you — groceries, bakery, pharmacy and more, for pickup or delivery." },
      { name: "theme-color", content: "#F6F1E7" },
      { property: "og:title", content: "CPSE — Shop your neighbourhood" },
      { property: "og:description", content: "Order from the neighbourhood shops around you, for pickup or delivery." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700;12..96,800&family=Figtree:wght@400;500;600;700;800&display=swap",
      },
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/v2/favicon.svg?v=2", type: "image/svg+xml" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en-IN">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

/** Any cart write anywhere fires `cpse:cart-updated`; every cart view refreshes. */
function CartSync() {
  const queryClient = useQueryClient();
  useEffect(() => {
    const refresh = () => queryClient.invalidateQueries({ queryKey: ["cart"] });
    window.addEventListener("cpse:cart-updated", refresh);
    return () => window.removeEventListener("cpse:cart-updated", refresh);
  }, [queryClient]);
  return null;
}

function AppFrame({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  // The merchant app owns its own frame under /merchant; everything else is the shop.
  if (pathname === "/merchant" || pathname.startsWith("/merchant/")) return <>{children}</>;
  return <CustomerShell>{children}</CustomerShell>;
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <CartSync />
        <AppFrame>
          {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
          <Outlet />
        </AppFrame>
        <Toaster position="bottom-center" richColors closeButton />
      </AuthProvider>
    </QueryClientProvider>
  );
}
