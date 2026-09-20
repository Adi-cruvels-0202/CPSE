import { Link } from 'react-router-dom';
import { RemoteImage } from '../../components/RemoteImage.jsx';
import { discountPercent, formatPaiseShort } from '../../lib/money.js';
import './ProductCard.css';

/**
 * One product in the grid — checklist 11.5.
 *
 * Sold-out and withdrawn products are shown, not hidden: the spec wants them
 * visible, and the backend returns them with `isPurchasable: false` so there is
 * one flag to gate on rather than re-deriving it from `isAvailable` and `stock`.
 * A shopper who cannot see that the rice is out of stock assumes the shop does
 * not sell rice.
 *
 * `stock: null` means the shop does not track it, which is not the same as zero
 * and must never read as "none left".
 */
export function ProductCard({ product, storeSlug }) {
  const saving = discountPercent(product.pricePaise, product.mrpPaise);
  const soldOut = !product.isPurchasable;

  return (
    <Link
      to={`/store/${storeSlug}/product/${product.id}`}
      className={`product-card${soldOut ? ' product-card--sold-out' : ''}`}
    >
      <div className="product-card__media">
        <RemoteImage
          src={product.imageUrl}
          name={product.name}
          alt={product.name}
          ratio="1 / 1"
        />
        {soldOut ? <span className="product-card__veil">Sold out</span> : null}
        {saving && !soldOut ? <span className="product-card__save">{saving}% off</span> : null}
      </div>

      <div className="product-card__body">
        <h3 className="product-card__name">{product.name}</h3>

        <p className="product-card__prices">
          <span className="product-card__price numeric">
            {formatPaiseShort(product.pricePaise)}
          </span>
          {product.mrpPaise > product.pricePaise ? (
            <>
              <s className="product-card__mrp numeric">{formatPaiseShort(product.mrpPaise)}</s>
              {/* Spelled out for a screen reader, which would otherwise read the
                  two numbers as one run of digits. */}
              <span className="sr-only">
                , reduced from {formatPaiseShort(product.mrpPaise)}
              </span>
            </>
          ) : null}
        </p>

        <LowStockHint stock={product.stock} soldOut={soldOut} />
      </div>
    </Link>
  );
}

/**
 * Only said when it is both true and useful. "25 left" is noise; "2 left" is a
 * reason to decide now, and it is the number the checkout will enforce anyway.
 */
function LowStockHint({ stock, soldOut }) {
  if (soldOut || stock === null || stock === undefined || stock > 5) return null;

  return (
    <p className="product-card__stock">
      {stock === 1 ? 'Last one' : `Only ${stock} left`}
    </p>
  );
}
