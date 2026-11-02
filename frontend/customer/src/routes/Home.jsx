import { Link } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { endpoints } from '../lib/endpoints.js';
import { useApiQuery } from '../hooks/useApiQuery.js';
import { formatPaise } from '../lib/money.js';
import { describeStatus } from '../lib/storeHours.js';
import { formatSince, isTerminal, meaningFor, toneFor } from '../lib/orderStatus.js';
import { RemoteImage, hasImage } from '../components/RemoteImage.jsx';
import { Skeleton } from '../components/states/States.jsx';
import { readSelectedCity } from '../lib/cityPreference.js';
import './Home.css';

const SHOP_CATEGORIES = [
  { id: 'groceries', label: 'Groceries' },
  { id: 'food', label: 'Food and bakery' },
  { id: 'health', label: 'Health and pharmacy' },
  { id: 'home', label: 'Home and household' },
  { id: 'fashion', label: 'Fashion and personal care' },
  { id: 'electronics', label: 'Electronics' },
  { id: 'kids', label: 'Kids, books and hobbies' },
  { id: 'hardware', label: 'Hardware and outdoors' },
];

const HARDWARE_PRODUCT_CATEGORIES = new Set(['tools-repair', 'garden-outdoor']);

function categoryForStore(store) {
  switch (store.shopCategory) {
    case 'grocery': return 'groceries';
    case 'restaurant':
    case 'bakery': return 'food';
    case 'pharmacy': return 'health';
    case 'clothing': return 'fashion';
    case 'electronics': return 'electronics';
    case 'other': return 'kids';
    case 'general':
      return store.productCategories?.some(({ slug }) => HARDWARE_PRODUCT_CATEGORIES.has(slug))
        ? 'hardware'
        : 'home';
    default: return null;
  }
}

/**
 * The landing screen: what is happening with my order, the shops I go back
 * to, and every shop on CPSE — the last from the public directory
 * (GET /stores), so a first-time visitor has somewhere to go besides a link.
 */
export function Home() {
  const { status } = useAuth();
  const signedIn = status === 'signedIn';

  return (
    <div className="home">
      {!signedIn ? (
        <header className="home__greeting">
          <h1>Shop nearby</h1>
          <p className="muted">Order from the shops around you — pick one below to start.</p>
        </header>
      ) : null}

      {signedIn ? (
        <>
          <ActiveOrders />
          <ShopDirectory signedIn={signedIn} />
        </>
      ) : (
        <ShopDirectory signedIn={signedIn} />
      )}

    </div>
  );
}

/**
 * The order that is happening right now, if there is one.
 *
 * Shown as one card rather than a list: more than one live order at a time is
 * rare, and the rest are one tap away under Orders. A quiet link is all a
 * customer with nothing in flight needs — an empty "no active orders" panel is
 * a box that exists to say nothing.
 */
function ActiveOrders() {
  const { data, loading, error } = useApiQuery(() => endpoints.orders.list({ limit: 5 }), []);

  if (loading) return <Skeleton height="6rem" radius="var(--radius-lg)" />;
  // A home screen must not lead with a failure it can do nothing about; Orders
  // reports it properly, with a retry.
  if (error) return null;

  const live = (data?.orders ?? []).filter((order) => !isTerminal(order.status));
  if (live.length === 0) return null;

  return (
    <section className="home__section" aria-labelledby="live-heading">
      <div className="spread">
        <h2 id="live-heading" className="home__section-title">
          Happening now
        </h2>
        {live.length > 1 ? (
          <Link to="/orders" className="home__more">
            All orders
          </Link>
        ) : null}
      </div>

      <Link to={`/orders/${live[0].id}`} className="home__order">
        <div className="home__order-top">
          <span className="home__order-store">{live[0].storeName}</span>
          <span className={`status status--${toneFor(live[0].status)}`}>
            {live[0].statusLabel}
          </span>
        </div>

        {/* The state's name, then what it means — the second is the one the
            customer actually wanted to know. */}
        <p className="home__order-meaning">{meaningFor(live[0].status)}</p>

        <div className="home__order-foot">
          <span>
            {live[0].itemCount} {live[0].itemCount === 1 ? 'item' : 'items'} ·{' '}
            <span className="numeric">{formatPaise(live[0].totalPaise)}</span>
          </span>
          <time dateTime={live[0].placedAt}>{formatSince(live[0].placedAt)}</time>
        </div>
      </Link>
    </section>
  );
}

/**
 * Every shop on CPSE, as cards a customer can choose between: the cover (or
 * the shop's initials), whether it is open now, and how it hands orders over.
 */
function ShopDirectory({ signedIn }) {
  const [selectedCity, setSelectedCity] = useState(readSelectedCity);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [selectedProductCategory, setSelectedProductCategory] = useState('');
  const [categoryHeaderTarget, setCategoryHeaderTarget] = useState(null);
  const { data, loading, error } = useApiQuery(() => endpoints.stores.list({ limit: 50 }), []);
  const savedQuery = useApiQuery(
    () => endpoints.savedStores.list({ limit: 100 }),
    [signedIn],
    { enabled: signedIn },
  );

  useEffect(() => {
    setCategoryHeaderTarget(document.getElementById('shell-tabs-categories'));
  }, [signedIn]);

  useEffect(() => {
    const syncCity = () => setSelectedCity(readSelectedCity());
    window.addEventListener('cpse:city-changed', syncCity);
    return () => window.removeEventListener('cpse:city-changed', syncCity);
  }, []);

  if (loading) return <Skeleton height="10rem" radius="var(--radius-lg)" />;
  if (error) return null;

  const allStores = data?.stores ?? [];
  if (allStores.length === 0) return null;
  const savedStoreIds = new Set(
    (Array.isArray(savedQuery.data?.savedStores) ? savedQuery.data.savedStores : [])
      .map((entry) => entry?.store?.id)
      .filter(Boolean),
  );

  const cityStores = allStores.filter((store) => {
    const city = store.location?.city ?? '';
    const matchesCity = !selectedCity || city.localeCompare(selectedCity, undefined, { sensitivity: 'accent' }) === 0;
    return matchesCity;
  });
  const categoryCounts = new Map(SHOP_CATEGORIES.map(({ id }) => [
    id,
    fillToFive(cityStores.filter((store) => categoryForStore(store) === id)).length,
  ]));
  const activeCategory = SHOP_CATEGORIES.find(({ id }) => id === selectedCategory);
  const subcategories = selectedCategory === 'all' ? [] : [...new Map(
    cityStores
      .filter((store) => categoryForStore(store) === selectedCategory)
      .flatMap((store) => store.productCategories ?? [])
      .map((category) => [category.slug, category]),
  ).values()].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  const categoryStores = selectedCategory === 'all'
    ? cityStores
    : cityStores.filter((store) => categoryForStore(store) === selectedCategory);
  const filteredStores = selectedProductCategory
    ? categoryStores.filter((store) => store.productCategories?.some(({ slug }) => slug === selectedProductCategory))
    : categoryStores;
  const shopShelves = selectedCategory === 'all'
    ? SHOP_CATEGORIES.map((category) => ({
        ...category,
        shops: fillToFive(cityStores.filter((store) => categoryForStore(store) === category.id)),
      })).filter(({ shops }) => shops.length > 0)
    : [{
        ...activeCategory,
        label: selectedProductCategory
          ? subcategories.find(({ slug }) => slug === selectedProductCategory)?.name ?? activeCategory.label
          : activeCategory.label,
        shops: selectedProductCategory ? filteredStores.slice(0, 5) : fillToFive(filteredStores),
      }].filter(({ shops }) => shops.length > 0);

  return (
    <section className="home__section" aria-labelledby="directory-heading">
      {(() => {
        const categoryNavigation = (
          <CategoryNavigation
            selectedCategory={selectedCategory}
            setSelectedCategory={setSelectedCategory}
            categoryCounts={categoryCounts}
            cityStoreCount={cityStores.length}
          />
        );
        return (
          <>
            <div className="home__category-navigation--body">{categoryNavigation}</div>
            {categoryHeaderTarget ? createPortal(
              <div className="home__category-navigation--header">{categoryNavigation}</div>,
              categoryHeaderTarget,
            ) : null}
          </>
        );
      })()}

      {activeCategory ? (
        <>
          <button type="button" className="home__back-categories" onClick={() => { setSelectedCategory('all'); setSelectedProductCategory(''); }}>
            <span aria-hidden="true">‹</span> All categories
          </button>
          <SubcategoryNavigation
            activeCategory={activeCategory}
            selectedProductCategory={selectedProductCategory}
            setSelectedProductCategory={setSelectedProductCategory}
            subcategories={subcategories}
          />
        </>
      ) : null}

      {shopShelves.length ? (
        <div className="home__shop-shelves" aria-label="Shops by category">
          {shopShelves.map((shelf) => (
            <ShopShelf
              key={shelf.id}
              category={shelf}
              vertical={selectedCategory !== 'all'}
              savedStoreIds={savedStoreIds}
              onSeeAll={() => { setSelectedCategory(shelf.id); setSelectedProductCategory(''); }}
            />
          ))}
        </div>
      ) : (
        <p className="muted" role="status">
          No shops found in {selectedCity}. Choose another city.
        </p>
      )}
    </section>
  );
}

function fillToFive(shops) {
  if (shops.length === 0) return [];
  return Array.from({ length: 5 }, (_, index) => shops[index % shops.length]);
}

function CategoryNavigation({ selectedCategory, setSelectedCategory, categoryCounts, cityStoreCount }) {
  const listRef = useRef(null);
  const { canScrollLeft, canScrollRight } = useHorizontalScroll(listRef);
  const scrollCategories = (direction) => {
    const list = listRef.current;
    if (!list) return;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    list.scrollBy({ left: direction * Math.max(180, list.clientWidth * 0.7), behavior: reducedMotion ? 'auto' : 'smooth' });
  };

  return (
    <div className="home__category-navigation">
      <div className="home__category-scroll-row">
        <nav className="home__category-list" aria-label="Shop categories" ref={listRef}>
          <button type="button" className={`home__category-chip${selectedCategory === 'all' ? ' home__category-chip--active' : ''}`} aria-pressed={selectedCategory === 'all'} onClick={() => { setSelectedCategory('all'); setSelectedProductCategory(''); }}>
            All shops <span>{cityStoreCount}</span>
          </button>
          {SHOP_CATEGORIES.map(({ id, label }) => (
            <button type="button" key={id} className={`home__category-chip${selectedCategory === id ? ' home__category-chip--active' : ''}`} aria-pressed={selectedCategory === id} onClick={() => { setSelectedCategory(id); setSelectedProductCategory(''); }}>
              {label} <span>{categoryCounts.get(id)}</span>
            </button>
          ))}
        </nav>
        <button type="button" className={`home__category-prev${canScrollLeft ? '' : ' home__category-arrow--hidden'}`} onClick={() => scrollCategories(-1)} aria-label="Show previous shop categories" aria-hidden={!canScrollLeft} tabIndex={canScrollLeft ? 0 : -1} disabled={!canScrollLeft}><span aria-hidden="true">‹</span></button>
        <button type="button" className={`home__category-next${canScrollRight ? '' : ' home__category-arrow--hidden'}`} onClick={() => scrollCategories(1)} aria-label="Show more shop categories" aria-hidden={!canScrollRight} tabIndex={canScrollRight ? 0 : -1} disabled={!canScrollRight}><span aria-hidden="true">›</span></button>
      </div>
    </div>
  );
}

function useHorizontalScroll(ref) {
  const [edges, setEdges] = useState({ canScrollLeft: false, canScrollRight: false });

  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const updateEdges = () => {
      const maxScrollLeft = Math.max(0, element.scrollWidth - element.clientWidth);
      setEdges({
        canScrollLeft: element.scrollLeft > 2,
        canScrollRight: maxScrollLeft - element.scrollLeft > 2,
      });
    };
    updateEdges();
    element.addEventListener('scroll', updateEdges, { passive: true });
    window.addEventListener('resize', updateEdges);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateEdges);
    observer?.observe(element);
    return () => {
      element.removeEventListener('scroll', updateEdges);
      window.removeEventListener('resize', updateEdges);
      observer?.disconnect();
    };
  }, [ref]);

  return edges;
}

function SubcategoryNavigation({ activeCategory, selectedProductCategory, setSelectedProductCategory, subcategories }) {
  return (
    <nav className="home__subcategory-header" aria-label={`${activeCategory.label} subcategories`}>
      <button type="button" className={`home__subcategory-chip${selectedProductCategory === '' ? ' home__subcategory-chip--active' : ''}`} aria-pressed={selectedProductCategory === ''} onClick={() => setSelectedProductCategory('')}>
        All {activeCategory.label.toLowerCase()}
      </button>
      {subcategories.map((subcategory) => (
        <button type="button" key={subcategory.id} className={`home__subcategory-chip${selectedProductCategory === subcategory.slug ? ' home__subcategory-chip--active' : ''}`} aria-pressed={selectedProductCategory === subcategory.slug} onClick={() => setSelectedProductCategory(subcategory.slug)}>
          {subcategory.name}
        </button>
      ))}
    </nav>
  );
}

function ShopShelf({ category, onSeeAll, vertical, savedStoreIds }) {
  const railRef = useRef(null);
  const { canScrollLeft, canScrollRight } = useHorizontalScroll(railRef);
  const moveRail = (direction) => {
    const rail = railRef.current;
    if (!rail) return;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    rail.scrollBy({ left: direction * Math.max(240, rail.clientWidth * 0.75), behavior: reducedMotion ? 'auto' : 'smooth' });
  };

  return (
    <section className="home__shop-shelf" aria-labelledby={`shop-shelf-${category.id}`}>
      <div className="home__shop-shelf-heading">
        <h2 id={`shop-shelf-${category.id}`} className="home__section-title">
          {category.label}
        </h2>
        {!vertical ? <button type="button" className="home__more home__see-all" onClick={onSeeAll}>See all</button> : null}
      </div>
      <div className="home__shop-rail-wrap">
        <ul ref={railRef} className={`home__shop-rail${vertical ? ' home__shop-rail--list' : ''}`}>
          {category.shops.map((store, index) => {
          const open = describeStatus(store.hours).isOpen;
          const ways = [store.fulfilment.deliveryEnabled && 'Delivery', store.fulfilment.pickupEnabled && 'Pickup'].filter(Boolean);
          const productCategory = store.productCategories?.[0]?.name;
          const image = hasImage(store.coverImageUrl) ? store.coverImageUrl : store.logoUrl;
          return (
            <li key={`${store.id}-${index}`} className="home__shop-rail-item">
              <Link to={`/store/${store.slug}`} className="home__shop-card">
                <RemoteImage src={image} name={store.name} alt="" ratio="4 / 3" className="home__shop-card-image" />
                {savedStoreIds.has(store.id) ? <FavoriteMark /> : null}
                <span className="home__shop-card-body">
                  <span className="home__shop-card-top">
                    <span className="home__shop-card-name">{store.name}</span>
                    <span className={`home__shop-state${open ? ' home__shop-state--open' : ''}`}>{open ? 'Open' : 'Closed'}</span>
                  </span>
                  {productCategory ? <span className="home__shop-card-category">{productCategory}</span> : null}
                  <span className="home__shop-card-meta">{[store.location.city, ...ways].filter(Boolean).join(' · ')}</span>
                </span>
              </Link>
            </li>
          );
          })}
        </ul>
        {!vertical && (canScrollLeft || canScrollRight) ? (
          <>
            {canScrollLeft ? <button type="button" className="home__shop-rail-prev" onClick={() => moveRail(-1)} aria-label={`Show previous ${category.label} shops`}>
              <span aria-hidden="true">‹</span>
            </button> : null}
            {canScrollRight ? <button type="button" className="home__shop-rail-next" onClick={() => moveRail(1)} aria-label={`Show more ${category.label} shops`}>
              <span aria-hidden="true">›</span>
            </button> : null}
          </>
        ) : null}
      </div>
    </section>
  );
}

function FavoriteMark() {
  return (
    <span className="home__shop-card-favorite" role="img" aria-label="Favorite shop">
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M20.8 8.7c0 5.1-8.8 10.1-8.8 10.1S3.2 13.8 3.2 8.7A4.7 4.7 0 0 1 12 6.5a4.7 4.7 0 0 1 8.8 2.2Z" />
      </svg>
    </span>
  );
}
