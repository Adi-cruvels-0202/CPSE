import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../hooks/useAuth';
import { useActiveStore } from '../../hooks/useStore';
import { dashboardApi } from '../../api/endpoints';
import Logo from '../brand/Logo';
import './MerchantLayout.css';

/**
 * The frame every merchant screen sits in — the customer app's frame
 * (frontend/customer/src/components/AppShell.jsx), so the two read as one
 * product: the same white header with the leaf on the left, the same row of
 * icon tabs under it on a wide screen, the same bar under the thumb on a phone.
 *
 * What differs is only what a shopkeeper needs up top: which of their stores
 * they are working on, and their account.
 */

interface Tab {
  to: string;
  label: string;
  icon: (props: { filled: boolean }) => ReactNode;
  /** Other paths that count as this tab, e.g. Categories under Products. */
  also?: string[];
}

const TABS: Tab[] = [
  { to: '/dashboard', label: 'Home', icon: HomeIcon },
  { to: '/orders', label: 'Orders', icon: ReceiptIcon },
  { to: '/products', label: 'Products', icon: BoxIcon, also: ['/categories'] },
  { to: '/inventory', label: 'Stock', icon: ClipboardIcon },
  { to: '/sales/new', label: 'Sell', icon: TillIcon, also: ['/sales'] },
  { to: '/store/setup', label: 'Store', icon: StoreIcon, also: ['/store'] },
];

export default function MerchantLayout() {
  const { pathname } = useLocation();
  const { activeStoreId } = useActiveStore();

  // New orders waiting, for the badge on Orders — the same query the
  // dashboard uses, so it costs nothing extra there.
  const { data } = useQuery({
    queryKey: ['dashboard', activeStoreId],
    queryFn: () => dashboardApi.get(activeStoreId!),
    enabled: !!activeStoreId,
    refetchInterval: 30_000,
  });
  const waiting = data?.dashboard.openOrders.placed ?? 0;

  const isActive = (tab: Tab) =>
    [tab.to, ...(tab.also ?? [])].some((path) => pathname === path || pathname.startsWith(`${path}/`));

  return (
    <div className="shell">
      <a className="shell__skip" href="#main">Skip to content</a>

      <header className="shell__header">
        <div className="shell__bar">
          <NavLink to="/dashboard" className="shell__brand" aria-label="CPSE for shops — home">
            <Logo size="md" />
          </NavLink>
          <div className="shell__actions">
            <StoreSwitcher />
            <AccountMenu />
          </div>
        </div>
      </header>

      <nav className="shell__tabs" aria-label="Main">
        <div className="shell__tabs-inner">
          {TABS.map((tab) => {
            const active = isActive(tab);
            const Icon = tab.icon;
            return (
              <NavLink key={tab.to} to={tab.to} className={`shell__tab${active ? ' shell__tab--active' : ''}`} aria-current={active ? 'page' : undefined}>
                <span className="shell__tab-icon">
                  <Icon filled={active} />
                  {tab.to === '/orders' && waiting > 0 && (
                    <span className="shell__badge" aria-label={`${waiting} new`}>{waiting > 9 ? '9+' : waiting}</span>
                  )}
                </span>
                <span className="shell__tab-label">{tab.label}</span>
              </NavLink>
            );
          })}
        </div>
      </nav>

      <main className="shell__main" id="main" tabIndex={-1}>
        <div className="shell__content">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

/** Closes a header menu on a click outside it, on Escape, and on navigating. */
function useMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return undefined;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !ref.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  return { open, setOpen, ref };
}

/** Which store every screen is working on; a merchant may run several. */
function StoreSwitcher() {
  const { stores } = useAuth();
  const { activeStoreId, setActiveStoreId } = useActiveStore();
  const navigate = useNavigate();
  const { open, setOpen, ref } = useMenu();
  const current = stores.find((store) => store.id === activeStoreId);

  if (stores.length === 0) return null;

  const choose = (id: string) => {
    setOpen(false);
    if (id !== activeStoreId) setActiveStoreId(id);
    navigate('/dashboard');
  };

  return (
    <div className="shell__store-wrap" ref={ref}>
      <button type="button" className="shell__store" onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="menu" aria-label={`Store: ${current?.name ?? 'choose a store'}`}>
        <StoreDot live={current?.isPublished} />
        <span className="shell__store-name">{current?.name ?? 'Choose a store'}</span>
        <svg className="shell__store-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {open && (
        <div className="shell__menu shell__menu--stores" role="menu" aria-label="Your stores">
          <div className="shell__menu-label">Your stores</div>
          {stores.map((store) => {
            const active = store.id === activeStoreId;
            return (
              <button key={store.id} role="menuitemradio" aria-checked={active} type="button" className={`shell__menu-item shell__store-option${active ? ' shell__store-option--active' : ''}`} onClick={() => choose(store.id)}>
                <StoreDot live={store.isPublished} />
                <span className="shell__store-option-name">{store.name}</span>
                <span className="shell__store-option-state">{store.isPublished ? 'Live' : 'Draft'}</span>
              </button>
            );
          })}
          <div className="shell__menu-divider" role="separator" />
          <NavLink role="menuitem" className="shell__menu-item shell__menu-item--accent" to="/store/new">+ New store</NavLink>
        </div>
      )}
    </div>
  );
}

function StoreDot({ live }: { live?: boolean }) {
  return <span className={`shell__store-dot${live ? ' shell__store-dot--live' : ''}`} title={live ? 'Published' : 'Not published'} aria-hidden="true" />;
}

function AccountMenu() {
  const { merchant, stores, logout } = useAuth();
  const { activeStoreId } = useActiveStore();
  const navigate = useNavigate();
  const { open, setOpen, ref } = useMenu();
  const current = stores.find((store) => store.id === activeStoreId);
  const name = merchant?.fullName || merchant?.email || 'Merchant';
  const initials = name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();

  return (
    <div className="shell__account" ref={ref}>
      <button type="button" className="shell__avatar" onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="menu" aria-label={`Account: ${name}`}>
        {initials}
      </button>
      {open && (
        <div className="shell__menu" role="menu">
          <div className="shell__menu-head">
            <strong>{name}</strong>
            <span>{merchant?.email}</span>
          </div>
          {current?.isPublished && (
            <a role="menuitem" className="shell__menu-item" href={`/store/${current.slug}`} target="_blank" rel="noopener noreferrer">View my store as a customer ↗</a>
          )}
          <NavLink role="menuitem" className="shell__menu-item" to="/categories">Categories</NavLink>
          <NavLink role="menuitem" className="shell__menu-item" to="/inventory/history">Stock history</NavLink>
          <NavLink role="menuitem" className="shell__menu-item" to="/sales">Counter sales history</NavLink>
          <NavLink role="menuitem" className="shell__menu-item" to="/account">Account settings</NavLink>
          <div className="shell__menu-divider" role="separator" />
          <button role="menuitem" type="button" className="shell__menu-item shell__menu-item--danger" onClick={async () => { await logout(); navigate('/login'); }}>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

/* ── Icons — the customer app's line style: 24-unit grid, 1.8 stroke ─────── */

const iconProps = {
  width: 22,
  height: 22,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  focusable: false,
};

const fillFor = (filled: boolean) => ({ fill: filled ? 'currentColor' : 'none', fillOpacity: filled ? 0.12 : 0 });

function HomeIcon({ filled }: { filled: boolean }) {
  return <svg {...iconProps} {...fillFor(filled)}><path d="M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1v-8Z" /></svg>;
}
function ReceiptIcon({ filled }: { filled: boolean }) {
  return <svg {...iconProps} {...fillFor(filled)}><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" /><path d="M9 8h6M9 12h6" /></svg>;
}
function BoxIcon({ filled }: { filled: boolean }) {
  return <svg {...iconProps} {...fillFor(filled)}><path d="M4 8l8-4 8 4v8l-8 4-8-4V8Z" /><path d="M4 8l8 4 8-4M12 12v8" /></svg>;
}
function ClipboardIcon({ filled }: { filled: boolean }) {
  return <svg {...iconProps} {...fillFor(filled)}><path d="M8 4h8v3H8zM6 5h2M16 5h2v15H6V5" /><path d="M9 11h6M9 15h4" /></svg>;
}
function TillIcon({ filled }: { filled: boolean }) {
  return <svg {...iconProps} {...fillFor(filled)}><path d="M4 10h16v10H4z" /><path d="M7 10V5h10v5M8 14h2M14 14h2M8 17h8" /></svg>;
}
function StoreIcon({ filled }: { filled: boolean }) {
  return <svg {...iconProps} {...fillFor(filled)}><path d="M4 9h16v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V9Z" /><path d="M3 9l1.6-4.2A1 1 0 0 1 5.5 4h13a1 1 0 0 1 .9.8L21 9" /><path d="M9 20v-5h6v5" /></svg>;
}
