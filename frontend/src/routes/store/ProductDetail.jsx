import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { endpoints } from '../../lib/endpoints.js';
import { useApiQuery } from '../../hooks/useApiQuery.js';
import { discountPercent, formatPaise, formatPaiseShort } from '../../lib/money.js';
import { RemoteImage } from '../../components/RemoteImage.jsx';
import { QuantityStepper } from '../../components/QuantityStepper.jsx';
import { AddToCartButton } from '../../components/AddToCartButton.jsx';
import { ErrorState, LoadingBlock, Skeleton } from '../../components/states/States.jsx';
import './ProductDetail.css';

/**
 * One product — checklist 11.5.
 *
 * Public, like the rest of the storefront: a link to a specific product has to
 * open for someone with no account, and only the add-to-cart button needs a
 * session.
 *
 * A variant carries an absolute price, not a delta (backend D15), so selecting
 * one replaces the price rather than adjusting it. The selected variant's own
 * stock is what bounds the quantity — a product can have 40 in total and 2 of
 * the 5 kg bag.
 */
export function ProductDetail() {
  const { slug, productId } = useParams();

  const { data, loading, error, refetch } = useApiQuery(
    () => endpoints.stores.product(slug, productId),
    [slug, productId],
  );

  // Reset when the product changes, so navigating between two products cannot
  // carry a variant that belongs to the previous one.
  const [variantId, setVariantId] = useState(null);
  const [quantity, setQuantity] = useState(1);

  if (loading) return <ProductSkeleton />;

  if (error || !data?.product) {
    return (
      <ErrorState
        error={error ?? { message: 'This product could not be loaded.' }}
        onRetry={error?.status === 404 ? undefined : refetch}
        title={error?.status === 404 ? 'That product is not here' : undefined}
      />
    );
  }

  const product = data.product;
  const variants = product.variants ?? [];
  const selected = variants.find((variant) => variant.id === variantId) ?? null;

  // The variant decides price and stock once one is chosen.
  const pricePaise = selected?.pricePaise ?? product.pricePaise;
  const stock = selected ? selected.stock : product.stock;
  const purchasable = selected ? selected.isPurchasable : product.isPurchasable;
  const needsVariant = variants.length > 0 && !selected;

  const saving = discountPercent(pricePaise, product.mrpPaise);
  // `stock: null` means the shop does not track it — not that there is none.
  const max = stock === null || stock === undefined ? 999 : Math.max(stock, 1);

  return (
    <article className="product">
      <Link to={`/store/${slug}`} className="product__back">
        <ChevronLeft /> Back to the shop
      </Link>

      <Gallery product={product} />

      <header className="product__head">
        <h1>{product.name}</h1>

        <p className="product__prices">
          <span className="product__price numeric">{formatPaise(pricePaise)}</span>
          {product.mrpPaise > pricePaise ? (
            <>
              <s className="product__mrp numeric">{formatPaise(product.mrpPaise)}</s>
              {saving ? <span className="badge">{saving}% off</span> : null}
            </>
          ) : null}
        </p>

        <Availability purchasable={purchasable} stock={stock} />
      </header>

      {product.description ? <p className="product__description">{product.description}</p> : null}

      {variants.length > 0 ? (
        <Variants
          variants={variants}
          selectedId={variantId}
          basePricePaise={product.pricePaise}
          onSelect={(id) => {
            setVariantId(id);
            setQuantity(1);
          }}
        />
      ) : null}

      <div className="product__buy">
        {purchasable && !needsVariant ? (
          <div className="spread">
            <span className="field__label">How many?</span>
            <QuantityStepper value={quantity} onChange={setQuantity} max={max} />
          </div>
        ) : null}

        {needsVariant ? (
          <p className="notice notice--info">Choose an option to continue.</p>
        ) : null}

        <AddToCartButton
          storeId={product.storeId}
          storeSlug={slug}
          productId={product.id}
          variantId={variantId}
          quantity={quantity}
          disabled={!purchasable || needsVariant}
        />

        {purchasable && !needsVariant && quantity > 1 ? (
          <p className="product__running muted">
            {quantity} × {formatPaiseShort(pricePaise)} ={' '}
            <strong className="numeric">{formatPaise(pricePaise * quantity)}</strong>
          </p>
        ) : null}
      </div>
    </article>
  );
}

/** The image the customer is looking at, plus thumbnails when there are more. */
function Gallery({ product }) {
  const images = product.images?.length
    ? product.images
    : product.imageUrl
      ? [{ id: 'primary', url: product.imageUrl, altText: product.name }]
      : [];

  const [activeIndex, setActiveIndex] = useState(0);
  const active = images[activeIndex];

  return (
    <div className="product__gallery">
      <RemoteImage
        src={active?.url}
        name={product.name}
        alt={active?.altText ?? product.name}
        ratio="4 / 3"
        className="product__image"
      />

      {images.length > 1 ? (
        <div className="product__thumbs" role="group" aria-label="More pictures">
          {images.map((image, index) => (
            <button
              key={image.id}
              type="button"
              className={`product__thumb${index === activeIndex ? ' product__thumb--active' : ''}`}
              onClick={() => setActiveIndex(index)}
              aria-label={image.altText ?? `Picture ${index + 1}`}
              aria-current={index === activeIndex}
            >
              <RemoteImage src={image.url} name={product.name} alt="" ratio="1 / 1" />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Availability({ purchasable, stock }) {
  if (!purchasable) {
    return (
      <p className="product__availability product__availability--out">
        Sold out — the shop will restock it
      </p>
    );
  }
  if (stock === null || stock === undefined) return null;
  if (stock > 5) return null;

  return (
    <p className="product__availability product__availability--low">
      {stock === 1 ? 'Last one left' : `Only ${stock} left`}
    </p>
  );
}

/**
 * Radios, not a dropdown: two or three sizes are quicker to compare side by side,
 * and a select hides the prices until it is opened.
 */
function Variants({ variants, selectedId, onSelect }) {
  return (
    <fieldset className="product__variants">
      <legend className="field__label">Options</legend>

      {variants.map((variant) => {
        const soldOut = !variant.isPurchasable;

        return (
          <label
            key={variant.id}
            className={`product__variant${soldOut ? ' product__variant--out' : ''}`}
          >
            <input
              type="radio"
              name="variant"
              value={variant.id}
              checked={selectedId === variant.id}
              onChange={() => onSelect(variant.id)}
              disabled={soldOut}
            />
            <span className="product__variant-name">{variant.name}</span>
            <span className="product__variant-price numeric">
              {soldOut ? 'Sold out' : formatPaiseShort(variant.pricePaise)}
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}

function ProductSkeleton() {
  return (
    <LoadingBlock label="Loading the product">
      <div className="stack">
        <Skeleton width="8rem" height="1rem" />
        <Skeleton height="0" style={{ aspectRatio: '4 / 3', height: 'auto', borderRadius: 'var(--radius-lg)' }} />
        <Skeleton width="70%" height="1.5rem" />
        <Skeleton width="35%" height="1.25rem" />
        <Skeleton height="3rem" radius="var(--radius-md)" />
      </div>
    </LoadingBlock>
  );
}

function ChevronLeft() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M15 6l-6 6 6 6" />
    </svg>
  );
}
