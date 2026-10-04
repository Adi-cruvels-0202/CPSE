import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { storeApi } from '../../api/endpoints';
import { errorMessage } from '../../api/client';
import type { StoreSummary } from '../../api/types';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../hooks/useToast';
import { IconAlertTriangle, IconTrash } from '../../components/icons/Icons';
import './Account.css';

/**
 * Account settings, from the account menu: who is signed in, and the stores
 * they run — where a store is deleted for good (MERCHANT_RULES S-19).
 */
export default function AccountSettingsPage() {
  const { merchant, stores } = useAuth();

  return (
    <div className="account">
      <div className="page-header">
        <div><h1 className="page-title">Account settings</h1><p className="page-subtitle">Your account and the stores you run</p></div>
      </div>

      <section className="card account__section">
        <div className="form-section-title">Your account</div>
        <dl className="account__facts">
          <div><dt>Name</dt><dd>{merchant?.fullName || '—'}</dd></div>
          <div><dt>Email</dt><dd>{merchant?.email}</dd></div>
          <div><dt>Phone</dt><dd>{merchant?.phone || '—'}</dd></div>
        </dl>
      </section>

      <section className="card account__section account__danger">
        <div className="form-section-title">Delete a store</div>
        <p className="body-sm account__muted">
          Deleting a store is permanent. Its products, stock history, orders, counter sales, khata and photos are all removed, and its link stops working.
          To only hide it from customers for now, unpublish it on the Store tab instead.
        </p>
        {stores.length === 0 ? (
          <p className="body-sm account__muted">You have no stores.</p>
        ) : (
          <ul className="account__stores">
            {stores.map((store) => <StoreRow key={store.id} store={store} />)}
          </ul>
        )}
      </section>
    </div>
  );
}

function StoreRow({ store }: { store: StoreSummary }) {
  const { refresh } = useAuth();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const matches = typed.trim() === store.name.trim();

  const cancel = () => {
    setConfirming(false);
    setTyped('');
    setError(null);
  };

  const remove = async (event: FormEvent) => {
    event.preventDefault();
    if (!matches) return;
    setDeleting(true);
    setError(null);
    try {
      await storeApi.remove(store.id, typed);
      await refresh().catch(() => undefined);
      queryClient.clear();
      showToast(`${store.name} deleted`, 'success');
      navigate('/dashboard');
    } catch (err) {
      setError(errorMessage(err));
      setDeleting(false);
    }
  };

  return (
    <li className="account__store">
      <div className="account__store-head">
        <div className="account__store-name">
          <span className={`shell__store-dot${store.isPublished ? ' shell__store-dot--live' : ''}`} aria-hidden="true" />
          <strong>{store.name}</strong>
          <span className={`badge ${store.isPublished ? 'badge-success' : 'badge-neutral'}`}>{store.isPublished ? 'Live' : 'Draft'}</span>
        </div>
        {!confirming && (
          <button type="button" className="btn btn-secondary btn-sm account__delete-start" onClick={() => setConfirming(true)}>
            <IconTrash size={16} /> Delete
          </button>
        )}
      </div>

      {confirming && (
        <form className="account__confirm" onSubmit={remove}>
          <p className="body-sm account__warning">
            <IconAlertTriangle size={16} />
            <span>This permanently deletes <strong>{store.name}</strong> and everything in it. It cannot be undone.</span>
          </p>
          <div className="input-wrapper">
            <label className="input-label" htmlFor={`confirm-${store.id}`}>Type <strong>{store.name}</strong> to confirm</label>
            <input
              id={`confirm-${store.id}`}
              className="input-field"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="off"
              autoFocus
              disabled={deleting}
            />
          </div>
          {error && <div className="alert-strip alert-strip-danger" role="alert">{error}</div>}
          <div className="account__confirm-actions">
            <button type="button" className="btn btn-secondary" onClick={cancel} disabled={deleting}>Keep it</button>
            <button type="submit" className="btn btn-danger" disabled={!matches || deleting}>
              <IconTrash size={16} /> {deleting ? 'Deleting…' : 'Delete permanently'}
            </button>
          </div>
        </form>
      )}
    </li>
  );
}
