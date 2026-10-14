import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { productApi } from '../../api/endpoints';
import { intelligenceApi, purchaseApi, type InvoiceRead, type Purchase, type Supplier } from '../../api/ops';
import { errorMessage } from '../../api/client';
import { useActiveStore } from '../../hooks/useStore';
import { useToast } from '../../hooks/useToast';
import { formatPaise, rupeesToPaise, paiseToRupees } from '../../lib/money';
import { EmptyState, ErrorState, Modal, NoStore, PageHeader, Pagination, Spinner, SubTabs, formatDate } from '../../components/common/ui';
import { IconPackage, IconPlus, IconTrash } from '../../components/icons/Icons';
import './Tools.css';

/**
 * Purchases from suppliers (roadmap §4 P1). A draft changes nothing; confirming
 * puts every line on the shelf as a "purchase" stock movement that points back
 * at this purchase, and opens a batch for lines with a batch number or expiry.
 */
const STATUS_BADGE: Record<string, string> = { draft: 'badge-warning', confirmed: 'badge-success', cancelled: 'badge-neutral' };

export default function PurchasesPage() {
  const { activeStoreId } = useActiveStore();
  const [tab, setTab] = useState<'purchases' | 'suppliers'>('purchases');
  if (!activeStoreId) return <NoStore title="Purchases" />;
  return (
    <div>
      <PageHeader title="Purchases" subtitle="Record what you buy, so every unit on the shelf has a source." />
      <SubTabs value={tab} options={[{ value: 'purchases', label: 'Purchases' }, { value: 'suppliers', label: 'Suppliers' }]} onChange={setTab} />
      {tab === 'purchases' ? <PurchaseList storeId={activeStoreId} /> : <SupplierList storeId={activeStoreId} />}
    </div>
  );
}

function PurchaseList({ storeId }: { storeId: string }) {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Purchase | 'new' | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [fromInvoice, setFromInvoice] = useState<{ lines: Line[]; invoiceNumber: string | null; invoiceDate: string | null; supplierId: string | null } | null>(null);
  const query = useQuery({
    queryKey: ['purchases', storeId, status, page],
    queryFn: () => purchaseApi.list(storeId, { status: status || undefined, page }),
  });
  const purchases = query.data?.data.purchases ?? [];
  return (
    <>
      <div className="filters-bar">
        <select className="input-field" style={{ maxWidth: 200 }} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Status">
          <option value="">All purchases</option><option value="draft">Drafts</option><option value="confirmed">Confirmed</option><option value="cancelled">Cancelled</option>
        </select>
        <button type="button" className="btn btn-secondary" onClick={() => setReading(true)}>Read an invoice</button>
        <button type="button" className="btn btn-primary" onClick={() => setEditing('new')}><IconPlus size={16} /> New purchase</button>
      </div>
      {query.isLoading ? <Spinner large /> : query.error ? <ErrorState error={query.error} onRetry={() => query.refetch()} /> : purchases.length === 0 ? (
        <EmptyState icon={<IconPackage size={32} />} title="No purchases yet" description="Record a supplier's delivery to put the stock on your shelf with its cost and expiry." />
      ) : (
        <div className="table-container">
          <table className="table">
            <thead><tr><th>Date</th><th>Supplier</th><th>Invoice</th><th>Total</th><th>Status</th><th /></tr></thead>
            <tbody>
              {purchases.map((p) => (
                <tr key={p.id}>
                  <td>{formatDate(p.purchaseDate)}</td>
                  <td>{p.supplierName ?? '—'}</td>
                  <td className="muted">{p.invoiceNumber ?? '—'}</td>
                  <td>{formatPaise(p.totals.totalPaise)}</td>
                  <td><span className={`badge ${STATUS_BADGE[p.status]}`}>{p.status}</span></td>
                  <td><button type="button" className="btn btn-ghost btn-sm" onClick={() => setViewing(p.id)}>Open</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination meta={query.data?.meta} onPage={setPage} />
      {editing && <PurchaseForm storeId={storeId} purchase={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {reading && <InvoiceReader storeId={storeId} onClose={() => setReading(false)} onUse={(draft) => { setReading(false); setFromInvoice(draft); }} />}
      {fromInvoice && <PurchaseForm storeId={storeId} purchase={null} initialLines={fromInvoice.lines} initialInvoice={fromInvoice} onClose={() => setFromInvoice(null)} />}
      {viewing && <PurchaseDetail storeId={storeId} purchaseId={viewing} onClose={() => setViewing(null)} onEdit={(p) => { setViewing(null); setEditing(p); }} />}
    </>
  );
}

interface Line { variantId: string; quantity: string; unitCost: string; tax: string; batchNumber: string; expiresOn: string }
const emptyLine = (): Line => ({ variantId: '', quantity: '1', unitCost: '', tax: '', batchNumber: '', expiresOn: '' });

export function PurchaseForm({ storeId, purchase, onClose, initialLines, initialInvoice }: {
  storeId: string; purchase: Purchase | null; onClose: () => void; initialLines?: Line[]; initialInvoice?: { invoiceNumber: string | null; invoiceDate: string | null; supplierId?: string | null };
}) {
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const products = useQuery({ queryKey: ['products-all', storeId], queryFn: () => productApi.all(storeId) });
  const suppliers = useQuery({ queryKey: ['suppliers', storeId], queryFn: () => purchaseApi.suppliers(storeId) });
  const [supplierId, setSupplierId] = useState(purchase?.supplierId ?? initialInvoice?.supplierId ?? '');
  const [invoiceNumber, setInvoiceNumber] = useState(purchase?.invoiceNumber ?? initialInvoice?.invoiceNumber ?? '');
  const [invoiceDate, setInvoiceDate] = useState(purchase?.invoiceDate ?? initialInvoice?.invoiceDate ?? '');
  const [lines, setLines] = useState<Line[]>(
    purchase?.items?.map((i) => ({ variantId: i.variantId, quantity: String(i.quantity), unitCost: paiseToRupees(i.unitCostPaise), tax: i.taxPaise ? paiseToRupees(i.taxPaise) : '', batchNumber: i.batchNumber ?? '', expiresOn: i.expiresOn ?? '' }))
      ?? initialLines ?? [emptyLine()],
  );

  const variants = useMemo(
    () => (products.data ?? []).filter((p) => p.trackInventory).flatMap((p) => p.variants.map((v) => ({ id: v.id, label: `${p.name}${v.name !== 'Default' ? ` (${v.name})` : ''}`, cost: v.costPaise }))),
    [products.data],
  );
  const total = lines.reduce((sum, l) => sum + (Number(l.quantity) || 0) * (rupeesToPaise(l.unitCost) ?? 0) + (rupeesToPaise(l.tax) ?? 0), 0);

  const save = useMutation({
    mutationFn: (confirm: boolean) => {
      const body = {
        supplierId: supplierId || null,
        invoiceNumber: invoiceNumber.trim() || null,
        invoiceDate: invoiceDate || null,
        confirm,
        items: lines.filter((l) => l.variantId).map((l) => ({
          variantId: l.variantId,
          quantity: Number(l.quantity),
          unitCostPaise: rupeesToPaise(l.unitCost) ?? 0,
          taxPaise: rupeesToPaise(l.tax) ?? 0,
          batchNumber: l.batchNumber.trim() || null,
          expiresOn: l.expiresOn || null,
        })),
      };
      return purchase ? purchaseApi.update(storeId, purchase.id, body) : purchaseApi.create(storeId, body);
    },
    onSuccess: ({ purchase: saved }) => {
      queryClient.invalidateQueries({ queryKey: ['purchases', storeId] });
      queryClient.invalidateQueries({ queryKey: ['products', storeId] });
      queryClient.invalidateQueries({ queryKey: ['batches', storeId] });
      showToast(saved.status === 'confirmed' ? 'Stock received — it is on your shelf.' : 'Draft saved', 'success');
      onClose();
    },
    onError: (err) => showToast(errorMessage(err), 'error'),
  });
  const update = (index: number, patch: Partial<Line>) => setLines(lines.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  const valid = lines.some((l) => l.variantId) && lines.every((l) => !l.variantId || (Number(l.quantity) >= 1 && rupeesToPaise(l.unitCost) !== null));

  return (
    <Modal title={purchase ? 'Edit draft purchase' : 'New purchase'} size="lg" onClose={onClose} busy={save.isPending}
      footer={<>
        <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn-secondary" disabled={!valid || save.isPending} onClick={() => save.mutate(false)}>Save draft</button>
        <button type="button" className="btn btn-primary" disabled={!valid || save.isPending} onClick={() => save.mutate(true)}>Receive stock</button>
      </>}>
      {products.isLoading || suppliers.isLoading ? <Spinner /> : products.error ? <ErrorState error={products.error} onRetry={() => products.refetch()} /> : (
        <form className="form-grid" onSubmit={(e: FormEvent) => e.preventDefault()}>
          <div className="form-row">
            <div className="input-wrapper"><label className="input-label" htmlFor="pu-sup">Supplier</label>
              <select id="pu-sup" className="input-field" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                <option value="">— none —</option>
                {(suppliers.data?.suppliers ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select></div>
            <div className="input-wrapper"><label className="input-label" htmlFor="pu-inv">Invoice number</label>
              <input id="pu-inv" className="input-field" maxLength={60} value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} /></div>
          </div>
          <div className="input-wrapper" style={{ maxWidth: 240 }}><label className="input-label" htmlFor="pu-date">Invoice date</label>
            <input id="pu-date" type="date" className="input-field" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} /></div>

          {lines.map((line, index) => (
            <div key={index} className="card card-sm form-grid">
              <div className="row-between">
                <strong className="tiny">Line {index + 1}</strong>
                {lines.length > 1 && <button type="button" className="btn btn-ghost btn-sm" aria-label="Remove line" onClick={() => setLines(lines.filter((_, i) => i !== index))}><IconTrash size={14} /></button>}
              </div>
              <select className="input-field" aria-label="Product" value={line.variantId} onChange={(e) => {
                const v = variants.find((x) => x.id === e.target.value);
                update(index, { variantId: e.target.value, unitCost: line.unitCost || (v?.cost ? paiseToRupees(v.cost) : '') });
              }}>
                <option value="">Choose a product…</option>
                {variants.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
              </select>
              <div className="form-row">
                <input className="input-field" type="number" min={1} aria-label="Quantity" placeholder="Qty" value={line.quantity} onChange={(e) => update(index, { quantity: e.target.value })} />
                <input className="input-field" inputMode="decimal" aria-label="Cost per unit (₹)" placeholder="Cost per unit ₹" value={line.unitCost} onChange={(e) => update(index, { unitCost: e.target.value })} />
              </div>
              <div className="form-row">
                <input className="input-field" aria-label="Batch number" placeholder="Batch / lot (optional)" value={line.batchNumber} onChange={(e) => update(index, { batchNumber: e.target.value })} />
                <input className="input-field" type="date" aria-label="Expiry date" value={line.expiresOn} onChange={(e) => update(index, { expiresOn: e.target.value })} />
              </div>
              <input className="input-field" inputMode="decimal" aria-label="GST on this line (₹)" placeholder="GST on this line ₹ (optional)" value={line.tax} onChange={(e) => update(index, { tax: e.target.value })} />
            </div>
          ))}
          <button type="button" className="btn btn-secondary" onClick={() => setLines([...lines, emptyLine()])}><IconPlus size={14} /> Add a line</button>
          <div className="row-between"><span className="muted">Total</span><strong>{formatPaise(total)}</strong></div>
        </form>
      )}
    </Modal>
  );
}

function PurchaseDetail({ storeId, purchaseId, onClose, onEdit }: { storeId: string; purchaseId: string; onClose: () => void; onEdit: (p: Purchase) => void }) {
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ['purchase', storeId, purchaseId], queryFn: () => purchaseApi.get(storeId, purchaseId) });
  const act = useMutation({
    mutationFn: (action: 'confirm' | 'cancel') => (action === 'confirm' ? purchaseApi.confirm(storeId, purchaseId) : purchaseApi.cancel(storeId, purchaseId)),
    onSuccess: ({ purchase }) => {
      queryClient.setQueryData(['purchase', storeId, purchaseId], { purchase });
      queryClient.invalidateQueries({ queryKey: ['purchases', storeId] });
      queryClient.invalidateQueries({ queryKey: ['products', storeId] });
      showToast(purchase.status === 'confirmed' ? 'Stock received' : 'Draft cancelled', 'success');
    },
    onError: (err) => showToast(errorMessage(err), 'error'),
  });
  const p = query.data?.purchase;
  return (
    <Modal title={p ? `Purchase ${p.invoiceNumber ?? formatDate(p.purchaseDate)}` : 'Purchase'} size="lg" onClose={onClose} busy={act.isPending}
      footer={<>
        <button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>
        {p?.status === 'draft' && <>
          <button type="button" className="btn btn-ghost" onClick={() => act.mutate('cancel')} disabled={act.isPending}>Cancel draft</button>
          <button type="button" className="btn btn-secondary" onClick={() => onEdit(p)}>Edit</button>
          <button type="button" className="btn btn-primary" onClick={() => act.mutate('confirm')} disabled={act.isPending}>Receive stock</button>
        </>}
      </>}>
      {query.isLoading ? <Spinner /> : !p ? <ErrorState error={query.error} onRetry={() => query.refetch()} /> : (
        <div className="stack">
          <dl className="kv">
            <dt>Supplier</dt><dd>{p.supplierName ?? '—'}</dd>
            <dt>Invoice</dt><dd>{p.invoiceNumber ?? '—'} {p.invoiceDate ? `(${formatDate(p.invoiceDate)})` : ''}</dd>
            <dt>Status</dt><dd><span className={`badge ${STATUS_BADGE[p.status]}`}>{p.status}</span>{p.confirmedAt ? ` · received ${formatDate(p.confirmedAt)}` : ''}</dd>
          </dl>
          <div className="table-container">
            <table className="table">
              <thead><tr><th>Item</th><th>Qty</th><th>Cost</th><th>Batch</th><th>Expiry</th><th>Line</th></tr></thead>
              <tbody>
                {(p.items ?? []).map((i) => (
                  <tr key={i.id}>
                    <td>{i.productName}{i.variantName && i.variantName !== 'Default' ? ` (${i.variantName})` : ''}</td>
                    <td>{i.quantity}</td><td>{formatPaise(i.unitCostPaise)}</td>
                    <td className="muted">{i.batchNumber ?? '—'}</td><td className="muted">{formatDate(i.expiresOn)}</td>
                    <td>{formatPaise(i.lineTotalPaise)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="row-between"><span className="muted">Total</span><strong>{formatPaise(p.totals.totalPaise)}</strong></div>
        </div>
      )}
    </Modal>
  );
}

function SupplierList({ storeId }: { storeId: string }) {
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ['suppliers-all', storeId], queryFn: () => purchaseApi.suppliers(storeId, true) });
  const [editing, setEditing] = useState<Supplier | 'new' | null>(null);
  const [form, setForm] = useState({ name: '', phone: '', gstin: '', address: '' });
  const save = useMutation({
    mutationFn: () => {
      const body = { name: form.name.trim(), phone: form.phone.trim() || null, gstin: form.gstin.trim() || null, address: form.address.trim() || null };
      return editing && editing !== 'new' ? purchaseApi.updateSupplier(storeId, editing.id, body) : purchaseApi.createSupplier(storeId, body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suppliers-all', storeId] });
      queryClient.invalidateQueries({ queryKey: ['suppliers', storeId] });
      showToast('Supplier saved', 'success');
      setEditing(null);
    },
    onError: (err) => showToast(errorMessage(err), 'error'),
  });
  const toggle = async (s: Supplier) => {
    try {
      await purchaseApi.updateSupplier(storeId, s.id, { isActive: !s.isActive });
      queryClient.invalidateQueries({ queryKey: ['suppliers-all', storeId] });
    } catch (err) { showToast(errorMessage(err), 'error'); }
  };
  const begin = (s: Supplier | 'new') => {
    setForm(s === 'new' ? { name: '', phone: '', gstin: '', address: '' } : { name: s.name, phone: s.phone ?? '', gstin: s.gstin ?? '', address: s.address ?? '' });
    setEditing(s);
  };
  const suppliers = query.data?.suppliers ?? [];
  return (
    <>
      <div className="filters-bar"><button type="button" className="btn btn-primary" onClick={() => begin('new')}><IconPlus size={16} /> Add supplier</button></div>
      {query.isLoading ? <Spinner /> : query.error ? <ErrorState error={query.error} onRetry={() => query.refetch()} /> : suppliers.length === 0 ? (
        <EmptyState icon={<IconPackage size={32} />} title="No suppliers yet" description="Add the wholesalers you buy from." />
      ) : (
        <div className="table-container">
          <table className="table">
            <thead><tr><th>Name</th><th>Phone</th><th>GSTIN</th><th>Status</th><th /></tr></thead>
            <tbody>
              {suppliers.map((s) => (
                <tr key={s.id}>
                  <td>{s.name}</td><td className="muted">{s.phone ?? '—'}</td><td className="muted">{s.gstin ?? '—'}</td>
                  <td><span className={`badge ${s.isActive ? 'badge-success' : 'badge-neutral'}`}>{s.isActive ? 'Active' : 'Inactive'}</span></td>
                  <td style={{ display: 'flex', gap: 4 }}>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => begin(s)}>Edit</button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => toggle(s)}>{s.isActive ? 'Deactivate' : 'Activate'}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <Modal title={editing === 'new' ? 'Add supplier' : 'Edit supplier'} onClose={() => setEditing(null)} busy={save.isPending}
          footer={<><button type="button" className="btn btn-secondary" onClick={() => setEditing(null)}>Cancel</button><button type="submit" form="supplier-form" className="btn btn-primary" disabled={save.isPending || !form.name.trim()}>Save</button></>}>
          <form id="supplier-form" className="form-grid" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
            {(['name', 'phone', 'gstin', 'address'] as const).map((key) => (
              <div key={key} className="input-wrapper">
                <label className="input-label" htmlFor={`sup-${key}`}>{{ name: 'Name *', phone: 'Phone', gstin: 'GSTIN', address: 'Address' }[key]}</label>
                <input id={`sup-${key}`} className="input-field" value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} required={key === 'name'} />
              </div>
            ))}
          </form>
        </Modal>
      )}
    </>
  );
}

/**
 * A supplier invoice pasted as text (roadmap Phase D "Invoice extraction"):
 * each line is read and matched to the catalogue, and the merchant chooses
 * which to carry into a draft purchase. Nothing is saved here. A photo or
 * PDF is read by the vision model into the same lines and goes through the
 * same checks; the server says so when no AI provider is configured.
 */
function InvoiceReader({ storeId, onClose, onUse }: { storeId: string; onClose: () => void; onUse: (draft: { lines: Line[]; invoiceNumber: string | null; invoiceDate: string | null; supplierId: string | null }) => void }) {
  const { showToast } = useToast();
  const [text, setText] = useState('');
  const [read, setRead] = useState<InvoiceRead | null>(null);
  const [chosen, setChosen] = useState<Record<number, string>>({});
  const show = ({ invoice }: { invoice: InvoiceRead }) => {
    setRead(invoice);
    setChosen(Object.fromEntries(invoice.lines.map((l, i) => [i, l.match?.variantId ?? ''])));
  };
  const run = useMutation({
    mutationFn: () => intelligenceApi.invoice(storeId, text),
    onSuccess: show,
    onError: (err) => showToast(errorMessage(err), 'error'),
  });
  const readFile = useMutation({
    mutationFn: (file: File) => intelligenceApi.invoiceFile(storeId, file),
    onSuccess: show,
    onError: (err) => showToast(errorMessage(err), 'error'),
  });
  const busy = run.isPending || readFile.isPending;
  const use = () => {
    const lines = read!.lines
      .map((l, i) => ({ l, variantId: chosen[i] }))
      .filter(({ variantId }) => variantId)
      .map(({ l, variantId }) => ({
        ...emptyLine(), variantId, quantity: String(l.readAs.quantity), unitCost: paiseToRupees(l.readAs.unitCostPaise),
        batchNumber: l.readAs.batchNumber ?? '', expiresOn: l.readAs.expiresOn ?? '',
      }));
    onUse({ lines: lines.length ? lines : [emptyLine()], invoiceNumber: read!.invoiceNumber, invoiceDate: read!.invoiceDate, supplierId: read!.supplier?.match?.supplierId ?? null });
  };
  return (
    <Modal title="Read an invoice" size="lg" onClose={onClose} busy={busy}
      footer={<>
        <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
        {read
          ? <button type="button" className="btn btn-primary" onClick={use}>Use {Object.values(chosen).filter(Boolean).length} lines</button>
          : <button type="button" className="btn btn-primary" disabled={!text.trim() || busy} onClick={() => run.mutate()}>{run.isPending ? 'Reading…' : 'Read text'}</button>}
      </>}>
      {!read ? (
        <div className="form-grid">
          <label className="input-label" htmlFor="inv-text">Paste the invoice text — one item per line, e.g. “Basmati Rice 1kg 10 x 92”</label>
          <textarea id="inv-text" className="input-field" rows={10} value={text} onChange={(e) => setText(e.target.value)} />
          <label className="input-label" htmlFor="inv-file">Or upload a photo or PDF of the bill</label>
          <input id="inv-file" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="input-field" disabled={busy}
            onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) readFile.mutate(file); }} />
          {readFile.isPending && <p className="tiny" role="status">Reading the bill…</p>}
          <p className="tiny">Whatever is read is shown for you to check; nothing is saved until you confirm the purchase.</p>
        </div>
      ) : (
        <div className="stack">
          <p className="tiny" data-testid="invoice-supplier">
            {read.supplier
              ? read.supplier.match
                ? `Supplier: ${read.supplier.match.name} (your saved supplier)`
                : `Supplier on the invoice: ${read.supplier.name} — not one of your saved suppliers; add it under Suppliers to link it.`
              : 'No supplier name found on the invoice.'}
          </p>
          {read.warnings.map((w) => <div key={w} className="alert-strip alert-strip-warning">{w}</div>)}
          <p className="tiny">
            {read.invoiceNumber ? `Invoice ${read.invoiceNumber}` : 'No invoice number found'}{read.invoiceDate ? ` · ${formatDate(read.invoiceDate)}` : ''} · lines add up to {formatPaise(read.computedTotalPaise)}
            {read.totalMatches === false && read.statedTotalPaise !== null ? ` — the invoice says ${formatPaise(read.statedTotalPaise)}, check it` : ''}
          </p>
          <table className="table">
            <thead><tr><th>Read</th><th>Qty × cost</th><th>Batch / expiry</th><th>Your product</th></tr></thead>
            <tbody>{read.lines.map((l, i) => (
              <tr key={i}>
                <td className="tiny">{l.source}</td>
                <td>{l.readAs.quantity} × {formatPaise(l.readAs.unitCostPaise)}{l.warnings.map((w) => <div key={w} className="tiny">{w}</div>)}</td>
                <td className="tiny">{l.readAs.batchNumber ?? '—'}{l.readAs.expiresOn ? <div>exp {formatDate(l.readAs.expiresOn)}</div> : null}</td>
                <td>
                  <select className="input-field" aria-label={`Product for ${l.readAs.name}`} value={chosen[i] ?? ''} onChange={(e) => setChosen({ ...chosen, [i]: e.target.value })}>
                    <option value="">Skip this line</option>
                    {l.match && <option value={l.match.variantId}>{l.match.name} ({l.confidence})</option>}
                    {l.alternatives.map((a) => <option key={a.variantId} value={a.variantId}>{a.name}</option>)}
                  </select>
                </td>
              </tr>
            ))}</tbody>
          </table>
          {read.skipped.length > 0 && <p className="tiny">Not read: {read.skipped.join(' · ')}</p>}
        </div>
      )}
    </Modal>
  );
}
