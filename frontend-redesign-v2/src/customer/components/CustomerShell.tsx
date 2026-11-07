import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  ShoppingBasket,
  UserRound,
  Home,
  Heart,
  ReceiptText,
  LogOut,
  MapPinned,
  Bell,
  BookOpenText,
  WifiOff,
  Store as StoreIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { endpoints } from "@/lib/cpse/endpoints";
import { useAuth } from "../auth";
import { cpse, useActiveStore, useCartCount, useUnreadCount } from "../hooks";
import { HeaderSearch } from "./HeaderSearch";
import { LocationPicker } from "./LocationPicker";
import { Logo } from "@/components/cpse/Logo";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function useOnline() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);
  return online;
}

/** The customer app frame: sticky header (brand, city, search, account, cart), mobile tab bar, footer. */
export function CustomerShell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const { isSignedIn } = useAuth();
  const online = useOnline();
  const activeStore = useActiveStore();

  const routeSlug = pathname.match(/^\/store\/([^/]+)/)?.[1] ?? null;
  const routeStoreId = pathname.match(/^\/(?:cart|checkout)\/([^/]+)/)?.[1] ?? null;
  const storeQuery = useQuery({
    queryKey: ["store", routeSlug],
    queryFn: cpse<{ store: any }>(() => endpoints.stores.get(routeSlug)),
    enabled: Boolean(routeSlug),
  });
  const searchStore = routeSlug
    ? { slug: routeSlug, name: storeQuery.data?.store?.name ?? "this shop", id: storeQuery.data?.store?.id }
    : null;

  const cartStoreId = routeStoreId ?? (routeSlug ? storeQuery.data?.store?.id : null) ?? activeStore?.id ?? null;
  const cartCount = useCartCount(cartStoreId);
  const focusFlow = /^\/(checkout|payment|mock-payment)/.test(pathname);
  const authFlow = /^\/(login|register|forgot-password|reset-password)/.test(pathname);

  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-full focus:bg-ink focus:px-4 focus:py-2 focus:text-ink-foreground">
        Skip to content
      </a>
      {!online ? (
        <p role="status" className="flex items-center justify-center gap-2 bg-ink px-4 py-2 text-sm text-ink-foreground">
          <WifiOff className="h-4 w-4" /> You are offline. Anything you do now may not go through.
        </p>
      ) : null}

      <header className="sticky top-0 z-40 border-b border-border-strong/15 bg-background/92 backdrop-blur-md">
        <div className="mx-auto grid max-w-7xl grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-4 py-3 md:grid-cols-[auto_auto_minmax(0,1fr)_auto] md:gap-x-5 lg:px-6">
          <Link to="/" className="col-start-1 row-start-1 flex shrink-0 items-center" aria-label="CPSE home">
            <Logo />
          </Link>
          <div className="col-start-2 row-start-1 min-w-0">
            <LocationPicker compact={false} />
          </div>
          {!authFlow ? (
            <HeaderSearch store={searchStore} className="col-span-3 col-start-1 row-start-2 md:col-span-1 md:col-start-3 md:row-start-1" />
          ) : null}
          <div className="col-start-3 row-start-1 flex shrink-0 items-center justify-end gap-1.5 md:col-start-4">
            <AccountMenu />
            {!focusFlow ? (
              <Link
                to="/cart"
                className={cn(
                  "relative flex h-11 items-center gap-2 rounded-full px-3 font-bold transition-colors sm:px-4",
                  cartCount > 0 ? "bg-primary text-primary-foreground hover:bg-primary-strong hover:text-paper" : "border border-border-strong/25 bg-card hover:border-border-strong",
                )}
                aria-label={cartCount > 0 ? `Cart, ${cartCount} ${cartCount === 1 ? "item" : "items"}` : "Cart, empty"}
              >
                <ShoppingBasket className="h-5 w-5" aria-hidden="true" />
                <span className="hidden sm:inline">Cart</span>
                {cartCount > 0 ? (
                  <span key={cartCount} className="numeric grid h-6 min-w-6 place-items-center rounded-full bg-ink px-1.5 text-xs text-ink-foreground animate-tick" aria-hidden="true">
                    {cartCount}
                  </span>
                ) : null}
              </Link>
            ) : null}
          </div>
        </div>
      </header>

      <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 pb-28 pt-6 md:pb-16 lg:px-6">
        {children}
      </main>

      <footer className="hidden border-t border-border-strong/15 md:block">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-8 text-sm text-muted-foreground">
          <div className="flex items-center gap-3">
            <Logo size="sm" />
            <span>Your neighbourhood shops, online.</span>
          </div>
          <div className="flex items-center gap-5">
            <Link to="/saved" className="hover:text-foreground">Favourite shops</Link>
            <Link to="/orders" className="hover:text-foreground">Orders</Link>
            <a href="/v2/merchant/login" className="flex items-center gap-1.5 font-semibold text-foreground hover:underline">
              <StoreIcon className="h-4 w-4" /> Run a shop? Merchant sign in
            </a>
          </div>
        </div>
      </footer>

      {!focusFlow && !authFlow ? <MobileTabs signedIn={isSignedIn} /> : null}
    </div>
  );
}

function AccountMenu() {
  const { isSignedIn, customer, signOut } = useAuth();
  const unread = useUnreadCount();
  const navigate = useNavigate();
  const { href } = useLocation();

  if (!isSignedIn) {
    return (
      <Link
        to="/login"
        search={{ next: href }}
        className="flex h-11 items-center gap-2 rounded-full px-3 font-semibold hover:bg-accent"
      >
        <UserRound className="h-5 w-5" aria-hidden="true" />
        <span className="hidden sm:inline">Sign in</span>
        <span className="sr-only sm:hidden">Sign in</span>
      </Link>
    );
  }

  const first = customer?.fullName?.split(" ")[0] ?? "Account";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="relative flex h-11 items-center gap-2 rounded-full px-2 font-semibold hover:bg-accent sm:px-3" aria-label={`Account menu for ${first}${unread ? `, ${unread} unread notifications` : ""}`}>
        <span className="grid h-8 w-8 place-items-center rounded-full bg-ink font-display text-sm text-ink-foreground">
          {first.slice(0, 1).toUpperCase()}
        </span>
        <span className="hidden max-w-24 truncate lg:inline">{first}</span>
        {unread > 0 ? <span className="absolute right-1 top-1.5 h-2.5 w-2.5 rounded-full border-2 border-background bg-destructive" aria-hidden="true" /> : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="z-[70] w-60 rounded-2xl bg-popover p-1.5 shadow-pop">
        <DropdownMenuLabel className="px-3 py-2">
          <span className="block font-display text-base">{customer?.fullName ?? "Your account"}</span>
          <span className="block truncate text-xs font-normal text-muted-foreground">{customer?.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <MenuLink to="/orders" icon={<ReceiptText />} label="Orders" />
        <MenuLink to="/saved" icon={<Heart />} label="Favourite shops" />
        <MenuLink to="/notifications" icon={<Bell />} label="Notifications" badge={unread} />
        <MenuLink to="/khata" icon={<BookOpenText />} label="Khata" />
        <MenuLink to="/account/addresses" icon={<MapPinned />} label="Addresses" />
        <MenuLink to="/account" icon={<UserRound />} label="Account & preferences" />
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="min-h-10 rounded-xl px-3 text-destructive focus:text-destructive"
          onSelect={async () => {
            await signOut();
            navigate({ to: "/" });
          }}
        >
          <LogOut className="h-4 w-4" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MenuLink({ to, icon, label, badge }: { to: string; icon: ReactNode; label: string; badge?: number }) {
  return (
    <DropdownMenuItem asChild className="min-h-10 rounded-xl px-3 [&_svg]:h-4 [&_svg]:w-4">
      <Link to={to as any}>
        {icon}
        <span className="flex-1">{label}</span>
        {badge ? <span className="numeric rounded-full bg-destructive px-1.5 text-xs font-bold text-destructive-foreground">{badge}</span> : null}
      </Link>
    </DropdownMenuItem>
  );
}

function MobileTabs({ signedIn }: { signedIn: boolean }) {
  const { pathname } = useLocation();
  const tabs = [
    { to: "/", label: "Shops", icon: Home, match: (p: string) => p === "/" || p.startsWith("/store") },
    { to: "/saved", label: "Saved", icon: Heart, match: (p: string) => p.startsWith("/saved") },
    { to: "/orders", label: "Orders", icon: ReceiptText, match: (p: string) => p.startsWith("/orders") || p.startsWith("/payment") },
    { to: signedIn ? "/account" : "/login", label: signedIn ? "Account" : "Sign in", icon: UserRound, match: (p: string) => p.startsWith("/account") || p.startsWith("/login") },
  ];
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 border-t border-border-strong/15 bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
      <ul className="grid grid-cols-4">
        {tabs.map((tab) => {
          const active = tab.match(pathname);
          const Icon = tab.icon;
          return (
            <li key={tab.label}>
              <Link
                to={tab.to as any}
                aria-current={active ? "page" : undefined}
                className={cn("flex h-16 flex-col items-center justify-center gap-1 text-xs font-semibold", active ? "text-foreground" : "text-muted-foreground")}
              >
                <span className={cn("grid h-7 w-12 place-items-center rounded-full transition-colors", active && "bg-primary")}>
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
