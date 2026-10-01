import { Link } from 'react-router-dom';
import { RemoteImage } from '../../components/RemoteImage.jsx';
import { QuantityStepper } from '../../components/QuantityStepper.jsx';
import { formatPaise, formatPaiseShort } from '../../lib/money.js';
import { LineIssues } from './CartIssues.jsx';

/**
 * One line in the cart — checklist 11.7.
 *
 * The prices shown are whatever the server just returned. The cart stores no
 * prices and reprices on every read (backend D25), so a line total computed here
 * would be a second opinion that eventually disagrees with the bill.
 */
export function CartLine({ line, storeSlug, onChangeQuantity, onRemove, busy }) {
  // `stock: null` means the shop does not track it; 999 is the backend's own cap.
  const max = line.stock === null || line.stock === undefined ? 999 : Math.max(line.stock, 1);

  return (
    <li className={`cart-line${line.isPurchasable ? '' : ' cart-line--unavailable'}`}>
      <div className="cart-line__main">
        <RemoteImage
          src={line.imageUrl}
          name={line.name}
          alt={line.name}
          ratio="1 / 1"
          className="cart-line__image"
          rounded="var(--radius-md)"
        />

        <div className="cart-line__body">
          <div className="cart-line__titles">
            {storeSlug ? (
              <Link to={`/store/${storeSlug}/product/${line.productId}`} className="cart-line__name">
                {line.name}
              </Link>
            ) : (
              <span className="cart-line__name">{line.name}</span>
            )}
            {line.variantName ? (
              <span className="cart-line__variant">{line.variantName}</span>
            ) : null}
          </div>

          <p className="cart-line__unit muted">
            <span className="numeric">{formatPaiseShort(line.unitPricePaise)}</span> each
            {line.mrpPaise && line.mrpPaise > line.unitPricePaise ? (
              <s className="numeric cart-line__mrp">{formatPaiseShort(line.mrpPaise)}</s>
            ) : null}
          </p>

          <div className="cart-line__controls">
            <QuantityStepper
              value={line.quantity}
              onChange={(quantity) => onChangeQuantity(line, quantity)}
              max={max}
              disabled={busy || !line.isPurchasable}
              label={`Quantity of ${line.name}`}
            />

            <button
              type="button"
              className="cart-line__remove"
              onClick={() => onRemove(line)}
              disabled={busy}
            >
              Remove
            </button>
          </div>
        </div>

        <p className="cart-line__total numeric">{formatPaise(line.lineTotalPaise)}</p>
      </div>

      <LineIssues issues={line.issues} />
    </li>
  );
}
