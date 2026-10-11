import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { productApi } from '../../api/endpoints';
import { couponApi, loyaltyApi, offerApi, type Batch, type Coupon, type LoyaltyProgram, type Reward } from '../../api/ops';
import { errorMessage } from '../../api/client';
import { useActiveStore } from '../../hooks/useStore';
import { useToast } from '../../hooks/useToast';
import { formatPaise, rupeesToPaise } from '../../lib/money';
import { EmptyState, ErrorState, Modal, NoStore, PageHeader, Spinner, SubTabs, formatDate, formatDateTime } from '../../components/common/ui';
import { IconPlus, IconTag } from '../../components/icons/Icons';
import './Tools.css';

/**
 * Loyalty, coupons and local offers (roadmap §4 P3, Phase C, §5 P4). The
 * server enforces every rule at checkout — windows, usage limits, audiences,
 * stacking, offer stock and expiry cut-offs — so a stale screen can never give
 * away more than was set up.
 */
export default function PromotionsPage() {
  const { activeStoreId } = useActiveStore();
  const [tab, setTab] = useState<'loyalty' | 'coupons' | 'offers'>('loyalty');
  if (!activeStoreId) return <NoStore title="Loyalty, coupons & offers" />;
  return (
    <div>
      <PageHeader title="Loyalty, coupons & offers" subtitle="Reasons for customers to come back — on your terms." />
      <SubTabs value={tab} options={[{ value: 'loyalty', label: 'Loyalty points' }, { value: 'coupons', label: 'Coupons' }, { value: 'offers', label: 'Local offers' }]} onChange={setTab} />
      {tab === 'loyalty' && <Loyalty storeId={activeStoreId} />}
      {tab === 'coupons' && <Coupons storeId={activeStoreId} />}
      {tab === 'offers' && <Offers storeId={activeStoreId} />}
    </div>
  );
}

// ── Loyalty ─────────────────────────────────────────────────────────────────

function Loyalty({ storeId }: { storeId: string }) {
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const program = useQuery({ queryKey: ['loyalty', storeId], queryFn: () => loyaltyApi.program(storeId) });
  const rewards = useQuery({ queryKey: ['rewards', storeId], queryFn: () => loyaltyApi.rewards(storeId) });
  const members = useQuery({ queryKey: ['loyalty-members', storeId], queryFn: () => loyaltyApi.members(storeId, { limit: 10 }) });
  const [form, setForm] = useState<Partial<LoyaltyProgram>>({});
  const [rewardModal, setRewardModal] = useState(false);
  useEffect(() => {
    if (program.data) setForm(program.data.program ?? { isActive: false, earnPointsPer100: 1, pointValuePaise: 100, minRedeemPoints: 0, maxRedeemPercent: 50, welcomeBonusPoints: 0, minOrderPaiseToEarn: 0, pointsExpireDays: null });
  }, [program.data]);

  const save = useMutation({
    mutationFn: () => loyaltyApi.saveProgram(storeId, {
      isActive: form.isActive, earnPointsPer100: form.earnPointsPer100, pointValuePaise: form.pointValuePaise, minRedeemPoints: form.minRedeemPoints,
      maxRedeemPercent: form.maxRedeemPercent, welcomeBonusPoints: form.welcomeBonusPoints, minOrderPaiseToEarn: form.minOrderPaiseToEarn, pointsExpireDays: form.pointsExpireDays ?? null,
    }),
    onSuccess: (data) => { queryClient.setQueryData(['loyalty', storeId], data); showToast('Loyalty programme saved', 'success'); },
    onError: (err) => showToast(errorMessage(err), 'error'),
  });
  const toggleReward = async (reward: Reward) => {
    try { await loyaltyApi.updateReward(storeId, reward.id, { isActive: !reward.isActive }); queryClient.invalidateQueries({ queryKey: ['rewards', storeId] }); }
    catch (err) { showToast(errorMessage(err), 'error'); }
  };
  if (program.isLoading) return <Spinner large />;
  if (program.error) return <ErrorState error={program.error} onRetry={() => program.refetch()} />;
  const num = (key: keyof LoyaltyProgram, label: string, hint?: string) => (
    <div className="input-wrapper">
      <label className="input-label" htmlFor={`loy-${key}`}>{label}</label>
      <input id={`loy-${key}`} type="number" min={0} className="input-field" value={(form[key] as number | null) ?? ''}
        onChange={(e) => setForm({ ...form, [key]: e.target.value === '' ? null : Number(e.target.value) })} />
      {hint && <span className="tiny">{hint}</span>}
    </div>
  );

  return (
    <div className="stack">
      <form className="card form-grid" onSubmit={(e: FormEvent) => { e.preventDefault(); save.mutate(); }}>
        <label style={{ display: 'flex', gap: 'var(--space-2)', fontWeight: 600 }}>
          <input type="checkbox" checked={!!form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} /> Loyalty programme is running
        </label>
        <div className="form-row">{num('earnPointsPer100', 'Points per ₹100 spent')}{num('pointValuePaise', 'Value of 1 point (paise)', '100 = ₹1')}</div>
        <div className="form-row">{num('maxRedeemPercent', 'Max % of an order paid with points')}{num('minRedeemPoints', 'Minimum points to redeem')}</div>
        <div className="form-row">{num('welcomeBonusPoints', 'Welcome bonus on first order')}{num('pointsExpireDays', 'Points expire after (days, empty = never)')}</div>
        {program.data?.program && <p className="tiny">{program.data.program.summary} Points are earned when an order is completed, and returned if a redeeming order is cancelled.</p>}
        <button type="submit" className="btn btn-primary" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save programme'}</button>
      </form>

      <section className="card">
        <div className="row-between"><h2 style={{ fontSize: 'var(--text-base)' }}>Rewards</h2><button type="button" className="btn btn-secondary btn-sm" onClick={() => setRewardModal(true)}><IconPlus size={14} /> Add reward</button></div>
        {rewards.isLoading ? <Spinner /> : rewards.error ? <ErrorState error={rewards.error} /> : (rewards.data?.rewards ?? []).length === 0 ? <p className="muted">No rewards yet. Customers trade points for a reward, which becomes a one-time coupon.</p> : (
          <ul className="stack" style={{ listStyle: 'none', padding: 0 }}>
            {rewards.data!.rewards.map((r) => (
              <li key={r.id} className="row-between">
                <span>{r.name} — <strong>{r.pointsCost} points</strong> <span className="tiny">({r.discountType === 'flat' ? formatPaise(r.amountOffPaise) + ' off' : r.discountType === 'percent' ? `${r.percentOff}% off` : 'free delivery'})</span></span>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => toggleReward(r)}>{r.isActive ? 'Pause' : 'Resume'}</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h2 style={{ fontSize: 'var(--text-base)' }}>Top members</h2>
        {members.isLoading ? <Spinner /> : (members.data?.data.members ?? []).length === 0 ? <p className="muted">Nobody has points yet.</p> : (
          <table className="table"><thead><tr><th>Customer</th><th>Points</th><th>Earned</th><th>Used</th></tr></thead>
            <tbody>{members.data!.data.members.map((m) => <tr key={m.customerId}><td>{m.name ?? '—'}</td><td>{m.points}</td><td>{m.lifetimeEarned}</td><td>{m.lifetimeRedeemed}</td></tr>)}</tbody></table>
        )}
      </section>
      {rewardModal && <RewardModal storeId={storeId} onClose={() => setRewardModal(false)} />}
    </div>
  );
}

function RewardModal({ storeId, onClose }: { storeId: string; onClose: () => void }) {
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [points, setPoints] = useState('100');
  const [type, setType] = useState<'flat' | 'percent' | 'free_delivery'>('flat');
  const [value, setValue] = useState('');
  const create = useMutation({
    mutationFn: () => loyaltyApi.createReward(storeId, {
      name: name.trim(), pointsCost: Number(points), discountType: type,
      ...(type === 'flat' ? { amountOffPaise: rupeesToPaise(value) } : type === 'percent' ? { percentOff: Number(value) } : {}),
    }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['rewards', storeId] }); showToast('Reward added', 'success'); onClose(); },
    onError: (err) => showToast(errorMessage(err), 'error'),
  });
  return (
    <Modal title="Add a reward" onClose={onClose} busy={create.isPending}
      footer={<><button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button><button type="submit" form="reward-form" className="btn btn-primary" disabled={create.isPending}>Add</button></>}>
      <form id="reward-form" className="form-grid" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
        <div className="input-wrapper"><label className="input-label" htmlFor="rw-name">Name</label><input id="rw-name" className="input-field" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="₹50 off your next order" /></div>
        <div className="form-row">
          <div className="input-wrapper"><label className="input-label" htmlFor="rw-pts">Points needed</label><input id="rw-pts" type="number" min={1} className="input-field" value={points} onChange={(e) => setPoints(e.target.value)} /></div>
          <div className="input-wrapper"><label className="input-label" htmlFor="rw-type">Reward</label>
            <select id="rw-type" className="input-field" value={type} onChange={(e) => setType(e.target.value as typeof type)}><option value="flat">Amount off</option><option value="percent">Percent off</option><option value="free_delivery">Free delivery</option></select></div>
        </div>
        {type !== 'free_delivery' && <div className="input-wrapper"><label className="input-label" htmlFor="rw-val">{type === 'flat' ? 'Amount (₹)' : 'Percent'}</label><input id="rw-val" className="input-field" inputMode="decimal" required value={value} onChange={(e) => setValue(e.target.value)} /></div>}
      </form>
    </Modal>
  );
}

// ── Coupons ─────────────────────────────────────────────────────────────────

const AUDIENCES: Record<string, string> = {
  all: 'Everyone', new: 'First order at your shop', returning: 'Customers who ordered before', loyal: 'Loyal customers', followers: 'People who saved your shop', birthday: 'Birthday week (with consent)',
};

function Coupons({ storeId }: { storeId: string }) {
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ['coupons', storeId], queryFn: () => couponApi.list(storeId) });
  const [creating, setCreating] = useState(false);
  const toggle = async (c: Coupon) => {
    try { await couponApi.update(storeId, c.id, { isActive: !c.isActive }); queryClient.invalidateQueries({ queryKey: ['coupons', storeId] }); }
    catch (err) { showToast(errorMessage(err), 'error'); }
  };
  const coupons = query.data?.coupons ?? [];
  return (
    <>
      <div className="filters-bar"><button type="button" className="btn btn-primary" onClick={() => setCreating(true)}><IconPlus size={16} /> New coupon</button></div>
      {query.isLoading ? <Spinner large /> : query.error ? <ErrorState error={query.error} onRetry={() => query.refetch()} /> : coupons.length === 0 ? (
        <EmptyState icon={<IconTag size={32} />} title="No coupons yet" description="A code customers enter at checkout. You choose who can use it and how often." />
      ) : (
        <div className="table-container">
          <table className="table">
            <thead><tr><th>Code</th><th>Discount</th><th>Who</th><th>Valid</th><th>Used</th><th /></tr></thead>
            <tbody>
              {coupons.map((c) => (
                <tr key={c.id}>
                  <td><code className="mono">{c.code}</code><div className="tiny">{c.title}</div></td>
                  <td>{c.discountType === 'percent' ? `${c.percentOff}%` : c.discountType === 'flat' ? formatPaise(c.amountOffPaise) : 'Free delivery'}{c.minOrderPaise ? <div className="tiny">min {formatPaise(c.minOrderPaise)}</div> : null}</td>
                  <td className="tiny">{AUDIENCES[c.audience]}</td>
                  <td className="tiny">{formatDate(c.startsAt)} – {c.endsAt ? formatDate(c.endsAt) : 'no end'}</td>
                  <td>{c.timesUsed}{c.maxUses ? ` / ${c.maxUses}` : ''}<div className="tiny">{formatPaise(c.totalDiscountPaise)} given</div></td>
                  <td><button type="button" className="btn btn-ghost btn-sm" onClick={() => toggle(c)}>{c.isActive ? 'Pause' : 'Resume'}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {creating && <CouponModal storeId={storeId} onClose={() => setCreating(false)} />}
    </>
  );
}

function CouponModal({ storeId, onClose }: { storeId: string; onClose: () => void }) {
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ code: '', title: '', discountType: 'percent', value: '10', maxDiscount: '', minOrder: '', endsAt: '', maxUses: '', perCustomer: '1', audience: 'all', stackable: false });
  const create = useMutation({
    mutationFn: () => couponApi.create(storeId, {
      code: form.code.trim(), title: form.title.trim() || form.code.trim(), discountType: form.discountType,
      ...(form.discountType === 'percent' ? { percentOff: Number(form.value) } : form.discountType === 'flat' ? { amountOffPaise: rupeesToPaise(form.value) } : {}),
      maxDiscountPaise: form.maxDiscount ? rupeesToPaise(form.maxDiscount) : null,
      minOrderPaise: form.minOrder ? rupeesToPaise(form.minOrder) ?? 0 : 0,
      endsAt: form.endsAt ? new Date(`${form.endsAt}T23:59:59`).toISOString() : null,
      maxUses: form.maxUses ? Number(form.maxUses) : null,
      maxUsesPerCustomer: Number(form.perCustomer) || 1,
      audience: form.audience,
      stackableWithLoyalty: form.stackable,
    }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['coupons', storeId] }); showToast('Coupon created', 'success'); onClose(); },
    onError: (err) => showToast(errorMessage(err), 'error'),
  });
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value });
  return (
    <Modal title="New coupon" onClose={onClose} busy={create.isPending}
      footer={<><button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button><button type="submit" form="coupon-form" className="btn btn-primary" disabled={create.isPending}>Create</button></>}>
      <form id="coupon-form" className="form-grid" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
        <div className="form-row">
          <div className="input-wrapper"><label className="input-label" htmlFor="cp-code">Code</label><input id="cp-code" className="input-field" required pattern="[A-Za-z0-9_\-]{3,30}" value={form.code} onChange={set('code')} placeholder="DIWALI10" /></div>
          <div className="input-wrapper"><label className="input-label" htmlFor="cp-title">Title</label><input id="cp-title" className="input-field" maxLength={80} value={form.title} onChange={set('title')} /></div>
        </div>
        <div className="form-row">
          <div className="input-wrapper"><label className="input-label" htmlFor="cp-type">Discount</label>
            <select id="cp-type" className="input-field" value={form.discountType} onChange={set('discountType')}><option value="percent">Percent off</option><option value="flat">Amount off</option><option value="free_delivery">Free delivery</option></select></div>
          {form.discountType !== 'free_delivery' && <div className="input-wrapper"><label className="input-label" htmlFor="cp-val">{form.discountType === 'percent' ? 'Percent' : 'Amount ₹'}</label><input id="cp-val" className="input-field" inputMode="decimal" required value={form.value} onChange={set('value')} /></div>}
        </div>
        <div className="form-row">
          {form.discountType === 'percent' && <div className="input-wrapper"><label className="input-label" htmlFor="cp-max">At most ₹ off</label><input id="cp-max" className="input-field" inputMode="decimal" value={form.maxDiscount} onChange={set('maxDiscount')} /></div>}
          <div className="input-wrapper"><label className="input-label" htmlFor="cp-min">Minimum order ₹</label><input id="cp-min" className="input-field" inputMode="decimal" value={form.minOrder} onChange={set('minOrder')} /></div>
        </div>
        <div className="input-wrapper"><label className="input-label" htmlFor="cp-aud">Who can use it</label>
          <select id="cp-aud" className="input-field" value={form.audience} onChange={set('audience')}>{Object.entries(AUDIENCES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        <div className="form-row">
          <div className="input-wrapper"><label className="input-label" htmlFor="cp-end">Last day</label><input id="cp-end" type="date" className="input-field" value={form.endsAt} onChange={set('endsAt')} /></div>
          <div className="input-wrapper"><label className="input-label" htmlFor="cp-uses">Total uses (empty = no limit)</label><input id="cp-uses" type="number" min={1} className="input-field" value={form.maxUses} onChange={set('maxUses')} /></div>
        </div>
        <div className="input-wrapper"><label className="input-label" htmlFor="cp-per">Uses per customer</label><input id="cp-per" type="number" min={1} className="input-field" value={form.perCustomer} onChange={set('perCustomer')} /></div>
        <label style={{ display: 'flex', gap: 'var(--space-2)' }}><input type="checkbox" checked={form.stackable} onChange={(e) => setForm({ ...form, stackable: e.target.checked })} />Can be combined with loyalty points</label>
      </form>
    </Modal>
  );
}

// ── Local offers ────────────────────────────────────────────────────────────

function Offers({ storeId }: { storeId: string }) {
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<'live' | 'scheduled' | 'ended' | 'all'>('live');
  const [creating, setCreating] = useState(false);
  const query = useQuery({ queryKey: ['offers', storeId, status], queryFn: () => offerApi.list(storeId, status) });
  const end = useMutation({
    mutationFn: (id: string) => offerApi.end(storeId, id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['offers', storeId] }); showToast('Offer ended', 'info'); },
    onError: (err) => showToast(errorMessage(err), 'error'),
  });
  const offers = query.data?.offers ?? [];
  return (
    <>
      <div className="filters-bar">
        <SubTabs value={status} options={[{ value: 'live', label: 'Live' }, { value: 'scheduled', label: 'Scheduled' }, { value: 'ended', label: 'Ended' }, { value: 'all', label: 'All' }]} onChange={setStatus} />
        <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}><IconPlus size={16} /> New offer</button>
      </div>
      <p className="tiny" style={{ marginBottom: 'var(--space-3)' }}>Offers show to customers nearby. They stop by themselves when the period ends, the offer stock sells out, or the batch reaches its safety cut-off. For an expiry clearance, start from Batches & expiry.</p>
      {query.isLoading ? <Spinner large /> : query.error ? <ErrorState error={query.error} onRetry={() => query.refetch()} /> : offers.length === 0 ? (
        <EmptyState icon={<IconTag size={32} />} title="No offers here" description="Put a product on offer for nearby customers." />
      ) : (
        <div className="table-container">
          <table className="table">
            <thead><tr><th>Offer</th><th>Price</th><th>Sold</th><th>Ends</th><th>Status</th><th /></tr></thead>
            <tbody>
              {offers.map((o) => (
                <tr key={o.id}>
                  <td>{o.title}<div className="tiny">{o.productName}{o.variantName && o.variantName !== 'Default' ? ` (${o.variantName})` : ''} · {o.radiusKm} km</div></td>
                  <td>{formatPaise(o.offerPricePaise)} <span className="tiny" style={{ textDecoration: 'line-through' }}>{formatPaise(o.listPricePaise)}</span></td>
                  <td>{o.quantitySold}{o.quantityLimit ? ` / ${o.quantityLimit}` : ''}</td>
                  <td className="tiny">{formatDateTime(o.endsAt)}{o.batchExpiresOn ? <div>batch expires {formatDate(o.batchExpiresOn)}</div> : null}</td>
                  <td><span className={`badge ${o.status === 'live' ? 'badge-success' : o.status === 'scheduled' ? 'badge-info' : 'badge-neutral'}`}>{o.status}</span>{o.endReasonLabel ? <div className="tiny">{o.endReasonLabel}</div> : null}</td>
                  <td>{o.status !== 'ended' && <button type="button" className="btn btn-ghost btn-sm" onClick={() => end.mutate(o.id)} disabled={end.isPending}>End now</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {creating && <OfferForm storeId={storeId} batch={null} onClose={() => setCreating(false)} />}
    </>
  );
}

export function OfferForm({ storeId, batch, onClose }: { storeId: string; batch: Batch | null; onClose: () => void }) {
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const products = useQuery({ queryKey: ['products-all', storeId], queryFn: () => productApi.all(storeId), enabled: !batch });
  const defaultEnd = batch?.expiresOn ?? new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
  const [variantId, setVariantId] = useState(batch?.variantId ?? '');
  const [title, setTitle] = useState(batch ? `Clearance: ${batch.productName ?? ''}`.slice(0, 80) : '');
  const [price, setPrice] = useState('');
  const [endsOn, setEndsOn] = useState(defaultEnd);
  const [radius, setRadius] = useState('5');
  const [cutoff, setCutoff] = useState('1');
  const [limit, setLimit] = useState(batch ? String(batch.quantityRemaining) : '');
  const variants = useMemo(() => (products.data ?? []).filter((p) => p.isActive).flatMap((p) => p.variants.filter((v) => v.isActive).map((v) => ({ id: v.id, label: `${p.name}${v.name !== 'Default' ? ` (${v.name})` : ''} — ${formatPaise(v.pricePaise)}` }))), [products.data]);

  const create = useMutation({
    mutationFn: () => offerApi.create(storeId, {
      kind: batch ? 'expiry' : 'promotion',
      variantId,
      ...(batch ? { batchId: batch.id, expiryCutoffDays: Number(cutoff) || 0 } : {}),
      title: title.trim(),
      offerPricePaise: rupeesToPaise(price),
      endsAt: new Date(`${endsOn}T23:59:59`).toISOString(),
      radiusKm: Number(radius) || 5,
      ...(limit ? { quantityLimit: Number(limit) } : {}),
    }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['offers', storeId] }); showToast('Offer is live for nearby customers', 'success'); onClose(); },
    onError: (err) => showToast(errorMessage(err), 'error'),
  });
  return (
    <Modal title={batch ? 'Clearance offer' : 'New offer'} onClose={onClose} busy={create.isPending}
      footer={<><button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button><button type="submit" form="offer-form" className="btn btn-primary" disabled={create.isPending || !variantId}>Start offer</button></>}>
      <form id="offer-form" className="form-grid" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
        {batch ? (
          <p className="muted" style={{ margin: 0 }}>{batch.productName} · batch {batch.batchNumber ?? '—'} · {batch.quantityRemaining} left · expires {formatDate(batch.expiresOn)}</p>
        ) : products.isLoading ? <Spinner /> : (
          <div className="input-wrapper"><label className="input-label" htmlFor="of-var">Product</label>
            <select id="of-var" className="input-field" required value={variantId} onChange={(e) => setVariantId(e.target.value)}><option value="">Choose…</option>{variants.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}</select></div>
        )}
        <div className="input-wrapper"><label className="input-label" htmlFor="of-title">Banner text</label><input id="of-title" className="input-field" required maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} /></div>
        <div className="form-row">
          <div className="input-wrapper"><label className="input-label" htmlFor="of-price">Offer price ₹</label><input id="of-price" className="input-field" inputMode="decimal" required value={price} onChange={(e) => setPrice(e.target.value)} /></div>
          <div className="input-wrapper"><label className="input-label" htmlFor="of-end">Last day</label><input id="of-end" type="date" className="input-field" required value={endsOn} onChange={(e) => setEndsOn(e.target.value)} /></div>
        </div>
        <div className="form-row">
          <div className="input-wrapper"><label className="input-label" htmlFor="of-radius">Show within (km)</label><input id="of-radius" type="number" min={1} max={50} className="input-field" value={radius} onChange={(e) => setRadius(e.target.value)} /></div>
          <div className="input-wrapper"><label className="input-label" htmlFor="of-limit">Units at this price</label><input id="of-limit" type="number" min={1} className="input-field" value={limit} onChange={(e) => setLimit(e.target.value)} placeholder="No limit" /></div>
        </div>
        {batch && <div className="input-wrapper"><label className="input-label" htmlFor="of-cut">Stop selling this many days before expiry</label><input id="of-cut" type="number" min={0} max={365} className="input-field" value={cutoff} onChange={(e) => setCutoff(e.target.value)} /></div>}
        <p className="tiny">Uses your store's location on the map. Customers see the store, product, price and last day.</p>
      </form>
    </Modal>
  );
}
