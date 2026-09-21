import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useUnreadCount } from '../hooks/useUnreadCount.js';
import './AppShell.css';

/**
 * The frame every screen sits in — checklist 11.1, and the unread badge from 11.14.
 *
 * Mobile-first, and on a desktop it stays a phone-width column: a grocery list
 * does not get better at 1400px, and one layout is one thing to get right.
 *
 * The bottom bar is where a thumb reaches. It is hidden on the public store
 * pages, which have to make sense to someone who followed a shared link and has
 * no account — offering them "Orders" and "Account" before they have either is
 * noise.
 */

const TABS = [
  { to: '/', label: 'Shop', icon: StoreIcon, end: true },
  { to: '/orders', label: 'Orders', icon: ReceiptIcon },
  { to: '/notifications', label: 'Alerts', icon: BellIcon, badge: true },
  { to: '/account', label: 'Account', icon: PersonIcon },
];

export function AppShell() {
  const { isSignedIn } = useAuth();
  const { pathname } = useLocation();
  const unread = useUnreadCount();

  // A shared store link is the one entry point that must work for a stranger.
  const isPublicStorePage = pathname.startsWith('/store/');
  const showTabs = isSignedIn && !isPublicStorePage;

  return (
    <div className="shell">
      <a className="shell__skip" href="#main">
        Skip to content
      </a>

      <header className="shell__header">
        <NavLink to="/" className="shell__brand">
          <LeafMark />
          <span>CPSE</span>
        </NavLink>
      </header>

      {/* The landmark a screen reader jumps to, and the anchor the skip link
          targets. tabIndex -1 so the link can actually move focus here. */}
      <main className="shell__main" id="main" tabIndex={-1}>
        <Outlet />
      </main>

      {showTabs ? (
        <nav className="shell__tabs" aria-label="Main">
          {TABS.map(({ to, label, icon: Icon, end, badge }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `shell__tab${isActive ? ' shell__tab--active' : ''}`
              }
            >
              {({ isActive }) => (
                <>
                  <Icon filled={isActive} />
                  {badge && unread > 0 ? (
                    <>
                      <span className="shell__tab-badge" aria-hidden="true">
                        {unread > 9 ? '9+' : unread}
                      </span>
                      {/* The number is in the link's own name, so a screen reader
                          hears "Alerts, 3 unread" rather than a bare digit. */}
                      <span className="sr-only">, {unread} unread</span>
                    </>
                  ) : null}
                  <span className="shell__tab-label">{label}</span>
                </>
              )}
            </NavLink>
          ))}
        </nav>
      ) : null}
    </div>
  );
}

/* ── Icons ─────────────────────────────────────────────────────────────────
   Inline SVG rather than an icon package: five icons is not worth a dependency
   and a request. aria-hidden throughout — each one sits next to a text label,
   so announcing it again would just repeat the word. */

const iconProps = {
  width: 22,
  height: 22,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: false,
};

function LeafMark() {
  return (
    <svg {...iconProps} width={24} height={24} className="shell__mark">
      <path d="M20 4c0 8-5.5 13-13 13" />
      <path d="M7 17c0-6 5-10 13-13" />
      <path d="M4 20c1-2 2-3 3-3" />
    </svg>
  );
}

function StoreIcon({ filled }) {
  return (
    <svg {...iconProps} fill={filled ? 'currentColor' : 'none'} fillOpacity={filled ? 0.12 : 0}>
      <path d="M4 9h16v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V9Z" />
      <path d="M3 9l1.6-4.2A1 1 0 0 1 5.5 4h13a1 1 0 0 1 .9.8L21 9" />
      <path d="M9 20v-5h6v5" />
    </svg>
  );
}

function ReceiptIcon({ filled }) {
  return (
    <svg {...iconProps} fill={filled ? 'currentColor' : 'none'} fillOpacity={filled ? 0.12 : 0}>
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" />
      <path d="M9 8h6M9 12h6" />
    </svg>
  );
}

function BellIcon({ filled }) {
  return (
    <svg {...iconProps} fill={filled ? 'currentColor' : 'none'} fillOpacity={filled ? 0.12 : 0}>
      <path d="M12 4a5 5 0 0 1 5 5v4l2 3H5l2-3V9a5 5 0 0 1 5-5Z" />
      <path d="M10 19a2 2 0 0 0 4 0" />
    </svg>
  );
}

function PersonIcon({ filled }) {
  return (
    <svg {...iconProps} fill={filled ? 'currentColor' : 'none'} fillOpacity={filled ? 0.12 : 0}>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c0-3.3 3.1-5.5 7-5.5s7 2.2 7 5.5" />
    </svg>
  );
}
