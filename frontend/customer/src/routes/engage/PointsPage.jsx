import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { endpoints } from '../../lib/endpoints.js';
import { useApiQuery } from '../../hooks/useApiQuery.js';
import { useSubmit } from '../../hooks/useSubmit.js';
import { formatPaise } from '../../lib/money.js';
import { formatWhen } from '../../lib/orderStatus.js';
import { EmptyState, ErrorState, LoadingBlock, Skeleton } from '../../components/states/States.jsx';
import { FormError } from '../../components/FormError.jsx';
import './Engage.css';

/**
 * Loyalty points (roadmap §5 P4): every shop where the customer has points,
 * and per shop the balance, rewards and an immutable history. Redeeming turns
 * points into a one-time coupon used at that shop's checkout.
 */
export function PointsPage() {
  const query = useApiQuery(() => endpoints.loyalty.mine(), []);
  const accounts = query.data?.accounts ?? [];
  if (query.loading) return <LoadingBlock label="Loading your points"><Skeleton height="8rem" radius="var(--radius-md)" /></LoadingBlock>;
  if (query.error) return <ErrorState error={query.error} onRetry={query.refetch} />;
  return (
    <div className="stack">
      <header>
        <h1>Points</h1>
        <p className="muted">Each shop runs its own points. You earn when an order is completed.</p>
      </header>
      {accounts.length === 0 ? (
        <EmptyState title="No points yet" body="Shops with a loyalty programme give points on completed orders." actionTo="/" actionLabel="Find a shop" />
      ) : (
        <ul className="prows">
          {accounts.filter((a) => a.store).map((account) => (
            <li key={account.store.id} className="prow" style={{ gridTemplateColumns: '1fr auto' }}>
              <span className="prow__body">
                <Link to={`/points/${account.store.id}`} className="prow__name">{account.store.name}</Link>
                <span className="muted">{account.lifetimeEarned} earned in total</span>
              </span>
              <strong className="numeric">{account.points} pts</strong>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function StorePointsPage() {
  const { storeId } = useParams();
  const query = useApiQuery(() => endpoints.loyalty.store(storeId), [storeId]);
  const [coupon, setCoupon] = useState(null);
  const redeem = useSubmit(async (reward) => {
    const { data } = await endpoints.loyalty.redeem(storeId, reward.id);
    setCoupon(data.coupon);
    query.setData({ loyalty: { store: data.store, program: data.program, balance: data.balance, rewards: data.rewards, history: data.history } });
  });
  const loyalty = query.data?.loyalty;
  if (query.loading) return <LoadingBlock label="Loading points"><Skeleton height="12rem" radius="var(--radius-md)" /></LoadingBlock>;
  if (query.error || !loyalty) return <ErrorState error={query.error ?? { message: 'Could not load points.' }} onRetry={query.refetch} />;

  return (
    <div className="stack">
      <header>
        <h1>{loyalty.store.name}</h1>
        <p className="muted">{loyalty.program ? loyalty.program.summary : 'This shop is not running a points programme right now.'}</p>
      </header>
      <section className="card">
        <dl className="engage__facts">
          <div><dt>Points</dt><dd className="numeric">{loyalty.balance.points}</dd></div>
          <div><dt>Worth</dt><dd className="numeric">{formatPaise(loyalty.balance.valuePaise)}</dd></div>
          <div><dt>Used so far</dt><dd className="numeric">{loyalty.balance.lifetimeRedeemed}</dd></div>
        </dl>
      </section>

      {coupon ? (
        <div className="notice notice--success" role="status">
          Your coupon <strong>{coupon.code}</strong> is ready — enter it at checkout at {loyalty.store.name}.
        </div>
      ) : null}
      <FormError error={redeem.error} />

      {loyalty.rewards.length ? (
        <section className="card stack" aria-labelledby="rewards-heading">
          <h2 id="rewards-heading" className="engage__title">Rewards</h2>
          <ul className="prows">
            {loyalty.rewards.map((reward) => (
              <li key={reward.id} className="prow" style={{ gridTemplateColumns: '1fr auto' }}>
                <span className="prow__body">
                  <strong>{reward.name}</strong>
                  <span className="muted">{reward.pointsCost} points</span>
                </span>
                <button type="button" className="btn btn--sm" disabled={!reward.canRedeem || redeem.pending} onClick={() => redeem.submit(reward)}>
                  {reward.canRedeem ? 'Redeem' : 'Not enough points'}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="card stack" aria-labelledby="history-heading">
        <h2 id="history-heading" className="engage__title">History</h2>
        {loyalty.history.length === 0 ? (
          <p className="muted">Nothing yet.</p>
        ) : (
          <ul className="prows">
            {loyalty.history.map((entry) => (
              <li key={entry.id} className="spread">
                <span>
                  {entry.label}
                  <span className="muted"> · {formatWhen(entry.at)}</span>
                  {entry.note ? <span className="muted"> — {entry.note}</span> : null}
                </span>
                <span className="numeric">{entry.points > 0 ? '+' : ''}{entry.points}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      {loyalty.store.slug ? <Link to={`/store/${loyalty.store.slug}`} className="btn btn--secondary btn--block">Go to the shop</Link> : null}
    </div>
  );
}
