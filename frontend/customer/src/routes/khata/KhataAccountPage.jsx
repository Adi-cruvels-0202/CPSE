import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { endpoints } from '../../lib/endpoints.js';
import { useApiQuery } from '../../hooks/useApiQuery.js';
import { formatPaise } from '../../lib/money.js';
import { formatDate } from '../../lib/orderStatus.js';
import { EmptyState, ErrorState, LoadingBlock, Skeleton } from '../../components/states/States.jsx';
import './Khata.css';

/**
 * One khata account — checklist 11.15.
 *
 * Two views of the same ledger. The default is "everything", which is what someone
 * checking a balance wants. A period gives the statement: the balance carried in,
 * what happened inside it, and the balance carried out — which is what someone
 * arguing about a figure with the shop wants.
 *
 * Both sets of numbers come from the server, which computes them in SQL from the
 * same ledger that maintains the balance (backend D39). Adding entries up here
 * would eventually disagree with the figure the shop acts on.
 */
const PERIODS = [
  { key: 'all', label: 'Everything', months: null },
  { key: '1m', label: 'Last month', months: 1 },
  { key: '3m', label: 'Last 3 months', months: 3 },
];

export function KhataAccountPage() {
  const { accountId } = useParams();
  const [period, setPeriod] = useState('all');

  const chosen = PERIODS.find((entry) => entry.key === period) ?? PERIODS[0];

  /**
   * Computed once per chosen period, not per render.
   *
   * `monthsAgo` reads the clock, so calling it inline produced a different string
   * every render — and since it is a dependency of the query below, every render
   * asked the server again. That is an infinite fetch loop, and it only showed up
   * as a flaky test before it showed up as load.
   */
  const from = useMemo(() => (chosen.months ? monthsAgo(chosen.months) : null), [chosen.months]);

  // The statement endpoint answers both: with no period it is the whole ledger,
  // so there is one call rather than two code paths.
  const { data, meta, loading, error, refetch } = useApiQuery(
    () => endpoints.khata.statement(accountId, { ...(from ? { from } : {}), limit: 50 }),
    [accountId, from],
  );

  if (loading) return <AccountSkeleton />;

  if (error || !data?.account) {
    return (
      <ErrorState
        error={error ?? { message: 'That khata could not be loaded.' }}
        onRetry={error?.status === 404 ? undefined : refetch}
        title={error?.status === 404 ? 'That khata is not here' : undefined}
      />
    );
  }

  const { account, totals, transactions } = data;
  const owed = account.outstandingPaise > 0;

  return (
    <div className="stack">
      <Link to="/khata" className="product__back">
        <ChevronLeft /> All khata
      </Link>

      <header className="stack" style={{ gap: 'var(--space-1)' }}>
        <h1>{account.store?.name ?? 'Khata'}</h1>
        <p className="muted">Kept by the shop · you pay them directly</p>
      </header>

      <section className="khata__headline" aria-label="What you owe now">
        <span className="khata__headline-label">
          {account.isSettled ? 'Settled up' : owed ? 'You owe' : 'In your credit'}
        </span>
        <span className="khata__headline-amount numeric">
          {formatPaise(account.isSettled ? 0 : account.outstandingPaise || account.creditPaise)}
        </span>
      </section>

      <div className="catalogue__filter" role="group" aria-label="Statement period">
        {PERIODS.map((entry) => (
          <button
            key={entry.key}
            type="button"
            className={`chip${period === entry.key ? ' chip--active' : ''}`}
            onClick={() => setPeriod(entry.key)}
            aria-pressed={period === entry.key}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <section className="card stack" aria-labelledby="statement-heading">
        <h2 id="statement-heading" className="order__section-title">
          {chosen.months ? `Last ${chosen.months === 1 ? 'month' : `${chosen.months} months`}` : 'Whole history'}
        </h2>

        <dl className="khata__totals">
          <Row label="Opening balance">{formatPaise(totals.openingPaise)}</Row>
          <Row label="Bought on credit">{formatPaise(totals.debitPaise)}</Row>
          <Row label="Paid back">−{formatPaise(totals.creditPaise)}</Row>
          <Row label="Closing balance" strong>
            {formatPaise(totals.closingPaise)}
          </Row>
        </dl>
      </section>

      {transactions.length === 0 ? (
        <EmptyState
          title="Nothing in this period"
          body={chosen.months ? 'Try a longer period, or view the whole history.' : undefined}
        />
      ) : (
        <section className="card stack" aria-labelledby="entries-heading">
          <h2 id="entries-heading" className="order__section-title">
            {totals.transactionCount} {totals.transactionCount === 1 ? 'entry' : 'entries'}
          </h2>

          <ul className="khata__entries">
            {transactions.map((entry) => (
              <li key={entry.id} className="khata-entry">
                <span className="khata-entry__body">
                  <span className="khata-entry__what">
                    {entry.description ?? (entry.type === 'debit' ? 'Bought on credit' : 'Payment')}
                  </span>
                  <span className="khata-entry__when">{formatDate(entry.occurredAt)}</span>
                </span>

                {entry.orderId ? (
                  <Link to={`/orders/${entry.orderId}`} className="khata-entry__order">
                    Order
                  </Link>
                ) : null}

                {/* Signed by the server, so the sign is never worked out here. */}
                <span
                  className={`khata-entry__amount numeric${
                    entry.signedAmountPaise > 0 ? ' khata-entry__amount--debit' : ' khata-entry__amount--credit'
                  }`}
                >
                  {entry.signedAmountPaise > 0 ? '+' : '−'}
                  {formatPaise(entry.amountPaise)}
                </span>
              </li>
            ))}
          </ul>

          {meta?.hasNextPage ? (
            <p className="field__hint">
              Showing the most recent {transactions.length} of {meta.total}. Choose a period to narrow
              it down.
            </p>
          ) : null}
        </section>
      )}
    </div>
  );
}

/** An ISO timestamp N whole months before now, for the statement bound. */
function monthsAgo(months) {
  const date = new Date();
  date.setMonth(date.getMonth() - months);
  return date.toISOString();
}

function Row({ label, children, strong }) {
  return (
    <div className={`order__row${strong ? ' order__row--total' : ''}`}>
      <dt>{label}</dt>
      <dd className="numeric">{children}</dd>
    </div>
  );
}

function ChevronLeft() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M15 6l-6 6 6 6" />
    </svg>
  );
}

function AccountSkeleton() {
  return (
    <LoadingBlock label="Loading the khata">
      <div className="stack">
        <Skeleton width="30%" height="1rem" />
        <Skeleton width="55%" height="1.5rem" />
        <Skeleton height="6rem" radius="var(--radius-lg)" />
        <Skeleton height="10rem" radius="var(--radius-lg)" />
      </div>
    </LoadingBlock>
  );
}
