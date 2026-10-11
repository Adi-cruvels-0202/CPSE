import { useState } from 'react';
import { Link } from 'react-router-dom';
import { endpoints } from '../../lib/endpoints.js';
import { useSubmit } from '../../hooks/useSubmit.js';
import { formatPaise } from '../../lib/money.js';
import { rememberStore } from '../../lib/activeStore.js';
import { RemoteImage } from '../../components/RemoteImage.jsx';
import { FormError } from '../../components/FormError.jsx';

/**
 * One product in a personal list — buy again, favourites, recently viewed,
 * shopping lists. Always the live product card from the server, so the price
 * is today's and a product that cannot be bought says so instead of offering
 * "Add". Adding goes through the normal cart path and its rules.
 */
export function ProductRow({ product, variantId, quantity = 1, detail, actions }) {
  const [added, setAdded] = useState(false);
  const chosenVariant = variantId ?? product.defaultVariantId ?? null;
  const add = useSubmit(
    () =>
      endpoints.cart.addItem({
        storeId: product.store.id,
        productId: product.id,
        ...(chosenVariant ? { variantId: chosenVariant } : {}),
        quantity,
      }),
    {
      onSuccess: () => {
        setAdded(true);
        rememberStore({ id: product.store.id, slug: product.store.slug });
      },
    },
  );
  const productLink = `/store/${product.store.slug}/product/${product.id}`;

  return (
    <li className="prow">
      <RemoteImage src={product.imageUrl} name={product.name} alt="" ratio="1 / 1" className="prow__image" rounded="var(--radius-sm)" />
      <span className="prow__body">
        <Link to={productLink} className="prow__name">{product.name}</Link>
        <span className="muted">
          {product.store.name} · {formatPaise(product.pricePaise)}
          {quantity > 1 ? ` · usually ${quantity}` : ''}
        </span>
        {detail ? <span className="muted">{detail}</span> : null}
        <FormError error={add.error} />
      </span>
      <span className="prow__actions">
        {!product.isPurchasable ? (
          <span className="badge badge--neutral">Not available</span>
        ) : added ? (
          <Link to={`/cart/${product.store.id}`} className="btn btn--secondary btn--sm">In cart ✓</Link>
        ) : chosenVariant ? (
          <button type="button" className="btn btn--sm" onClick={() => add.submit()} disabled={add.pending} aria-label={`Add ${product.name} to cart`}>
            {add.pending ? 'Adding…' : 'Add'}
          </button>
        ) : (
          <Link to={productLink} className="btn btn--secondary btn--sm">Choose size</Link>
        )}
        {actions}
      </span>
    </li>
  );
}
