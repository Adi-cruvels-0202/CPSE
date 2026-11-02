import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useCartCount } from '../hooks/useCartCount.js';
import { useOnline } from '../hooks/useOnline.js';
import { useApiQuery } from '../hooks/useApiQuery.js';
import { endpoints } from '../lib/endpoints.js';
import { readActiveStore } from '../lib/activeStore.js';
import { readSelectedCity, saveSelectedCity } from '../lib/cityPreference.js';
import { NearbyOffers } from '../routes/NearbyOffers.jsx';
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

export function AppShell() {
  const { isSignedIn, customer } = useAuth();
  const location = useLocation();
  const { pathname } = location;
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const routeStoreId = pathname.match(/^\/(?:cart|checkout)\/([^/]+)/)?.[1] ?? null;
  const cartCount = useCartCount(routeStoreId);
  const online = useOnline();
  const activeStore = readActiveStore();
  const routeStoreSlug = pathname.match(/^\/store\/([^/]+)/)?.[1] ?? null;
  const storeSlug = routeStoreSlug ?? (pathname === '/' ? null : activeStore?.slug ?? null);
  const [searchQuery, setSearchQuery] = useState(() => searchParams.get('q') ?? searchParams.get('shopSearch') ?? '');
  const [selectedCity, setSelectedCity] = useState(readSelectedCity);
  const [locationOpen, setLocationOpen] = useState(false);
  const [offersOpen, setOffersOpen] = useState(false);
  const offersWrapRef = useRef(null);
  const offersButtonRef = useRef(null);
  const headerRef = useRef(null);
  const [primaryHeaderHeight, setPrimaryHeaderHeight] = useState(0);
  const [cityQuery, setCityQuery] = useState('');
  const locationWrapRef = useRef(null);
  const locationButtonRef = useRef(null);
  const citySearchRef = useRef(null);
  const searchWrapRef = useRef(null);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(0);
  const directory = useApiQuery(() => endpoints.stores.list({ limit: 50 }), []);
  const cities = [...new Set((directory.data?.stores ?? [])
    .map((store) => store.location?.city?.trim())
    .filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const filteredCities = cities.filter((city) => city.toLowerCase().includes(cityQuery.trim().toLowerCase()));
  const normalizedSearch = searchQuery.trim().toLocaleLowerCase();
  const searchTerms = normalizedSearch.split(/\s+/).filter(Boolean);
  const suggestions = normalizedSearch
    ? (directory.data?.stores ?? []).filter((store) => {
      const normalizedName = String(store.name ?? '').normalize('NFKC').toLocaleLowerCase();
      const nameMatches = searchTerms.every((term) => normalizedName.includes(term.normalize('NFKC')));
      return nameMatches;
    }).slice(0, 8)
    : [];
  const showShopSuggestions = !storeSlug && suggestionsOpen && normalizedSearch.length > 0;

  useEffect(() => {
    setSearchQuery(searchParams.get('q') ?? searchParams.get('shopSearch') ?? '');
  }, [searchParams]);

  useEffect(() => {
    setSuggestionsOpen(false);
  }, [pathname]);

  useEffect(() => {
    setOffersOpen(false);
  }, [pathname]);

  useLayoutEffect(() => {
    const header = headerRef.current;
    if (!header) return undefined;
    const updateHeight = () => setPrimaryHeaderHeight(header.getBoundingClientRect().height);
    updateHeight();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateHeight);
    observer?.observe(header);
    window.addEventListener('resize', updateHeight);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', updateHeight);
    };
  }, []);

  useEffect(() => {
    if (!locationOpen) return undefined;
    citySearchRef.current?.focus();
    const closeOnOutsideClick = (event) => {
      if (!locationWrapRef.current?.contains(event.target)) setLocationOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key !== 'Escape') return;
      setLocationOpen(false);
      locationButtonRef.current?.focus();
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [locationOpen]);

  useEffect(() => {
    if (!offersOpen) return undefined;
    const closeOnOutsideClick = (event) => {
      if (!offersWrapRef.current?.contains(event.target)) setOffersOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key !== 'Escape') return;
      setOffersOpen(false);
      offersButtonRef.current?.focus();
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [offersOpen]);

  useEffect(() => {
    if (!suggestionsOpen) return undefined;
    const closeOnOutsideClick = (event) => {
      if (!searchWrapRef.current?.contains(event.target)) setSuggestionsOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick);
  }, [suggestionsOpen]);

  const searchProducts = (event) => {
    event.preventDefault();
    const query = searchQuery.trim();
    if (!query) return;
    if (storeSlug) {
      navigate(`/store/${storeSlug}/search?q=${encodeURIComponent(query)}`);
      return;
    }
    const selected = suggestions[activeSuggestionIndex] ?? suggestions[0];
    if (selected) navigate(`/store/${selected.slug}`);
    else setSuggestionsOpen(true);
  };

  const chooseCity = (city) => {
    setSelectedCity(city);
    saveSelectedCity(city);
    setCityQuery('');
    locationButtonRef.current?.focus();
    setLocationOpen(false);
  };

  /**
   * The tabs are for a signed-in customer, everywhere — including inside a shop.
   *
   * They used to be hidden on store pages, on the reasoning that a stranger
   * following a shared link should not be offered Orders and Account. But a
   * *signed-in* customer who opens a shop lost their way out, which is worse: the
   * condition only ever needed to be "are you signed in".
   */
  const showTabs = isSignedIn || pathname === '/';
  const showOffers = pathname === '/';
  const isStandaloneFlow = pathname.startsWith('/store/')
    || pathname.startsWith('/checkout/')
    || pathname.startsWith('/payment/')
    || pathname === '/mock-payment'
    || pathname === '/login'
    || pathname === '/register'
    || pathname === '/forgot-password'
    || pathname === '/reset-password';
  const showBackButton = isSignedIn && pathname !== '/' && !isStandaloneFlow;

  return (
    <div className="shell">
      <a className="shell__skip" href="#main">
        Skip to content
      </a>

      {/* Checklist 11.16. A banner rather than a blocked screen: navigator.onLine
          is a hint — it reports true on a wifi network with no route out — so
          requests still go, and a real failure still surfaces per screen. What this
          adds is telling the customer whose fault it is before they tap. */}
      {online ? null : (
        <p className="shell__offline" role="status">
          You are offline. Anything you do now may not go through.
        </p>
      )}

      <header
        ref={headerRef}
        className={`shell__header${showShopSuggestions ? ' shell__header--search-open' : ''}${locationOpen ? ' shell__header--location-open' : ''}`}
      >
        <div className="shell__bar">
          <NavLink to="/" className="shell__brand">
            <span className="shell__brand-row"><LeafMark /><span>CPSE</span></span>
          </NavLink>

          <div className="shell__location-wrap" ref={locationWrapRef}>
            <button
              ref={locationButtonRef}
              type="button"
              className="shell__location"
              aria-expanded={locationOpen}
              aria-haspopup="dialog"
              aria-controls="shell-city-picker"
              onClick={() => setLocationOpen((open) => !open)}
            >
              <LocationIcon />
              <span className="shell__location-copy">
                <span className="shell__location-label">Delivery location</span>
                <strong>{selectedCity || 'Choose your city'}</strong>
              </span>
              <ChevronIcon />
            </button>
            {locationOpen ? (
              <div className="shell__city-picker" id="shell-city-picker" role="dialog" aria-label="Choose your city">
                <label htmlFor="shell-city-search">Search for a city</label>
                <input
                  ref={citySearchRef}
                  id="shell-city-search"
                  type="search"
                  value={cityQuery}
                  onChange={(event) => setCityQuery(event.target.value)}
                  placeholder="Enter city name"
                  autoComplete="off"
                />
                <div className="shell__city-options">
                  <button
                    type="button"
                    className={`shell__city-option${selectedCity ? '' : ' shell__city-option--selected'}`}
                    aria-pressed={!selectedCity}
                    onClick={() => chooseCity('')}
                  >
                    All cities
                  </button>
                  {filteredCities.map((city) => (
                    <button
                      type="button"
                      key={city}
                      className={`shell__city-option${selectedCity === city ? ' shell__city-option--selected' : ''}`}
                      aria-pressed={selectedCity === city}
                      onClick={() => chooseCity(city)}
                    >
                      {city}
                    </button>
                  ))}
                  {directory.loading ? <p className="shell__city-message">Loading cities…</p> : null}
                  {!directory.loading && filteredCities.length === 0 ? (
                    <p className="shell__city-message">No matching cities found.</p>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>

          <div className="shell__search-wrap" ref={searchWrapRef}>
            <form className="shell__search" role="search" onSubmit={searchProducts}>
              <SearchIcon />
              <label className="sr-only" htmlFor="shell-search">
                {storeSlug ? 'Search products in this shop' : 'Search shops by name'}
              </label>
              <input
                id="shell-search"
                type="search"
                value={searchQuery}
                onChange={(event) => {
                  setSearchQuery(event.target.value);
                  setActiveSuggestionIndex(0);
                  setSuggestionsOpen(true);
                }}
                onFocus={() => {
                  if (normalizedSearch) setSuggestionsOpen(true);
                }}
                onKeyDown={(event) => {
                  if (!showShopSuggestions || suggestions.length === 0) {
                    if (event.key === 'Escape') setSuggestionsOpen(false);
                    return;
                  }
                  if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    setActiveSuggestionIndex((index) => (index + 1) % suggestions.length);
                  } else if (event.key === 'ArrowUp') {
                    event.preventDefault();
                    setActiveSuggestionIndex((index) => (index - 1 + suggestions.length) % suggestions.length);
                  } else if (event.key === 'Escape') {
                    setSuggestionsOpen(false);
                  }
                }}
                placeholder={storeSlug ? `Search ${activeStore?.name ?? 'this shop'}` : 'Search shops nearby'}
                autoComplete="off"
                enterKeyHint="search"
                aria-autocomplete={storeSlug ? 'none' : 'list'}
                aria-expanded={showShopSuggestions}
                aria-controls={showShopSuggestions ? 'shell-shop-suggestions' : undefined}
                aria-activedescendant={showShopSuggestions && suggestions[activeSuggestionIndex]
                  ? `shop-suggestion-${suggestions[activeSuggestionIndex].id}`
                  : undefined}
              />
              {searchQuery ? (
                <button
                  type="button"
                  className="shell__search-clear"
                  onClick={() => {
                    setSearchQuery('');
                    setSuggestionsOpen(false);
                  }}
                  aria-label="Clear search"
                >
                  ×
                </button>
              ) : null}
            </form>

            {showShopSuggestions ? (
              <div className="shell__shop-suggestions" id="shell-shop-suggestions" role="listbox" aria-label="Matching shops">
                {directory.loading ? (
                  <p className="shell__suggestion-message">Searching shops…</p>
                ) : directory.error ? (
                  <p className="shell__suggestion-message" role="status">Shops could not be loaded. Try again in a moment.</p>
                ) : suggestions.length > 0 ? suggestions.map((store, index) => (
                  <button
                    type="button"
                    role="option"
                    id={`shop-suggestion-${store.id}`}
                    key={store.id}
                    aria-selected={index === activeSuggestionIndex}
                    className={`shell__shop-suggestion${index === activeSuggestionIndex ? ' shell__shop-suggestion--active' : ''}`}
                    onMouseEnter={() => setActiveSuggestionIndex(index)}
                    onClick={() => {
                      setSearchQuery('');
                      setSuggestionsOpen(false);
                      navigate(`/store/${store.slug}`);
                    }}
                  >
                    <span className="shell__suggestion-name">{store.name}</span>
                  </button>
                )) : (
                  <p className="shell__suggestion-message">No shops match “{searchQuery.trim()}”.</p>
                )}
              </div>
            ) : null}
          </div>

          <div className="shell__account-actions">
            {isSignedIn ? (
              <Link to="/saved" className="shell__favorites" aria-label="Favorite shops" title="Favorite shops">
                <HeartIcon />
              </Link>
            ) : null}

            {isSignedIn ? (
              <Link to="/account" className="shell__login">
                <PersonIcon />
                <span>Account</span>
              </Link>
            ) : (
              <Link to="/login" state={{ from: pathname }} className="shell__login">
                Sign in
              </Link>
            )}

            {isSignedIn ? (
              <Link
                to="/cart"
                className="shell__cart"
                aria-label={cartCount > 0 ? `My Cart, ${cartCount} ${cartCount === 1 ? 'item' : 'items'}` : 'My Cart'}
              >
                <CartIcon />
                <span>My Cart</span>
                {cartCount > 0 ? <span className="shell__header-cart-count" aria-hidden="true">{cartCount > 99 ? '99+' : cartCount}</span> : null}
              </Link>
            ) : (
              <button
                type="button"
                className="shell__cart shell__cart--disabled"
                disabled
                aria-label="My Cart. Sign in to enable your cart."
                title="Sign in to use your cart"
              >
                <CartIcon />
                <span>My Cart</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {showTabs ? (
        <nav className="shell__tabs" aria-label="Main" style={primaryHeaderHeight ? { '--shell-primary-header-height': `${primaryHeaderHeight}px` } : undefined}>
          <div className="shell__tabs-inner">
            {isSignedIn && pathname === '/' ? (
              <span className="shell__tabs-greeting">Hello, {customer?.fullName?.split(' ')[0] ?? 'there'}</span>
            ) : null}
            <div className="shell__tabs-categories" id="shell-tabs-categories" />
            {showOffers ? <div className="shell__offers-wrap" ref={offersWrapRef}>
              <button
                ref={offersButtonRef}
                type="button"
                className="shell__offers-trigger"
                aria-expanded={offersOpen}
                aria-controls="shell-offers-panel"
                onClick={() => setOffersOpen((open) => !open)}
              >
                <OffersIcon /><span>Offers</span>
              </button>
              {offersOpen ? (
                <div className="shell__offers-panel" id="shell-offers-panel">
                  <NearbyOffers />
                </div>
              ) : null}
            </div> : null}
          </div>
        </nav>
      ) : null}

      {/* The landmark a screen reader jumps to, and the anchor the skip link
          targets. tabIndex -1 so the link can actually move focus here. */}
      <main className="shell__main" id="main" tabIndex={-1}>
        <div className="shell__content">
          {showBackButton ? (
            <div className="shell__back-row">
              <button
                type="button"
                className="shell__back"
                onClick={() => {
                  if (window.history.state?.idx > 0) navigate(-1);
                  else navigate('/');
                }}
              >
                <span aria-hidden="true">‹</span> Back
              </button>
            </div>
          ) : null}
          <Outlet />
        </div>
      </main>
    </div>
  );
}

function LocationIcon() {
  return (
    <svg {...iconProps} width={20} height={20}>
      <path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" />
      <circle cx="12" cy="10" r="2.2" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg {...iconProps} width={16} height={16}>
      <path d="m7 9 5 5 5-5" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg {...iconProps} width={20} height={20}>
      <circle cx="10.8" cy="10.8" r="6.4" />
      <path d="m15.5 15.5 4.2 4.2" />
    </svg>
  );
}

function HeartIcon() {
  return (
    <svg {...iconProps}>
      <path d="M20.8 8.7c0 5.1-8.8 10.1-8.8 10.1S3.2 13.8 3.2 8.7A4.7 4.7 0 0 1 12 6.5a4.7 4.7 0 0 1 8.8 2.2Z" />
    </svg>
  );
}

/* ── Icons ─────────────────────────────────────────────────────────────────
   Inline SVG rather than an icon package: a handful of icons is not worth a dependency
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

function OffersIcon() {
  return (
    <svg {...iconProps}>
      <path d="M20 12v8H4v-8" />
      <path d="M2 7h20v5H2zM12 20V7" />
      <path d="M12 7H7.5a2.5 2.5 0 1 1 2.4-3.2C10.4 5.2 12 7 12 7Zm0 0h4.5a2.5 2.5 0 1 0-2.4-3.2C13.6 5.2 12 7 12 7Z" />
    </svg>
  );
}

function CartIcon({ filled }) {
  return (
    <svg {...iconProps} fill={filled ? 'currentColor' : 'none'} fillOpacity={filled ? 0.12 : 0}>
      <path d="M4 5h2l2.2 9.2a1.5 1.5 0 0 0 1.5 1.15h6.9a1.5 1.5 0 0 0 1.45-1.1L20 8H7" />
      <circle cx="10" cy="19" r="1.4" />
      <circle cx="17" cy="19" r="1.4" />
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
