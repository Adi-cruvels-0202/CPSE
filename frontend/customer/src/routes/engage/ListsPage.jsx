import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { endpoints } from '../../lib/endpoints.js';
import { useApiQuery } from '../../hooks/useApiQuery.js';
import { useSubmit } from '../../hooks/useSubmit.js';
import { EmptyState, ErrorState, LoadingBlock, Skeleton } from '../../components/states/States.jsx';
import { FormError } from '../../components/FormError.jsx';
import { Field } from '../../components/Field.jsx';
import { ProductRow } from './ProductRow.jsx';
import './Engage.css';

/**
 * Shopping lists and templates (roadmap §5 P2). A list is a note of what to
 * buy, anywhere; a template is a repeat basket at one shop, with an optional
 * reminder every N days. "Add to cart" uses the normal cart rules and says
 * what could not be added.
 */
export function ListsPage() {
  const navigate = useNavigate();
  const query = useApiQuery(() => endpoints.lists.list(), []);
  const saved = useApiQuery(() => endpoints.savedStores.list(), []);
  const [name, setName] = useState('');
  const [kind, setKind] = useState('list');
  const [storeId, setStoreId] = useState('');
  const [every, setEvery] = useState('');
  const create = useSubmit(
    async () => {
      const { data } = await endpoints.lists.create({
        name: name.trim(),
        kind,
        ...(storeId ? { storeId } : {}),
        ...(kind === 'template' && every ? { repeatEveryDays: Number(every) } : {}),
      });
      return data.list;
    },
    { onSuccess: (list) => navigate(`/lists/${list.id}`) },
  );
  const lists = query.data?.lists ?? [];
  const stores = (saved.data?.stores ?? saved.data?.savedStores ?? []).map((row) => row.store ?? row);

  return (
    <div className="stack">
      <header>
        <h1>Lists and templates</h1>
        <p className="muted">A list is what to buy. A template is your regular basket at one shop.</p>
      </header>

      {query.loading ? (
        <LoadingBlock label="Loading your lists"><Skeleton height="6rem" radius="var(--radius-md)" /></LoadingBlock>
      ) : query.error ? (
        <ErrorState error={query.error} onRetry={query.refetch} />
      ) : lists.length === 0 ? (
        <EmptyState title="No lists yet" body="Start one below." />
      ) : (
        <ul className="prows">
          {lists.map((list) => (
            <li key={list.id} className="prow" style={{ gridTemplateColumns: '1fr auto' }}>
              <span className="prow__body">
                <Link to={`/lists/${list.id}`} className="prow__name">{list.name}</Link>
                <span className="muted">
                  {list.kind === 'template' ? 'Template' : 'List'}
                  {list.store ? ` · ${list.store.name}` : ''} · {list.items.length} {list.items.length === 1 ? 'item' : 'items'}
                  {list.repeatEveryDays ? ` · every ${list.repeatEveryDays} days` : ''}
                </span>
              </span>
              <Link to={`/lists/${list.id}`} className="btn btn--secondary btn--sm">Open</Link>
            </li>
          ))}
        </ul>
      )}

      <form
        className="card stack"
        onSubmit={(event) => {
          event.preventDefault();
          create.submit();
        }}
      >
        <h2 className="engage__title">New</h2>
        <div className="choices" role="radiogroup" aria-label="Kind">
          {[['list', 'Shopping list'], ['template', 'Repeat template']].map(([value, label]) => (
            <label key={value} className={`choice${kind === value ? ' choice--selected' : ''}`}>
              <input type="radio" name="kind" value={value} checked={kind === value} onChange={() => setKind(value)} />
              <span className="choice__body"><span className="choice__label">{label}</span></span>
            </label>
          ))}
        </div>
        <Field label="Name" value={name} onChange={setName} required error={create.fieldErrors.name} placeholder="Weekly groceries" />
        <Field label={kind === 'template' ? 'Shop' : 'Shop (optional)'} required={kind === 'template'} error={create.fieldErrors.storeId}>
          <select className="field__input" aria-label="Shop" value={storeId} onChange={(event) => setStoreId(event.target.value)}>
            <option value="">{kind === 'template' ? 'Choose one of your saved shops' : 'Any shop'}</option>
            {stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
          </select>
        </Field>
        {kind === 'template' ? (
          <Field label="Remind me every (days)" type="number" inputMode="numeric" value={every} onChange={setEvery} hint="Leave empty for no reminder." />
        ) : null}
        <FormError error={create.error} />
        <button type="submit" className="btn" disabled={create.pending || !name.trim() || (kind === 'template' && !storeId)}>
          {create.pending ? 'Creating…' : 'Create'}
        </button>
      </form>
    </div>
  );
}

export function ListPage() {
  const { listId } = useParams();
  const navigate = useNavigate();
  const query = useApiQuery(() => endpoints.lists.get(listId), [listId]);
  const [label, setLabel] = useState('');
  const [result, setResult] = useState(null);
  const list = query.data?.list;
  const setList = (data) => query.setData({ list: data.list });

  const addLine = useSubmit(async () => {
    const { data } = await endpoints.lists.addItem(listId, { label: label.trim(), quantity: 1 });
    setList(data);
    setLabel('');
  });
  const toggle = useSubmit(async (item) => setList((await endpoints.lists.updateItem(listId, item.id, { isChecked: !item.isChecked })).data));
  const removeItem = useSubmit(async (item) => setList((await endpoints.lists.removeItem(listId, item.id)).data));
  const toCart = useSubmit(async () => {
    const { data } = await endpoints.lists.addToCart(listId);
    setResult(data);
    await query.refetch();
  });
  const removeList = useSubmit(async () => {
    await endpoints.lists.remove(listId);
    navigate('/lists', { replace: true });
  });

  if (query.loading) return <LoadingBlock label="Loading the list"><Skeleton height="10rem" radius="var(--radius-md)" /></LoadingBlock>;
  if (query.error || !list) return <ErrorState error={query.error ?? { message: 'That list could not be loaded.' }} onRetry={query.refetch} />;

  const products = list.items.filter((item) => item.product);
  return (
    <div className="stack">
      <header>
        <h1>{list.name}</h1>
        <p className="muted">
          {list.kind === 'template' ? 'Template' : 'Shopping list'}
          {list.store ? ` · ${list.store.name}` : ''}
          {list.repeatEveryDays ? ` · reminder every ${list.repeatEveryDays} days` : ''}
        </p>
      </header>

      <FormError error={toggle.error ?? removeItem.error ?? toCart.error ?? removeList.error} />
      {result ? (
        <div className={`notice notice--${result.failed.length ? 'warning' : 'success'}`} role="status">
          Added {result.added.length} to your cart.
          {result.failed.length ? ` Not added: ${result.failed.map((f) => `${f.name} (${f.message})`).join('; ')}.` : ''}
          {' '}<Link to={`/cart/${result.storeId}`}>Go to cart</Link>
        </div>
      ) : null}

      {list.items.length === 0 ? (
        <EmptyState title="Nothing on this list yet" body="Write something below, or add products from a shop page." />
      ) : (
        <ul className="prows">
          {list.items.map((item) =>
            item.product ? (
              <ProductRow
                key={item.id}
                product={item.product}
                variantId={item.variantId}
                quantity={item.quantity}
                actions={<ItemActions item={item} onToggle={toggle.submit} onRemove={removeItem.submit} />}
              />
            ) : (
              <li key={item.id} className="prow" style={{ gridTemplateColumns: '1fr auto' }}>
                <span className={item.isChecked ? 'muted' : ''} style={item.isChecked ? { textDecoration: 'line-through' } : undefined}>
                  {item.label}{item.quantity > 1 ? ` × ${item.quantity}` : ''}
                </span>
                <span className="prow__actions"><ItemActions item={item} onToggle={toggle.submit} onRemove={removeItem.submit} /></span>
              </li>
            ),
          )}
        </ul>
      )}

      <form
        className="inline-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (label.trim()) addLine.submit();
        }}
      >
        <input className="field__input" aria-label="Add to the list" placeholder="Add something to buy" value={label} maxLength={120} onChange={(event) => setLabel(event.target.value)} />
        <button type="submit" className="btn btn--secondary btn--sm" disabled={addLine.pending || !label.trim()}>Add</button>
      </form>
      <FormError error={addLine.error} />

      {products.length > 0 && (list.store || products.every((item) => item.product.store.id === products[0].product.store.id)) ? (
        <button type="button" className="btn btn--block" onClick={() => toCart.submit()} disabled={toCart.pending}>
          {toCart.pending ? 'Adding…' : 'Put the unticked products in my cart'}
        </button>
      ) : null}
      <button type="button" className="btn btn--ghost btn--block" onClick={() => removeList.submit()} disabled={removeList.pending}>
        Delete this list
      </button>
    </div>
  );
}

function ItemActions({ item, onToggle, onRemove }) {
  return (
    <span className="row">
      <label className="row" style={{ gap: '0.25rem' }}>
        <input type="checkbox" checked={item.isChecked} onChange={() => onToggle(item)} aria-label={`Got ${item.label ?? 'it'}`} />
        <span className="muted">Got it</span>
      </label>
      <button type="button" className="btn btn--ghost btn--sm" onClick={() => onRemove(item)} aria-label={`Remove ${item.label ?? 'item'}`}>✕</button>
    </span>
  );
}
