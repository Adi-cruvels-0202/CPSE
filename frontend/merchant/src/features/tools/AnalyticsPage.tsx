import { Fragment, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { automationApi } from '../../api/ops';
import { useActiveStore } from '../../hooks/useStore';
import { formatPaise } from '../../lib/money';
import { ErrorState, NoStore, PageHeader, Spinner, formatDate } from '../../components/common/ui';
import './Tools.css';

/**
 * Business reports (roadmap §4 P4): sales from online orders and the counter,
 * order health, best and slow sellers, customer mix and khata. Every figure is
 * computed by the server in the store's timezone; each card shows how.
 */

const isoDay = (offset: number) => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);
const RANGES = [
  { label: 'Last 7 days', days: 7 },
  { label: 'Last 30 days', days: 30 },
  { label: 'Last 90 days', days: 90 },
];

export default function AnalyticsPage() {
  const { activeStoreId } = useActiveStore();
  const [from, setFrom] = useState(isoDay(29));
  const [to, setTo] = useState(isoDay(0));
  const query = useQuery({
    queryKey: ['analytics', activeStoreId, from, to],
    queryFn: () => automationApi.analytics(activeStoreId!, { from, to }),
    enabled: !!activeStoreId,
  });
  if (!activeStoreId) return <NoStore title="Reports" />;
  const a = query.data?.analytics;
  const maxDay = a ? Math.max(1, ...a.sales.trend.map((d) => d.ordersPaise + d.posPaise)) : 1;

  return (
    <div className="stack">
      <PageHeader title="Reports" subtitle={a ? `${formatDate(a.period.from)} – ${formatDate(a.period.to)} · ${a.period.timezone}` : undefined} />
      <div className="filters-bar">
        {RANGES.map((r) => (
          <button key={r.days} type="button" className={`btn btn-sm ${from === isoDay(r.days - 1) && to === isoDay(0) ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => { setFrom(isoDay(r.days - 1)); setTo(isoDay(0)); }}>{r.label}</button>
        ))}
        <div className="input-wrapper"><label className="input-label" htmlFor="an-from">From</label><input id="an-from" type="date" className="input-field" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></div>
        <div className="input-wrapper"><label className="input-label" htmlFor="an-to">To</label><input id="an-to" type="date" className="input-field" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></div>
      </div>

      {query.isLoading ? <Spinner large /> : query.error ? <ErrorState error={query.error} onRetry={() => query.refetch()} /> : a && (
        <>
          <div className="metric-grid">
            <Metric label="Sales" value={formatPaise(a.sales.grossSalesPaise)} hint="online + counter" />
            <Metric label="Online orders" value={`${a.sales.completedOrders}`} hint={formatPaise(a.sales.ordersRevenuePaise)} />
            <Metric label="Counter sales" value={`${a.sales.counterSales}`} hint={formatPaise(a.sales.counterSalesPaise)} />
            <Metric label="Average bill" value={formatPaise(a.sales.averageTicketPaise)} />
            <Metric label="Refunded" value={formatPaise(a.sales.refundsPaise)} />
            <Metric label="Cancelled" value={`${Math.round(a.orders.cancellationRate * 100)}%`} hint={`of ${a.orders.placed} placed`} />
            <Metric label="Time to accept" value={a.orders.medianMinutesToAccept === null ? '—' : `${a.orders.medianMinutesToAccept} min`} hint="median" />
            <Metric label="Khata owed" value={formatPaise(a.khata.outstandingPaise)} hint={`${formatPaise(a.khata.overduePaise)} overdue · ${a.khata.accountsOverdue} accounts`} />
          </div>

          <section className="card">
            <h2 style={{ fontSize: 'var(--text-base)' }}>Sales by day</h2>
            {a.sales.trend.length === 0 ? <p className="muted">No sales in this period.</p> : (
              <div className="bar-chart" role="img" aria-label="Daily sales">
                {a.sales.trend.map((d) => (
                  <div key={d.date} className="bar-chart__bar" title={`${formatDate(d.date)}: ${formatPaise(d.ordersPaise + d.posPaise)} (${d.orders} orders, ${d.sales} counter)`}
                    style={{ height: `${Math.max(2, ((d.ordersPaise + d.posPaise) / maxDay) * 100)}%` }} />
                ))}
              </div>
            )}
          </section>

          <div className="metric-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
            <section className="card">
              <h2 style={{ fontSize: 'var(--text-base)' }}>Best sellers</h2>
              {a.products.bestSellers.length === 0 ? <p className="muted">No sales yet.</p> : (
                <table className="table"><tbody>{a.products.bestSellers.map((p) => <tr key={p.productId}><td>{p.name}</td><td>{p.units} sold</td><td>{formatPaise(p.revenuePaise)}</td></tr>)}</tbody></table>
              )}
            </section>
            <section className="card">
              <h2 style={{ fontSize: 'var(--text-base)' }}>Slow movers</h2>
              <p className="tiny">In stock but sold little or nothing in this period.</p>
              {a.products.slowMovers.length === 0 ? <p className="muted">Nothing is sitting idle.</p> : (
                <table className="table"><tbody>{a.products.slowMovers.map((p) => <tr key={p.productId}><td>{p.name}</td><td>{p.unitsSold} sold</td><td>{p.onHand} in stock</td></tr>)}</tbody></table>
              )}
            </section>
            <section className="card">
              <h2 style={{ fontSize: 'var(--text-base)' }}>Missed sales</h2>
              {a.products.unavailable.length === 0 ? <p className="muted">Everything that sells is available.</p> : (
                <table className="table"><tbody>{a.products.unavailable.map((p) => <tr key={p.productId}><td>{p.name}</td><td className="tiny">{p.reason}</td></tr>)}</tbody></table>
              )}
            </section>
            <section className="card">
              <h2 style={{ fontSize: 'var(--text-base)' }}>Customers</h2>
              <dl className="kv">
                <dt>Bought in this period</dt><dd>{a.customers.buyersInPeriod}</dd>
                <dt>First-time</dt><dd>{a.customers.newInPeriod}</dd>
                <dt>Returning</dt><dd>{a.customers.returningInPeriod}</dd>
                {Object.entries(a.customers.segments).map(([k, v]) => <Fragment key={k}><dt>{k.replace(/_/g, ' ')}</dt><dd>{v}</dd></Fragment>)}
              </dl>
              <p className="tiny">Pickup {a.orders.byFulfilment.pickup} · Delivery {a.orders.byFulfilment.delivery}</p>
            </section>
          </div>
          <details className="card card-sm">
            <summary>How these numbers are counted</summary>
            <dl className="kv">{Object.entries(a.definitions).map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd className="tiny">{v}</dd></Fragment>)}</dl>
          </details>
        </>
      )}
    </div>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="metric card-sm card">
      <div className="metric__label">{label}</div>
      <div className="metric__value">{value}</div>
      {hint && <div className="tiny">{hint}</div>}
    </div>
  );
}
