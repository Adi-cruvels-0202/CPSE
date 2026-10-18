import { useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { intelligenceApi, type AssistantReply, type Proposal, type StockItem } from '../../api/ops';
import { errorMessage } from '../../api/client';
import { useActiveStore } from '../../hooks/useStore';
import { useToast } from '../../hooks/useToast';
import { formatPaise } from '../../lib/money';
import { EmptyState, ErrorState, NoStore, PageHeader, Spinner, SubTabs } from '../../components/common/ui';
import { IconTrendingUp } from '../../components/icons/Icons';
import './Tools.css';

/**
 * Insights (roadmap §4 Phase D/E): demand and stock health, an assistant that
 * answers from the shop's own numbers and turns instructions into changes you
 * confirm, and area price benchmarks that never reveal another shop. Nothing
 * here changes anything until you press Confirm.
 */
type Tab = 'stock' | 'ask' | 'area';

export default function InsightsPage() {
  const { activeStoreId } = useActiveStore();
  const [tab, setTab] = useState<Tab>('stock');
  if (!activeStoreId) return <NoStore title="Insights" />;
  return (
    <div>
      <PageHeader title="Insights" subtitle="Worked out from your own sales — every number says how." />
      <SubTabs value={tab} onChange={setTab} options={[{ value: 'stock', label: 'Stock & demand' }, { value: 'ask', label: 'Ask' }, { value: 'area', label: 'Your area' }]} />
      {tab === 'stock' && <Stock storeId={activeStoreId} />}
      {tab === 'ask' && <Ask storeId={activeStoreId} />}
      {tab === 'area' && <Area storeId={activeStoreId} />}
    </div>
  );
}

const HEALTH: Record<StockItem['health']['status'], { label: string; badge: string }> = {
  stockout: { label: 'Out while selling', badge: 'badge-danger' },
  at_risk: { label: 'Running out', badge: 'badge-warning' },
  overstock: { label: 'Overstocked', badge: 'badge-info' },
  slow: { label: 'Not selling', badge: 'badge-neutral' },
  healthy: { label: 'Healthy', badge: 'badge-success' },
  unknown: { label: 'Not enough data', badge: 'badge-neutral' },
  untracked: { label: 'Not counted', badge: 'badge-neutral' },
};

function Stock({ storeId }: { storeId: string }) {
  const [leadDays, setLeadDays] = useState(7);
  const query = useQuery({ queryKey: ['intel-stock', storeId, leadDays], queryFn: () => intelligenceApi.stock(storeId, { leadDays }) });
  if (query.isLoading) return <Spinner large />;
  if (query.error) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  const stock = query.data!.stock;
  return (
    <div className="stack">
      <div className="filters-bar">
        <label className="input-label" htmlFor="lead">Restock takes</label>
        <select id="lead" className="input-field" style={{ maxWidth: 140 }} value={leadDays} onChange={(e) => setLeadDays(Number(e.target.value))}>
          {[3, 7, 14, 21].map((d) => <option key={d} value={d}>{d} days</option>)}
        </select>
        <Link to="/suggestions" className="btn btn-secondary btn-sm">Make a purchase list</Link>
      </div>
      {stock.items.length === 0 ? <EmptyState icon={<IconTrendingUp size={32} />} title="No products yet" description="Add products to see demand and stock health." /> : (
        <div className="table-container table-scroll">
          <table className="table">
            <thead><tr><th>Product</th><th>Stock</th><th>Health</th><th>Next {stock.horizonDays} days</th><th>Reorder</th></tr></thead>
            <tbody>{stock.items.map((i) => (
              <tr key={i.variantId}>
                <td>{i.name}<div className="tiny">{i.soldLast30} sold in 30 days</div></td>
                <td>{i.available ?? '—'}</td>
                <td><span className={`badge ${HEALTH[i.health.status].badge}`}>{HEALTH[i.health.status].label}</span><div className="tiny">{i.health.note}</div></td>
                <td>{i.forecast.nextDaysUnits === null ? <span className="tiny">{i.forecast.reason}</span> : <>~{i.forecast.nextDaysUnits} <span className="tiny">({i.forecast.confidence} confidence)</span></>}</td>
                <td>{i.proposedReorderQuantity ?? '—'}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <p className="tiny">{stock.method}</p>
    </div>
  );
}

// ── Ask ─────────────────────────────────────────────────────────────────────

type SpeechCtor = new () => { lang: string; interimResults: boolean; onresult: ((e: any) => void) | null; onerror: ((e: any) => void) | null; onend: (() => void) | null; start: () => void };
const speechCtor = (): SpeechCtor | null => (typeof window === 'undefined' ? null : ((window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition ?? null));

/** A mic button when the browser can transcribe speech; nothing otherwise. */
export function SpeakButton({ onText, label = 'Speak' }: { onText: (text: string) => void; label?: string }) {
  const Ctor = speechCtor();
  const [listening, setListening] = useState(false);
  if (!Ctor) return null;
  const start = () => {
    const recognition = new Ctor();
    recognition.lang = 'en-IN';
    recognition.interimResults = false;
    recognition.onresult = (event) => onText(event.results[0][0].transcript);
    recognition.onerror = () => setListening(false);
    recognition.onend = () => setListening(false);
    setListening(true);
    recognition.start();
  };
  return <button type="button" className="btn btn-secondary" onClick={start} disabled={listening} aria-label={label}>{listening ? 'Listening…' : '🎤 ' + label}</button>;
}

function Ask({ storeId }: { storeId: string }) {
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [question, setQuestion] = useState('');
  const [history, setHistory] = useState<{ question: string; reply: AssistantReply; applied?: boolean }[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const ask = useMutation({
    mutationFn: (q: string) => intelligenceApi.ask(storeId, q),
    onSuccess: ({ reply }, q) => { setHistory((h) => [{ question: q, reply }, ...h]); setQuestion(''); },
    onError: (err) => showToast(errorMessage(err), 'error'),
  });
  const apply = useMutation({
    mutationFn: ({ proposal }: { proposal: Proposal; index: number }) => intelligenceApi.apply(storeId, proposal),
    onSuccess: (_data, { index, proposal }) => {
      setHistory((h) => h.map((entry, i) => (i === index ? { ...entry, applied: true } : entry)));
      queryClient.invalidateQueries();
      showToast(`Done: ${proposal.summary}`, 'success');
    },
    onError: (err) => showToast(errorMessage(err), 'error'),
  });
  const submit = (event: FormEvent) => { event.preventDefault(); if (question.trim()) ask.mutate(question.trim()); };

  return (
    <div className="stack">
      <form className="filters-bar" onSubmit={submit}>
        <input ref={input} className="input-field" style={{ flex: 1, minWidth: 220 }} aria-label="Ask or instruct" placeholder="How much did I sell this week?  ·  add 10 rice 1 kg" maxLength={500} value={question} onChange={(e) => setQuestion(e.target.value)} />
        <SpeakButton onText={(t) => { setQuestion(t); input.current?.focus(); }} />
        <button type="submit" className="btn btn-primary" disabled={ask.isPending || !question.trim()}>{ask.isPending ? 'Thinking…' : 'Ask'}</button>
      </form>
      <p className="tiny">Answers come from your own records. Instructions become a change you confirm — nothing happens until you press Confirm.</p>
      {history.map((entry, index) => (
        <section key={index} className="card" aria-label={entry.question}>
          <p className="tiny">You: {entry.question}</p>
          {entry.reply.answer && <p style={{ margin: 0 }}>{entry.reply.answer}</p>}
          {entry.reply.kind === 'help' && <ul className="tiny">{entry.reply.examples?.map((e) => <li key={e}>{e}</li>)}</ul>}
          {entry.reply.problem && <div className="alert-strip alert-strip-warning">{entry.reply.problem}{entry.reply.options?.length ? ` Options: ${entry.reply.options.map((o) => o.name).join(', ')}.` : ''}</div>}
          {entry.reply.understood === false && <p className="tiny">Try: {entry.reply.examples?.join(' · ') ?? 'add 10 rice 1 kg'}</p>}
          {entry.reply.proposal && (
            <div className="alert-strip alert-strip-info" style={{ display: 'block', marginTop: 'var(--space-2)' }}>
              <strong>{entry.reply.proposal.summary}</strong>
              {entry.reply.proposal.warning && <div>{entry.reply.proposal.warning}</div>}
              <div style={{ marginTop: 'var(--space-2)' }}>
                {entry.applied ? <span className="badge badge-success">Done</span> : (
                  <button type="button" className="btn btn-primary btn-sm" disabled={apply.isPending} onClick={() => apply.mutate({ proposal: entry.reply.proposal!, index })}>Confirm</button>
                )}
              </div>
            </div>
          )}
          {entry.reply.actions?.map((a) => <Link key={a.to} to={a.to} className="btn btn-ghost btn-sm">{a.text}</Link>)}
          {entry.reply.source && <p className="tiny">From: {entry.reply.source}</p>}
        </section>
      ))}
    </div>
  );
}

// ── Area ────────────────────────────────────────────────────────────────────

const POSITION = { below_most: 'Lower than most', typical: 'In the usual range', above_most: 'Higher than most' } as const;

function Area({ storeId }: { storeId: string }) {
  const query = useQuery({ queryKey: ['intel-area', storeId], queryFn: () => intelligenceApi.area(storeId) });
  if (query.isLoading) return <Spinner large />;
  if (query.error) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  const area = query.data!.area;
  return (
    <div className="stack">
      <p className="tiny">{area.note}</p>
      {area.benchmarks.length > 0 && (
        <div className="table-container">
          <table className="table">
            <thead><tr><th>Product</th><th>Yours</th><th>Area (middle half)</th><th /></tr></thead>
            <tbody>{area.benchmarks.map((b) => (
              <tr key={b.variantId}>
                <td>{b.name}<div className="tiny">{b.basis === 'per_kg' ? 'per kg' : 'per pack'} · {b.area.stores} shops</div></td>
                <td>{formatPaise(b.yourPricePaise)}</td>
                <td>{formatPaise(b.area.p25)} – {formatPaise(b.area.p75)} <span className="tiny">(median {formatPaise(b.area.median)})</span></td>
                <td><span className={`badge ${b.position === 'typical' ? 'badge-success' : 'badge-warning'}`}>{POSITION[b.position]}</span></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {area.popularNearby.length > 0 && (
        <section className="card">
          <h2 style={{ fontSize: 'var(--text-base)' }}>Selling nearby, not in your shop</h2>
          <ul>{area.popularNearby.map((p) => <li key={p.name}>{p.name} <span className="tiny">({p.shops} shops)</span></li>)}</ul>
        </section>
      )}
    </div>
  );
}
