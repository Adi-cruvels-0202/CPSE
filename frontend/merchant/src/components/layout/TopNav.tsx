import React, { useState, useRef, useEffect, useCallback } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { useActiveStore } from '../../hooks/useStore';
import Logo from '../brand/Logo';
import {
  IconDashboard, IconStore, IconClock, IconTruck, IconCreditCard, IconGlobe,
  IconPackage, IconTag, IconClipboard, IconCalendar, IconHistory,
  IconTrendingUp, IconPlus, IconChevronDown, IconImage, IconCart,
  IconLogOut, IconMenu, IconX, IconSettings, IconExternalLink,
} from '../icons/Icons';
import './TopNav.css';

interface NavItem {
  label: string;
  path: string;
  icon: React.ReactNode;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const navGroups: NavGroup[] = [
  {
    label: 'Store',
    items: [
      { label: 'Dashboard', path: '/dashboard', icon: <IconDashboard size={16} /> },
      { label: 'Store Setup', path: '/store/setup', icon: <IconStore size={16} /> },
      { label: 'Business Hours', path: '/store/hours', icon: <IconClock size={16} /> },
      { label: 'Holidays', path: '/store/holidays', icon: <IconCalendar size={16} /> },
      { label: 'Delivery', path: '/store/delivery', icon: <IconTruck size={16} /> },
      { label: 'Payments', path: '/store/payments', icon: <IconCreditCard size={16} /> },
      { label: 'Logo & Cover', path: '/store/branding', icon: <IconImage size={16} /> },
    ],
  },
  {
    label: 'Catalogue',
    items: [
      { label: 'Products', path: '/products', icon: <IconPackage size={16} /> },
      { label: 'Categories', path: '/categories', icon: <IconTag size={16} /> },
    ],
  },
  {
    label: 'Inventory',
    items: [
      { label: 'Stock', path: '/inventory', icon: <IconClipboard size={16} /> },
      { label: 'History', path: '/inventory/history', icon: <IconHistory size={16} /> },
    ],
  },
  {
    label: 'Sales',
    items: [
      { label: 'Online Orders', path: '/orders', icon: <IconCart size={16} /> },
      { label: 'New Counter Sale', path: '/sales/new', icon: <IconPlus size={16} /> },
      { label: 'Sales History', path: '/sales', icon: <IconTrendingUp size={16} /> },
    ],
  },
];

export default function TopNav() {
  const { merchant, stores, logout } = useAuth();
  const displayName = merchant?.fullName || merchant?.email || 'Merchant';
  const { activeStoreId, setActiveStoreId } = useActiveStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const dropdownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navRef = useRef<HTMLElement>(null);

  const currentStore = stores.find((s) => s.id === activeStoreId);

  // Close dropdowns on route change
  useEffect(() => {
    setOpenDropdown(null);
    setUserMenuOpen(false);
    setMobileOpen(false);
  }, [location.pathname]);

  // Close on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (navRef.current && !navRef.current.contains(e.target as Node)) {
        setOpenDropdown(null);
        setUserMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpenDropdown(null);
        setUserMenuOpen(false);
        setMobileOpen(false);
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, []);

  const handleDropdownEnter = useCallback((label: string) => {
    if (dropdownTimerRef.current) clearTimeout(dropdownTimerRef.current);
    setOpenDropdown(label);
  }, []);

  const handleDropdownLeave = useCallback(() => {
    dropdownTimerRef.current = setTimeout(() => setOpenDropdown(null), 150);
  }, []);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const isGroupActive = (group: NavGroup) => {
    return group.items.some(item => location.pathname === item.path || location.pathname.startsWith(item.path + '/'));
  };

  return (
    <>
      <nav className="topnav glass-topnav" ref={navRef} role="navigation" aria-label="Main navigation">
        {/* LEFT: User / Store identity */}
        <div className="topnav-left">
          <div className="topnav-user-area" style={{ position: 'relative' }}>
            <button
              className="topnav-user-trigger"
              onClick={() => setUserMenuOpen(!userMenuOpen)}
              aria-expanded={userMenuOpen}
              aria-haspopup="true"
            >
              <div className="topnav-avatar">
                {displayName.charAt(0).toUpperCase()}
              </div>
              <div className="topnav-user-info">
                <span className="topnav-user-name">{displayName}</span>
                {currentStore && <span className="topnav-store-name">{currentStore.name}</span>}
              </div>
              <IconChevronDown size={14} />
            </button>

            {userMenuOpen && (
              <div className="topnav-user-menu glass-dropdown" role="menu">
                <div className="topnav-user-menu-header">
                  <span className="topnav-user-menu-email" style={{ fontWeight: 'var(--font-medium)', color: 'var(--color-text)', fontSize: 'var(--text-sm)' }}>{displayName}</span>
                  <span className="topnav-user-menu-email">{merchant?.email}</span>
                </div>
                <div className="topnav-user-menu-divider" />
                
                <div style={{ padding: 'var(--space-1) var(--space-3)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--color-text-tertiary)', letterSpacing: '0.05em' }}>Your Stores</div>
                {stores.map((s) => (
                  <button 
                    key={s.id} 
                    className="dropdown-item"
                    onClick={() => { setActiveStoreId(s.id); setUserMenuOpen(false); navigate('/dashboard'); }}
                    style={{ justifyContent: 'space-between', backgroundColor: activeStoreId === s.id ? 'var(--navy-05)' : 'transparent', color: activeStoreId === s.id ? 'var(--navy)' : 'inherit' }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span className={`status-dot ${activeStoreId === s.id ? 'status-dot-success' : 'status-dot-neutral'}`} />
                      {s.name}
                    </div>
                    {activeStoreId === s.id && <span style={{ color: 'var(--color-success)', fontSize: '12px' }}>✓</span>}
                  </button>
                ))}
                
                <button className="dropdown-item" onClick={() => { navigate('/store/new'); setUserMenuOpen(false); }} style={{ color: 'var(--color-text-secondary)' }}>
                  <IconPlus size={15} />
                  Add New Store
                </button>
                
                <div className="topnav-user-menu-divider" />
                
                <button className="dropdown-item" onClick={() => { navigate('/store/setup'); setUserMenuOpen(false); }} role="menuitem">
                  <IconSettings size={15} />
                  Store Settings
                </button>
                {currentStore?.isPublished && (
                  <a className="dropdown-item" href={`/store/${currentStore.slug}`} target="_blank" rel="noopener noreferrer" role="menuitem">
                    <IconGlobe size={15} />
                    View my store
                    <IconExternalLink size={12} />
                  </a>
                )}
                <a className="dropdown-item" href="/" role="menuitem">
                  <IconCart size={15} />
                  Go shopping (customer app)
                </a>
                <button className="dropdown-item dropdown-item-danger" onClick={handleLogout} role="menuitem">
                  <IconLogOut size={15} />
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>

        {/* CENTER: Logo */}
        <div className="topnav-center">
          <NavLink to="/dashboard" className="topnav-logo-link" aria-label="CPSE for shops — home">
            <Logo size="md" />
          </NavLink>
        </div>

        {/* RIGHT: Navigation groups */}
        <div className="topnav-right">
          {navGroups.map((group) => (
            <div
              key={group.label}
              className="topnav-group"
              onMouseEnter={() => handleDropdownEnter(group.label)}
              onMouseLeave={handleDropdownLeave}
            >
              <button
                className={`topnav-group-trigger ${isGroupActive(group) ? 'topnav-group-active' : ''}`}
                onClick={() => setOpenDropdown(openDropdown === group.label ? null : group.label)}
                aria-expanded={openDropdown === group.label}
                aria-haspopup="true"
              >
                {group.label}
                <IconChevronDown size={13} />
              </button>

              {openDropdown === group.label && (
                <div
                  className="topnav-dropdown glass-dropdown"
                  onMouseEnter={() => handleDropdownEnter(group.label)}
                  onMouseLeave={handleDropdownLeave}
                  role="menu"
                >
                  {group.items.map((item) => (
                    <NavLink
                      key={item.path}
                      to={item.path}
                      className={({ isActive }) => `topnav-dropdown-item ${isActive ? 'topnav-dropdown-item-active' : ''}`}
                      role="menuitem"
                    >
                      <span className="topnav-dropdown-icon">{item.icon}</span>
                      {item.label}
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Mobile hamburger */}
        <button className="topnav-mobile-toggle" onClick={() => setMobileOpen(!mobileOpen)} aria-label="Toggle menu">
          {mobileOpen ? <IconX size={22} /> : <IconMenu size={22} />}
        </button>
      </nav>

      {/* Mobile drawer */}
      {mobileOpen && (
        <>
          <div className="topnav-mobile-overlay" onClick={() => setMobileOpen(false)} />
          <div className="topnav-mobile-drawer">
            <div className="topnav-mobile-header">
              <Logo size="md" />
              <button className="btn btn-ghost btn-sm" onClick={() => setMobileOpen(false)} aria-label="Close menu">
                <IconX size={20} />
              </button>
            </div>

            {currentStore && (
              <div className="topnav-mobile-store">
                <span className={`status-dot ${activeStoreId === currentStore.id ? 'status-dot-success' : 'status-dot-neutral'}`} />
                {currentStore.name}
              </div>
            )}

            <nav className="topnav-mobile-nav">
              {navGroups.map((group) => (
                <div key={group.label} className="topnav-mobile-group">
                  <span className="topnav-mobile-group-title">{group.label}</span>
                  {group.items.map((item) => (
                    <NavLink
                      key={item.path}
                      to={item.path}
                      className={({ isActive }) => `topnav-mobile-link ${isActive ? 'topnav-mobile-link-active' : ''}`}
                      onClick={() => setMobileOpen(false)}
                    >
                      <span className="topnav-mobile-icon">{item.icon}</span>
                      {item.label}
                    </NavLink>
                  ))}
                </div>
              ))}
            </nav>

            <div className="topnav-mobile-footer">
              <div className="topnav-mobile-user">
                <div className="topnav-avatar">{displayName.charAt(0).toUpperCase()}</div>
                <div>
                  <div style={{ fontWeight: 'var(--font-medium)', fontSize: 'var(--text-sm)' }}>{displayName}</div>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)' }}>{merchant?.email}</div>
                </div>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={handleLogout} style={{ color: 'var(--color-danger)', width: '100%', justifyContent: 'flex-start', gap: 'var(--space-2)' }}>
                <IconLogOut size={16} />
                Sign out
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
