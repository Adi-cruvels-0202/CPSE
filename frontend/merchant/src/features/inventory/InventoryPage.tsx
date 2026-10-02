import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { productApi, inventoryApi } from '../../api/endpoints';
import { errorMessage } from '../../api/client';
import { useActiveStore } from '../../hooks/useStore';
import { useToast } from '../../hooks/useToast';
import { rupeesToPaise } from '../../lib/money';
import { EmptyState, NoStore, Spinner } from '../../components/common/ui';
import { IconClipboard, IconPlus, IconMinus, IconRefresh, IconSearch, IconHistory } from '../../components/icons/Icons';
import './Inventory.css';

/**
 * Stock, per variant: on the shelf, held for open orders, and what can still
 * be sold (on shelf − held). Every change made here is a logged movement; see
 * Stock history. Products whose stock is not counted are not listed.
 */

interface Row {
  id: string;
  productName: string;
  name: string;
  sku: string | null;
  onHand: number;
  held: number;
  available: number;
  isLow: boolean;
  isActive: boolean;
}

type Mode = 'in' | 'out' | 'count';

const OUT_REASONS: [string, string][] = [
  ['damaged', 'Damaged'],
  ['expired', 'Expired'],
  ['lost', 'Lost or stolen'],
  ['returned_to_supplier', 'Returned to supplier'],
  ['own_use', 'Own use'],
  ['other', 'Other'],
];

export default function InventoryPage() {
  const { activeStoreId } = useActiveStore();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [moving, setMoving] = useState<{ mode: Mode; row: Row | null } | null>(null);

  const { data: products, isLoading } = useQuery({
    queryKey: ['products', activeStoreId, 'all'],
    queryFn: () => productApi.all(activeStoreId!),
    enabled: !!activeStoreId,
  });

  const rows = useMemo<Row[]>(() => {
    const all = (products ?? [])
      .filter((product) => product.trackInventory)
      .flatMap((product) =>
        product.variants.map((variant) => ({
          id: variant.id,
          productName: product.name,
          name: variant.name,
          sku: variant.sku,
          onHand: variant.quantityOnHand ?? 0,
          held: variant.reservedQuantity ?? 0,
          available: variant.availableQuantity ?? 0,
          isLow: variant.isLowStock,
          isActive: variant.isActive && product.isActive,
        })),
      );
    const term = search.trim().toLowerCase();
    return term ? all.filter((row) => `${row.productName} ${row.name} ${row.sku ?? ''}`.toLowerCase().includes(term)) : all;
  }, [products, search]);

  if (!activeStoreId) return <NoStore title="Stock" />;

  const done = () => {
    setMoving(null);
    queryClient.invalidateQueries({ queryKey: ['products', activeStoreId] });
    queryClient.invalidateQueries({ queryKey: ['dashboard', activeStoreId] });
    queryClient.invalidateQueries({ queryKey: ['history', activeStoreId] });
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Stock</h1>
          <p className="page-subtitle">"Held" is promised to open orders and cannot be sold or taken out.</p>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <button className="btn btn-primary" onClick={() => setMoving({ mode: 'in', row: null })}><IconPlus size={16} /> Receive stock</button>
          <Link className="btn btn-secondary" to="/inventory/history"><IconHistory size={16} /> History</Link>
        </div>
      </div>

      <div className="filters-bar">
        <div className="search-input-wrap">
          <IconSearch size={16} className="search-input-icon" />
          <input className="input-field search-input" placeholder="Search by product, option or SKU…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      {isLoading ? <Spinner large /> : rows.length === 0 ? (
        <EmptyState
          icon={<IconClipboard size={32} />}
          title={search ? 'Nothing matches' : 'Nothing to count yet'}
          description={search ? 'Try another search.' : 'Add products with stock counting on, then receive their stock here.'}
          action={search ? undefined : <Link to="/products" className="btn btn-primary">Go to products</Link>}
        />
      ) : (
        <div className="table-container">
          <table className="table">
            <thead><tr><th>Product</th><th>Option</th><th>SKU</th><th>On shelf</th><th>Held</th><th>Can sell</th><th style={{ width: 150 }}></th></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} style={{ opacity: row.isActive ? 1 : 0.55 }}>
                  <td style={{ fontWeight: 'var(--font-medium)' }}>{row.productName}</td>
                  <td>{row.name === 'Default' ? '—' : row.name}</td>
                  <td><code className="mono">{row.sku ?? '—'}</code></td>
                  <td style={{ fontWeight: 'var(--font-semibold)' }}>{row.onHand}</td>
                  <td>{row.held}</td>
                  <td>
                    <span className={`badge ${row.available <= 0 ? 'badge-danger' : row.isLow ? 'badge-warning' : 'badge-success'}`}>
                      {row.available <= 0 ? 'Sold out' : row.available}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => setMoving({ mode: 'in', row })} title="Receive" aria-label={`Receive ${row.productName}`}><IconPlus size={14} /></button>
                      <button className="btn btn-ghost btn-sm" onClick={() => setMoving({ mode: 'out', row })} title="Take out" aria-label={`Take out ${row.productName}`}><IconMinus size={14} /></button>
                      <button className="btn btn-ghost btn-sm" onClick={() => setMoving({ mode: 'count', row })} title="Count" aria-label={`Count ${row.productName}`}><IconRefresh size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {moving && (
        <MovementModal
          storeId={activeStoreId}
          mode={moving.mode}
          rows={rows}
          initial={moving.row}
          onClose={() => setMoving(null)}
          onDone={done}
        />
      )}
    </div>
  );
}

const TITLES: Record<Mode, string> = { in: 'Receive stock', out: 'Take stock out', count: 'Count stock' };

function MovementModal({ storeId, mode, rows, initial, onClose, onDone }: { storeId: string; mode: Mode; rows: Row[]; initial: Row | null; onClose: () => void; onDone: () => void }) {
  const { showToast } = useToast();
  const [variantId, setVariantId] = useState(initial?.id ?? '');
  const [quantity, setQuantity] = useState('');
  const [unitCost, setUnitCost] = useState('');
  const [reason, setReason] = useState(mode === 'out' ? 'damaged' : '');
  const [notes, setNotes] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const selected = rows.find((row) => row.id === variantId);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const amount = Number(quantity);
    setIsSaving(true);
    try {
      if (mode === 'in') {
        const cost = rupeesToPaise(unitCost);
        if (Number.isNaN(cost)) throw new Error('Use a rupee amount for the cost, like 105 or 105.50.');
        await inventoryApi.stockIn(storeId, { variantId, quantity: amount, unitCostPaise: cost, notes: notes.trim() || null });
        showToast(`${amount} received`, 'success');
      } else if (mode === 'out') {
        await inventoryApi.stockOut(storeId, { variantId, quantity: amount, reason, notes: notes.trim() || null });
        showToast(`${amount} taken out`, 'success');
      } else {
        await inventoryApi.adjust(storeId, { variantId, newQuantity: amount, reason: reason.trim() });
        showToast(`Count saved: ${amount} on the shelf`, 'success');
      }
      onDone();
    } catch (err) {
      showToast(err instanceof Error && !(err as { code?: string }).code ? err.message : errorMessage(err), 'error');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="dialog-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog-content" role="dialog" aria-modal="true" aria-labelledby="movement-title">
        <div className="dialog-header"><h2 className="dialog-title" id="movement-title">{TITLES[mode]}</h2></div>
        <form onSubmit={submit}>
          <div className="dialog-body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            <div className="input-wrapper"><label className="input-label">Product *</label>
              <select className="input-field select-field" required value={variantId} onChange={(e) => setVariantId(e.target.value)}>
                <option value="">Choose…</option>
                {rows.map((row) => <option key={row.id} value={row.id}>{row.productName}{row.name === 'Default' ? '' : ` — ${row.name}`}{row.sku ? ` (${row.sku})` : ''}</option>)}
              </select>
            </div>
            {selected && (
              <div className="badge badge-neutral" style={{ alignSelf: 'flex-start' }}>
                On shelf {selected.onHand} · held {selected.held} · can sell {selected.available}
              </div>
            )}

            <div className="input-wrapper">
              <label className="input-label">{mode === 'count' ? 'Counted on the shelf *' : 'Quantity *'}</label>
              <input type="number" min={mode === 'count' ? Math.max(0, selected?.held ?? 0) : 1} max={mode === 'out' ? selected?.available : undefined} className="input-field" required value={quantity} onChange={(e) => setQuantity(e.target.value)} />
              {mode === 'out' && selected && <span className="input-helper">At most {selected.available} — the rest is held for orders.</span>}
              {mode === 'count' && selected && selected.held > 0 && <span className="input-helper">At least {selected.held}: open orders hold that many.</span>}
            </div>

            {mode === 'in' && (
              <div className="input-wrapper"><label className="input-label">Cost per unit ₹ (optional)</label>
                <input inputMode="decimal" className="input-field" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} />
              </div>
            )}
            {mode === 'out' && (
              <div className="input-wrapper"><label className="input-label">Why *</label>
                <select className="input-field select-field" value={reason} onChange={(e) => setReason(e.target.value)}>
                  {OUT_REASONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </div>
            )}
            {mode === 'count' ? (
              <div className="input-wrapper"><label className="input-label">Why it changed *</label>
                <input className="input-field" required maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Monthly shelf count" />
              </div>
            ) : (
              <div className="input-wrapper"><label className="input-label">Notes</label>
                <textarea className="input-field textarea-field" maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
            )}
          </div>
          <div className="dialog-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={isSaving}>{isSaving ? 'Saving…' : TITLES[mode]}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
