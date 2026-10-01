import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { endpoints } from '../../lib/endpoints.js';
import { useApiQuery } from '../../hooks/useApiQuery.js';
import { EmptyState, ErrorState, LoadingBlock, Skeleton } from '../../components/states/States.jsx';
import { FormError } from '../../components/FormError.jsx';
import { AddressCard } from './AddressCard.jsx';
import { AddressForm } from './AddressForm.jsx';
import './Addresses.css';

/**
 * The address book — checklist 11.12.
 *
 * One screen rather than a list plus two more: adding and editing open a form in
 * place. On a phone, a separate screen per action means more navigation than the
 * task deserves, and the list is the context you want while typing.
 *
 * Deleting asks first. It is the one irreversible action here, and an address is
 * half a minute of typing to recreate.
 */
export function AddressesPage() {
  const { data, loading, error, refetch, setData } = useApiQuery(() => endpoints.addresses.list());

  // 'list' | 'new' | the id being edited
  const [mode, setMode] = useState('list');
  const [confirmingDelete, setConfirmingDelete] = useState(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);

  const addresses = data?.addresses ?? [];

  const run = useCallback(
    async (action) => {
      if (busy) return false;
      setBusy(true);
      setActionError(null);

      try {
        await action();
        // Re-read rather than patching in place: making one address the default
        // un-defaults another, and the server is what knows which.
        await refetch();
        return true;
      } catch (caught) {
        setActionError(caught);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [busy, refetch],
  );

  const create = async (payload) => {
    await endpoints.addresses.create(payload);
    await refetch();
    setMode('list');
  };

  const update = async (id, payload) => {
    // An edit that changed nothing is not a request worth making, and the server
    // rejects an empty patch.
    if (Object.keys(payload).length > 0) await endpoints.addresses.update(id, payload);
    await refetch();
    setMode('list');
  };

  if (loading) return <AddressesSkeleton />;

  if (error && !data) {
    return <ErrorState error={error} onRetry={refetch} title="Could not load your addresses" />;
  }

  if (mode === 'new') {
    return (
      <div className="stack">
        <h1>Add an address</h1>
        <AddressForm onSave={create} onCancel={() => setMode('list')} saveLabel="Add address" />
      </div>
    );
  }

  const editing = addresses.find((address) => address.id === mode);
  if (editing) {
    return (
      <div className="stack">
        <h1>Edit address</h1>
        <AddressForm
          address={editing}
          onSave={(payload) => update(editing.id, payload)}
          onCancel={() => setMode('list')}
        />
      </div>
    );
  }

  return (
    <div className="stack">
      <header className="spread">
        <h1>Addresses</h1>
        <Link to="/account" className="btn btn--ghost btn--sm">
          Account
        </Link>
      </header>

      <FormError error={actionError} />

      {addresses.length === 0 ? (
        <EmptyState
          title="No addresses yet"
          body="Add one now, or when you first choose delivery at checkout."
        >
          <button type="button" className="btn" onClick={() => setMode('new')}>
            Add an address
          </button>
        </EmptyState>
      ) : (
        <>
          <ul className="addresses" aria-busy={busy || undefined}>
            {addresses.map((address) => (
              <AddressCard
                key={address.id}
                address={address}
                busy={busy}
                onEdit={() => setMode(address.id)}
                onDelete={setConfirmingDelete}
                onMakeDefault={(target) =>
                  run(() => endpoints.addresses.setDefault(target.id))
                }
              />
            ))}
          </ul>

          <button type="button" className="btn btn--secondary btn--block" onClick={() => setMode('new')}>
            Add another address
          </button>
        </>
      )}

      {confirmingDelete ? (
        <ConfirmDelete
          address={confirmingDelete}
          busy={busy}
          onCancel={() => setConfirmingDelete(null)}
          onConfirm={async () => {
            const done = await run(() => endpoints.addresses.remove(confirmingDelete.id));
            if (done) setConfirmingDelete(null);
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * Asks before deleting.
 *
 * Inline rather than a modal: a dialog needs focus trapping and an escape hatch
 * to be done properly, and this is a two-button question that reads perfectly
 * well in the flow of the page.
 */
function ConfirmDelete({ address, onConfirm, onCancel, busy }) {
  return (
    <div className="notice notice--danger address__confirm" role="alertdialog" aria-label="Delete this address?">
      <p>
        Delete the address for <strong>{address.recipientName}</strong>? Orders already placed keep
        their own copy, so your history will not change.
      </p>
      <div className="row">
        <button type="button" className="btn btn--danger btn--sm" onClick={onConfirm} disabled={busy}>
          {busy ? 'Deleting…' : 'Delete it'}
        </button>
        <button type="button" className="btn btn--secondary btn--sm" onClick={onCancel} disabled={busy}>
          Keep it
        </button>
      </div>
    </div>
  );
}

function AddressesSkeleton() {
  return (
    <LoadingBlock label="Loading your addresses">
      <div className="stack">
        <Skeleton width="45%" height="1.5rem" />
        {[0, 1].map((key) => (
          <Skeleton key={key} height="7rem" radius="var(--radius-lg)" />
        ))}
      </div>
    </LoadingBlock>
  );
}
