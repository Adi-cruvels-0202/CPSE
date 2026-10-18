import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { automationApi, purchaseApi } from '../../api/ops';
import { errorMessage } from '../../api/client';
import { useActiveStore } from '../../hooks/useStore';
import { useToast } from '../../hooks/useToast';
import { formatPaise, rupeesToPaise, paiseToRupees } from '../../lib/money';
import { EmptyState, ErrorState, NoStore, PageHeader, Spinner } from '../../components/common/ui';
import { IconCheck } from '../../components/icons/Icons';
import './Tools.css';

/**
 * What to reorder (roadmap Phase C "Suggested purchase lists"). Deterministic:
 * the recent selling rate, the alert level, what is available and what is
 * already on draft purchases. Each line says why. Choosing lines creates a
 * DRAFT purchase — nothing reaches the shelf until it is received.
 */
interface Choice { checked: boolean; quantity: string; cost: string }

export default function SuggestionsPage() {
  const { activeStoreId } = useActiveStore();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [coverDays, setCoverDays] = useState(14);
  const [supplierId, setSupplierId] = useState('');
  const [choices, setChoices] = useState<Record<string, Choice>>({});

  const query = useQuery({
    queryKey: ['suggestions', activeStoreId, coverDays],
    queryFn: () => automationApi.suggestions(activeStoreId!, { coverDays }),
    enabled: !!activeStoreId,
  });
  const suppliers = useQuery({ queryKey: ['suppliers', activeStoreId], queryFn: () => purchaseApi.suppliers(activeStoreId!), enabled: !!activeStoreId });
  const lines = query.data?.suggestions.suggestions ?? [];

  useEffect(() => {
    setChoices(Object.fromEntries(lines.map((s) => [s.variantId, { checked: true, quantity: String(s.suggestedQuantity), cost: s.lastCostPaise === null ? '' : paiseToRupees(s.lastCostPaise) }])));
  }, [query.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const draft = useMutation({
    mutationFn: () => automationApi.draftFromSuggestions(activeStoreId!, {
      supplierId: supplierId || undefined,
      items: lines.filter((s) => choices[s.variantId]?.checked).map((s) => ({
        variantId: s.variantId,
        quantity: Math.max(1, Number(choices[s.variantId].quantity) || 1),
        unitCostPaise: rupeesToPaise(choices[s.variantId].cost) ?? 0,
      })),
    }),
    onSuccess: () => { showToast('Draft purchase created — review and receive it when the goods arrive.', 'success'); navigate('/purchases'); },
    onError: (err) => showToast(errorMessage(err), 'error'),
  });

  if (!activeStoreId) return <NoStore title="What to reorder" />;
  const chosen = lines.filter((s) => choices[s.variantId]?.checked);
  const estimate = chosen.reduce((sum, s) => sum + (rupeesToPaise(choices[s.variantId].cost) ?? 0) * (Number(choices[s.variantId].quantity) || 0), 0);

  return (
    <div>
      <PageHeader title="What to reorder" subtitle="Worked out from what you sold recently and your low-stock levels. You decide." />
      <div className="filters-bar">
        <label className="muted" htmlFor="cover">Cover the next</label>
        <select id="cover" className="input-field" style={{ maxWidth: 140 }} value={coverDays} onChange={(e) => setCoverDays(Number(e.target.value))}>
          {[7, 14, 30, 60].map((d) => <option key={d} value={d}>{d} days</option>)}
        </select>
      </div>
      {query.isLoading ? <Spinner large /> : query.error ? <ErrorState error={query.error} onRetry={() => query.refetch()} /> : lines.length === 0 ? (
        <EmptyState icon={<IconCheck size={32} />} title="Nothing needs reordering" description="Everything is above its low-stock level and covers recent sales." />
      ) : (
        <>
          <div className="table-container table-scroll">
            <table className="table">
              <thead><tr><th /><th>Product</th><th>Available</th><th>Why</th><th>Order</th><th>Cost/unit ₹</th></tr></thead>
              <tbody>
                {lines.map((s) => {
                  const c = choices[s.variantId] ?? { checked: true, quantity: String(s.suggestedQuantity), cost: '' };
                  const set = (patch: Partial<Choice>) => setChoices({ ...choices, [s.variantId]: { ...c, ...patch } });
                  return (
                    <tr key={s.variantId}>
                      <td><input type="checkbox" aria-label={`Include ${s.productName}`} checked={c.checked} onChange={(e) => set({ checked: e.target.checked })} /></td>
                      <td>{s.productName}{s.variantName ? ` (${s.variantName})` : ''}</td>
                      <td>{s.available}{s.onDraftPurchases ? <div className="tiny">+{s.onDraftPurchases} on drafts</div> : null}</td>
                      <td className="tiny" style={{ maxWidth: 320 }}>{s.reason}</td>
                      <td><input className="input-field" style={{ width: 80 }} type="number" min={1} aria-label="Quantity" value={c.quantity} onChange={(e) => set({ quantity: e.target.value })} /></td>
                      <td><input className="input-field" style={{ width: 100 }} inputMode="decimal" aria-label="Cost per unit" value={c.cost} onChange={(e) => set({ cost: e.target.value })} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="row-between" style={{ marginTop: 'var(--space-4)' }}>
            <select className="input-field" style={{ maxWidth: 260 }} value={supplierId} onChange={(e) => setSupplierId(e.target.value)} aria-label="Supplier">
              <option value="">Supplier (optional)</option>
              {(suppliers.data?.suppliers ?? []).map((sup) => <option key={sup.id} value={sup.id}>{sup.name}</option>)}
            </select>
            <span className="muted">Estimated {formatPaise(estimate)}</span>
            <button type="button" className="btn btn-primary" disabled={chosen.length === 0 || draft.isPending} onClick={() => draft.mutate()}>
              {draft.isPending ? 'Creating…' : `Create draft purchase (${chosen.length})`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
