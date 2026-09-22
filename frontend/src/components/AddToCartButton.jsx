import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { endpoints } from '../lib/endpoints.js';
import { useSubmit } from '../hooks/useSubmit.js';
import { rememberStore } from '../lib/activeStore.js';
import { FormError } from './FormError.jsx';

/**
 * Puts a line in the cart — checklist 11.5's product page acting on 11.7's cart.
 *
 * The cart *screen* is 11.7; this is the button that fills it, and a product page
 * without one is inert. Same pattern as the save heart: a customer who is not
 * signed in is sent to sign in, remembering the product they were looking at,
 * rather than being shown a 401 they did not ask for.
 *
 * Deliberately not optimistic. A cart is money — if the line did not go in, the
 * customer has to know now rather than discover it at checkout, so this waits
 * for the server and then says what happened.
 */
export function AddToCartButton({ storeId, storeSlug, productId, variantId, quantity, disabled }) {
  const { isSignedIn } = useAuth();
  const navigate = useNavigate();
  const [added, setAdded] = useState(false);

  const { submit, pending, error } = useSubmit(
    () =>
      endpoints.cart.addItem({
        storeId,
        productId,
        ...(variantId ? { variantId } : {}),
        quantity,
      }),
    {
      onSuccess: () => {
        setAdded(true);
        // So the Cart tab goes to the cart they just added to.
        rememberStore({ id: storeId, slug: storeSlug });
      },
    },
  );

  if (!isSignedIn) {
    return (
      <button
        type="button"
        className="btn btn--block"
        disabled={disabled}
        onClick={() =>
          navigate('/login', {
            state: { from: `/store/${storeSlug}/product/${productId}` },
          })
        }
      >
        Sign in to add to cart
      </button>
    );
  }

  if (added) {
    return (
      <div className="stack" style={{ gap: 'var(--space-2)' }}>
        <p className="notice notice--success" role="status">
          Added to your cart.
        </p>
        <Link to={`/cart/${storeId}`} className="btn btn--block">
          Go to cart
        </Link>
        <button
          type="button"
          className="btn btn--secondary btn--block"
          onClick={() => setAdded(false)}
        >
          Add another
        </button>
      </div>
    );
  }

  return (
    <div className="stack" style={{ gap: 'var(--space-2)' }}>
      <FormError error={error} />
      <button
        type="button"
        className="btn btn--block"
        onClick={() => submit()}
        disabled={disabled || pending}
      >
        {pending ? (
          <>
            <span className="spinner spinner--on-brand" />
            Adding…
          </>
        ) : (
          'Add to cart'
        )}
      </button>
    </div>
  );
}
