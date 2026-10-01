import { Link } from 'react-router-dom';
import { endpoints } from '../../lib/endpoints.js';
import { useApiQuery } from '../../hooks/useApiQuery.js';
import { formatPaise } from '../../lib/money.js';
import { EmptyState, ErrorState, LoadingBlock, Skeleton } from '../../components/states/States.jsx';
import './Khata.css';

/**
 * Khata — checklist 11.15.
 *
 * **Read-only, and this screen is the last place that has to be true.** There is
 * no form, no button that writes, and no endpoint to call even if there were: the
 * backend mounts GET verbs only. A customer settles their khata with the shop, in
 * the shop — the portal only shows them what it is.
 *
 * `balancePaise` is signed and `outstandingPaise` is already clamped, so nothing
 * here reasons about which way the sign points.
 */
export function KhataPage() {
  const { data, loading, error, refetch } = useApiQuery(() => endpoints.khata.list());

  if (loading) return <KhataSkeleton />;

  if (error && !data) {
    return <ErrorState error={error} onRetry={refetch} title="Could not load your khata" />;
  }

  const accounts = data?.accounts ?? [];
  const total = data?.totalOutstandingPaise ?? 0;

  if (accounts.length === 0) {
    return (
      <EmptyState
        title="No khata yet"
        body="When a shop lets you buy on credit, what you owe them will appear here."
        actionTo="/"
        actionLabel="Find a shop"
      />
    );
  }

  return (
    <div className="stack">
      <h1>Khata</h1>

      <section className="khata__headline" aria-label="Total outstanding">
        <span className="khata__headline-label">You owe in total</span>
        <span className="khata__headline-amount numeric">{formatPaise(total)}</span>
        <span className="khata__headline-note">
          across {accounts.length} {accounts.length === 1 ? 'shop' : 'shops'}
        </span>
      </section>

      <ul className="khata__accounts">
        {accounts.map((account) => (
          <li key={account.id}>
            <Link to={`/khata/${account.id}`} className="khata-row">
              <span className="khata-row__body">
                <span className="khata-row__store">{account.store?.name ?? 'A shop'}</span>
                <span className="khata-row__state">
                  {account.isSettled
                    ? 'Settled up'
                    : account.outstandingPaise > 0
                      ? 'You owe'
                      : 'In your credit'}
                </span>
              </span>

              <span
                className={`khata-row__amount numeric${
                  account.isSettled
                    ? ' khata-row__amount--settled'
                    : account.outstandingPaise > 0
                      ? ' khata-row__amount--owed'
                      : ' khata-row__amount--credit'
                }`}
              >
                {account.isSettled
                  ? formatPaise(0)
                  : formatPaise(account.outstandingPaise || account.creditPaise)}
              </span>
            </Link>
          </li>
        ))}
      </ul>

      <p className="field__hint">
        Khata is kept by the shop. Pay them directly — this page only shows what their book says.
      </p>
    </div>
  );
}

function KhataSkeleton() {
  return (
    <LoadingBlock label="Loading your khata">
      <div className="stack">
        <Skeleton width="30%" height="1.5rem" />
        <Skeleton height="6rem" radius="var(--radius-lg)" />
        {[0, 1].map((key) => (
          <Skeleton key={key} height="4rem" radius="var(--radius-lg)" />
        ))}
      </div>
    </LoadingBlock>
  );
}
