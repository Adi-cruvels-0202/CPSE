import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Home,
  ReceiptText,
  Package,
  ClipboardList,
  Calculator,
  Store as StoreIcon,
  LayoutGrid,
  ChevronsUpDown,
  Check,
  ExternalLink,
  LogOut,
  History,
  Tags,
  UserRound,
  Receipt,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/cpse/Logo";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/merchant/hooks/useAuth";
import { useActiveStore } from "@/merchant/hooks/useStore";
import { dashboardApi } from "@/merchant/api/endpoints";
import { Link, useLocation, useNavigate } from "@/merchant/router";

const MORE_PATHS = [
  "/inbox", "/messages", "/refunds", "/purchases", "/batches", "/suggestions", "/catalogue-tools", "/customers",
  "/khata", "/promotions", "/announcements", "/analytics", "/automation", "/share", "/verification", "/insights", "/account",
];

type Tab = { to: string; label: string; icon: typeof Home; also?: string[]; mobile?: boolean };

const TABS: Tab[] = [
  { to: "/dashboard", label: "Home", icon: Home, mobile: true },
  { to: "/orders", label: "Orders", icon: ReceiptText, mobile: true },
  { to: "/sales/new", label: "Sell", icon: Calculator, also: ["/sales"], mobile: true },
  { to: "/products", label: "Products", icon: Package, also: ["/categories"] },
  { to: "/inventory", label: "Stock", icon: ClipboardList, mobile: true },
  { to: "/store/setup", label: "Store", icon: StoreIcon, also: ["/store"] },
  { to: "/more", label: "More", icon: LayoutGrid, also: MORE_PATHS, mobile: true },
];

function useWaiting() {
  const { activeStoreId } = useActiveStore();
  const { data } = useQuery({
    queryKey: ["dashboard", activeStoreId],
    queryFn: () => dashboardApi.get(activeStoreId!),
    enabled: !!activeStoreId,
    refetchInterval: 30_000,
  });
  return data?.dashboard.openOrders.placed ?? 0;
}

export function MerchantShell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const waiting = useWaiting();
  const isActive = (tab: Tab) =>
    [tab.to, ...(tab.also ?? [])].some((p) => pathname === p || pathname.startsWith(`${p}/`)) ||
    (tab.to === "/products" && pathname === "/products");
  // "/sales/new" and "/sales" both belong to Sell; "/store/*" to Store.
  const activeTab = TABS.find((t) => isActive(t));

  return (
    <div className="min-h-screen bg-background lg:grid lg:grid-cols-[16rem_minmax(0,1fr)]">
      <a href="#m-main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-ink focus:px-4 focus:py-2 focus:text-ink-foreground">
        Skip to content
      </a>

      {/* Desktop: ink sidebar */}
      <aside className="sticky top-0 hidden h-screen flex-col bg-sidebar text-sidebar-foreground lg:flex">
        <div className="px-5 pb-4 pt-5">
          <Link to="/dashboard" aria-label="CPSE for shops — home">
            <Logo tone="ink" suffix="Shops" />
          </Link>
        </div>
        <div className="px-3">
          <StoreSwitcher tone="ink" />
        </div>
        <nav aria-label="Main" className="mt-4 flex-1 overflow-y-auto px-3">
          <ul className="space-y-0.5">
            {TABS.map((tab) => {
              const active = activeTab?.to === tab.to;
              const Icon = tab.icon;
              return (
                <li key={tab.to}>
                  <Link
                    to={tab.to}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "group flex h-11 items-center gap-3 rounded-xl px-3 text-[0.95rem] font-semibold transition-colors",
                      active ? "bg-sidebar-primary text-sidebar-primary-foreground" : "text-ink-muted hover:bg-sidebar-accent hover:text-sidebar-foreground",
                    )}
                  >
                    <Icon className="h-5 w-5" aria-hidden="true" />
                    <span className="flex-1">{tab.label}</span>
                    {tab.to === "/orders" && waiting > 0 ? (
                      <span className={cn("numeric grid h-6 min-w-6 place-items-center rounded-full px-1.5 text-xs font-bold", active ? "bg-ink text-ink-foreground" : "bg-primary text-primary-foreground")} aria-label={`${waiting} new`}>
                        {waiting > 9 ? "9+" : waiting}
                      </span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="border-t border-sidebar-border p-3">
          <AccountMenu tone="ink" />
        </div>
      </aside>

      <div className="flex min-h-screen min-w-0 flex-col">
        {/* Mobile / tablet top bar */}
        <header className="sticky top-0 z-30 flex h-15 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur lg:hidden">
          <Link to="/dashboard" aria-label="CPSE for shops — home" className="shrink-0">
            <Logo size="sm" />
          </Link>
          <div className="min-w-0 flex-1">
            <StoreSwitcher tone="paper" />
          </div>
          <AccountMenu tone="paper" compact />
        </header>

        <main id="m-main" tabIndex={-1} className="flex-1 px-4 pb-28 pt-5 outline-none sm:px-6 lg:px-10 lg:pb-12 lg:pt-8">
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>

        {/* Mobile bottom tabs */}
        <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 border-t bg-card shadow-bar pb-[env(safe-area-inset-bottom)] lg:hidden">
          <ul className="mx-auto grid max-w-xl grid-cols-5">
            {TABS.filter((t) => t.mobile).map((tab) => {
              const active = activeTab?.to === tab.to || (tab.to === "/more" && (activeTab?.to === "/products" || activeTab?.to === "/store/setup"));
              const Icon = tab.icon;
              const sell = tab.to === "/sales/new";
              return (
                <li key={tab.to}>
                  <Link
                    to={tab.to}
                    aria-current={active ? "page" : undefined}
                    className={cn("relative flex h-16 flex-col items-center justify-center gap-0.5 text-[0.7rem] font-bold", active ? "text-foreground" : "text-muted-foreground")}
                  >
                    <span
                      className={cn(
                        "relative grid place-items-center rounded-full transition-colors",
                        sell ? "h-10 w-10 bg-primary text-primary-foreground" : "h-8 w-12",
                        active && !sell && "bg-primary-soft",
                      )}
                    >
                      <Icon className="h-5 w-5" aria-hidden="true" />
                      {tab.to === "/orders" && waiting > 0 ? (
                        <span className="numeric absolute -right-0.5 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-destructive px-1 text-[0.65rem] text-destructive-foreground" aria-label={`${waiting} new`}>
                          {waiting > 9 ? "9+" : waiting}
                        </span>
                      ) : null}
                    </span>
                    {tab.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </div>
  );
}

function StoreDot({ live }: { live?: boolean }) {
  return <span className={cn("h-2 w-2 shrink-0 rounded-full", live ? "bg-success" : "bg-muted-foreground")} aria-hidden="true" />;
}

function StoreSwitcher({ tone }: { tone: "ink" | "paper" }) {
  const { stores } = useAuth();
  const { activeStoreId, setActiveStoreId } = useActiveStore();
  const navigate = useNavigate();
  const current = stores.find((s) => s.id === activeStoreId);
  if (stores.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Store: ${current?.name ?? "choose a store"}`}
        className={cn(
          "flex h-11 w-full min-w-0 items-center gap-2.5 rounded-xl px-3 text-left text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring",
          tone === "ink" ? "bg-sidebar-accent text-sidebar-foreground hover:bg-ink-line" : "border bg-card hover:bg-accent",
        )}
      >
        <StoreDot live={current?.isPublished} />
        <span className="min-w-0 flex-1 truncate">{current?.name ?? "Choose a store"}</span>
        <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Your stores</DropdownMenuLabel>
        {stores.map((s) => (
          <DropdownMenuItem
            key={s.id}
            onSelect={() => {
              if (s.id !== activeStoreId) setActiveStoreId(s.id);
              navigate("/dashboard");
            }}
            className="gap-2.5"
          >
            <StoreDot live={s.isPublished} />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold">{s.name}</span>
              <span className="text-xs text-muted-foreground">{s.isPublished ? "Live" : "Not published"}</span>
            </span>
            {s.id === activeStoreId ? <Check className="h-4 w-4" /> : null}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate("/store/new")}>+ Add another store</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function AccountMenu({ tone, compact }: { tone: "ink" | "paper"; compact?: boolean }) {
  const { merchant, stores, logout } = useAuth();
  const { activeStoreId } = useActiveStore();
  const navigate = useNavigate();
  const current = stores.find((s) => s.id === activeStoreId);
  const name = merchant?.fullName || merchant?.email || "Merchant";
  const initials = name.split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Account: ${name}`}
        className={cn(
          "flex items-center gap-3 rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-ring",
          compact ? "h-10 w-10 justify-center" : "h-12 w-full px-2",
          tone === "ink" ? "hover:bg-sidebar-accent" : "hover:bg-accent",
        )}
      >
        <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-bold", tone === "ink" ? "bg-primary text-primary-foreground" : "bg-ink text-ink-foreground")}>{initials}</span>
        {!compact ? (
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">{name}</span>
            <span className={cn("block truncate text-xs", tone === "ink" ? "text-ink-muted" : "text-muted-foreground")}>{merchant?.email}</span>
          </span>
        ) : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side={compact ? "bottom" : "top"} className="w-64">
        <DropdownMenuLabel className="font-normal">
          <span className="block font-semibold">{name}</span>
          <span className="text-xs text-muted-foreground">{merchant?.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {current?.isPublished ? (
          <DropdownMenuItem asChild>
            <a href={`/v2/store/${current.slug}`} target="_blank" rel="noopener noreferrer">
              <ExternalLink /> View my store as a customer
            </a>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem onSelect={() => navigate("/categories")}><Tags /> Categories</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => navigate("/inventory/history")}><History /> Stock history</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => navigate("/sales")}><Receipt /> Counter sales history</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => navigate("/account")}><UserRound /> Account settings</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          onSelect={async () => {
            await logout();
            navigate("/login");
          }}
        >
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
