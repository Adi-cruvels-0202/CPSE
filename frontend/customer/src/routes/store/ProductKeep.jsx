import { useState } from 'react';
import { Link } from 'react-router-dom';
import { endpoints } from '../../lib/endpoints.js';
import { useApiQuery } from '../../hooks/useApiQuery.js';
import { useSubmit } from '../../hooks/useSubmit.js';
import { FormError } from '../../components/FormError.jsx';

/**
 * Keeping a product for later (roadmap §5 P2): favourite it, put it on a
 * shopping list, ask the shop about it, or share it. Signed-in only, except
 * sharing.
 */
export function ProductKeep({ product, storeSlug, storeName, isSignedIn, variantId }) {
  const url = `${window.location.origin}/store/${storeSlug}/product/${product.id}`;
  const [note, setNote] = useState('');
  const share = async () => {
    try {
      if (navigator.share) await navigator.share({ title: product.name, url });
      else {
        await navigator.clipboard.writeText(url);
        setNote('Link copied.');
      }
    } catch {
      setNote(url);
    }
  };

  return (
    <section className="stack" aria-label="Keep this product" style={{ gap: 'var(--space-2)' }}>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        {isSignedIn ? <Favourite product={product} storeId={product.storeId} /> : null}
        <button type="button" className="btn btn--ghost btn--sm" onClick={share}>Share</button>
        {isSignedIn ? (
          <Link
            to={`/messages/new?storeId=${product.storeId}&productId=${product.id}&storeName=${encodeURIComponent(storeName ?? '')}`}
            className="btn btn--ghost btn--sm"
          >
            Ask about this
          </Link>
        ) : null}
      </div>
      {isSignedIn ? <AddToList product={product} variantId={variantId} /> : null}
      {note ? <p className="muted" role="status">{note}</p> : null}
    </section>
  );
}

function Favourite({ product, storeId }) {
  const favourites = useApiQuery(() => endpoints.shopping.favourites({ storeId }), [storeId]);
  const [override, setOverride] = useState(null);
  const isFavourite = override ?? (favourites.data?.products ?? []).some((p) => p.id === product.id);
  const toggle = useSubmit(async () => {
    const { data } = isFavourite ? await endpoints.shopping.unfavourite(product.id) : await endpoints.shopping.favourite(product.id);
    setOverride(data.isFavourite);
  });
  return (
    <>
      <button type="button" className="btn btn--ghost btn--sm" aria-pressed={isFavourite} onClick={() => toggle.submit()} disabled={toggle.pending || favourites.loading}>
        {isFavourite ? '♥ Favourite' : '♡ Add to favourites'}
      </button>
      <FormError error={toggle.error} />
    </>
  );
}

function AddToList({ product, variantId }) {
  const [open, setOpen] = useState(false);
  const lists = useApiQuery(() => endpoints.lists.list(), [open], { enabled: open });
  const [listId, setListId] = useState('');
  const [done, setDone] = useState(null);
  const add = useSubmit(async () => {
    const { data } = await endpoints.lists.addItem(listId, { productId: product.id, ...(variantId ? { variantId } : {}), quantity: 1 });
    setDone(data.list);
    setOpen(false);
  });
  // A template belongs to one shop; only this shop's templates, and any list.
  const choices = (lists.data?.lists ?? []).filter((list) => !list.store || list.store.id === product.storeId);

  if (done) {
    return (
      <p className="notice notice--success" role="status">
        Added to <Link to={`/lists/${done.id}`}>{done.name}</Link>.
      </p>
    );
  }
  if (!open) {
    return <button type="button" className="btn btn--ghost btn--sm" onClick={() => setOpen(true)}>Add to a shopping list</button>;
  }
  return (
    <div className="row" style={{ flexWrap: 'wrap' }}>
      {lists.loading ? (
        <span className="muted">Loading your lists…</span>
      ) : choices.length === 0 ? (
        <span className="muted">No lists yet — <Link to="/lists">make one</Link>.</span>
      ) : (
        <>
          <select className="field__input" aria-label="Shopping list" value={listId} onChange={(event) => setListId(event.target.value)} style={{ maxWidth: '14rem' }}>
            <option value="">Choose a list</option>
            {choices.map((list) => <option key={list.id} value={list.id}>{list.name}</option>)}
          </select>
          <button type="button" className="btn btn--secondary btn--sm" disabled={!listId || add.pending} onClick={() => add.submit()}>Add</button>
        </>
      )}
      <FormError error={add.error ?? lists.error} />
    </div>
  );
}
