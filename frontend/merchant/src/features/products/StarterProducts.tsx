import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { storeApi } from '../../api/endpoints';
import { catalogueOpsApi, type Template } from '../../api/ops';
import { errorMessage } from '../../api/client';
import { useToast } from '../../hooks/useToast';
import { paiseToRupees, rupeesToPaise } from '../../lib/money';
import { IconCheck, IconPackage } from '../../components/icons/Icons';

/**
 * The first visit to Products in a new shop: the basics nearly every shop of
 * this kind sells (the industry template), ready to add in one go. The owner
 * sets their own price for each size and, if they like, opening stock and
 * its expiry date. Shown only while the shop has no products and the owner
 * has not chosen "I'll add my own"; after that, products are added the usual
 * way.
 */

const DISMISS_KEY = (storeId: string) => `cpse.merchant.starterProducts.dismissed.${storeId}`;

export function starterDismissed(storeId: string) {
  try {
    return window.localStorage.getItem(DISMISS_KEY(storeId)) === '1';
  } catch {
    return false;
  }
}

function rememberDismissed(storeId: string) {
  try {
    window.localStorage.setItem(DISMISS_KEY(storeId), '1');
  } catch {
    // Private mode: the panel simply comes back next visit while the shop is empty.
  }
}

type Row = { price: string; quantity: string; expiresOn: string };
const rowKey = (productKey: string, variant: string) => `${productKey}:${variant}`;
const today = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

export function StarterProducts({ storeId, onAdded, onDismiss }: { storeId: string; onAdded: () => void; onDismiss: () => void }) {
  const { showToast } = useToast();
  const storeQuery = useQuery({ queryKey: ['store', storeId], queryFn: () => storeApi.get(storeId) });
  const summaries = useQuery({ queryKey: ['templates'], queryFn: () => catalogueOpsApi.templates(), staleTime: Infinity });
  const known = summaries.data?.templates ?? [];
  const shopCategory = storeQuery.data?.store.shopCategory ?? null;
  const [chosenIndustry, setChosenIndustry] = useState<string | null>(null);
  const industry = chosenIndustry ?? (known.some((t) => t.industry === shopCategory) ? shopCategory : null);

  const templateQuery = useQuery({
    queryKey: ['template', industry],
    queryFn: () => catalogueOpsApi.template(industry!),
    enabled: !!industry,
    staleTime: Infinity,
  });
  const template = templateQuery.data?.template;

  const [unticked, setUnticked] = useState<Set<string>>(new Set());
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Every size starts at the suggested price, which the owner changes to theirs.
  useEffect(() => {
    if (!template) return;
    setUnticked(new Set());
    setRows(Object.fromEntries(template.products.flatMap((p) =>
      p.variants.map((v) => [rowKey(p.key, v.name), { price: paiseToRupees(v.suggestedPricePaise), quantity: '', expiresOn: '' }]),
    )));
  }, [template]);

  const chosen = useMemo(() => (template?.products ?? []).filter((p) => !unticked.has(p.key)), [template, unticked]);
  const countsStock = template?.defaults.trackInventory ?? true;
  const perishable = (template?.defaults.expiryAlertDays ?? 0) > 0;
  const label = known.find((t) => t.industry === industry)?.label;

  if (storeQuery.isLoading || summaries.isLoading || (industry && templateQuery.isLoading)) return null;

  const setRow = (key: string, patch: Partial<Row>) => setRows((all) => ({ ...all, [key]: { ...all[key], ...patch } }));

  const build = (t: Template) => {
    const products = [];
    for (const p of chosen) {
      const prices: Record<string, number> = {};
      const stock: Record<string, { quantity: number; expiresOn?: string }> = {};
      for (const v of p.variants) {
        const row = rows[rowKey(p.key, v.name)] ?? { price: '', quantity: '', expiresOn: '' };
        const price = rupeesToPaise(row.price);
        if (price === null || Number.isNaN(price)) throw new Error(`Enter a price for ${p.name} (${v.name}).`);
        prices[v.name] = price;
        const quantity = row.quantity.trim();
        if (quantity) {
          if (!/^\d+$/.test(quantity) || Number(quantity) < 1) throw new Error(`Opening stock for ${p.name} (${v.name}) must be a whole number.`);
          if (row.expiresOn && row.expiresOn < today()) throw new Error(`The expiry date for ${p.name} (${v.name}) has already passed.`);
          stock[v.name] = { quantity: Number(quantity), ...(row.expiresOn ? { expiresOn: row.expiresOn } : {}) };
        } else if (row.expiresOn) {
          throw new Error(`Add how many ${p.name} (${v.name}) you have, or clear its expiry date.`);
        }
      }
      products.push({ key: p.key, prices, ...(Object.keys(stock).length ? { stock } : {}) });
    }
    return { industry: t.industry, applyDefaults: false, categories: [], products };
  };

  const add = async () => {
    if (!template) return;
    setError(null);
    let body;
    try {
      body = build(template);
    } catch (err) {
      setError((err as Error).message);
      return;
    }
    setAdding(true);
    try {
      const { report } = await catalogueOpsApi.applyTemplate(storeId, body);
      const made = report.productsCreated.length;
      if (report.failed.length) {
        showToast(`${made} added. Not added: ${report.failed.map((f) => `${f.name} (${f.message})`).join('; ')}`, 'error');
      } else {
        showToast(`${made} ${made === 1 ? 'product' : 'products'} added. Edit any of them, or add more, whenever you like.`, 'success');
      }
      onAdded();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setAdding(false);
    }
  };

  const dismiss = () => {
    rememberDismissed(storeId);
    onDismiss();
  };

  return (
    <section className="starter-products card" aria-labelledby="starter-products-title">
      <div className="starter-products__head">
        <span className="starter-products__badge" aria-hidden="true"><IconPackage size={22} /></span>
        <div>
          <h2 id="starter-products-title" className="starter-products__title">
            {label ? `Start with the basics for your ${label.toLowerCase()} shop` : 'Start with the basics for your shop'}
          </h2>
          <p className="starter-products__hint">
            These are products almost every shop like yours sells. Set your own price{countsStock ? ', and stock if you have it,' : ''} then add them all at once.
            You can edit or delete any of them later.
          </p>
        </div>
      </div>

      <div className="input-wrapper starter-products__type">
        <label className="input-label" htmlFor="starter-products-type">Kind of shop</label>
        <select id="starter-products-type" className="input-field select-field" value={industry ?? ''} onChange={(e) => setChosenIndustry(e.target.value || null)}>
          {!industry && <option value="">Choose…</option>}
          {known.map((t) => <option key={t.industry} value={t.industry}>{t.label}</option>)}
        </select>
      </div>

      {template && (
        <ul className="starter-products__grid">
          {template.products.map((p, index) => {
            const on = !unticked.has(p.key);
            return (
              <li key={`${template.industry}-${p.key}`} className={`starter-card${on ? ' is-on' : ''}`} style={{ animationDelay: `${Math.min(index, 12) * 45}ms` }}>
                <label className="starter-card__top">
                  <input
                    type="checkbox"
                    checked={on}
                    aria-label={`Add ${p.name}`}
                    onChange={() => setUnticked((all) => {
                      const next = new Set(all);
                      if (on) next.add(p.key); else next.delete(p.key);
                      return next;
                    })}
                  />
                  <span className="starter-card__name">{p.name}</span>
                  <span className="starter-card__category">{p.category}</span>
                </label>
                {on && (
                  <div className="starter-card__sizes">
                    {p.variants.map((v) => {
                      const key = rowKey(p.key, v.name);
                      const row = rows[key] ?? { price: '', quantity: '', expiresOn: '' };
                      return (
                        <div key={key} className="starter-size">
                          <span className="starter-size__name">{v.name}</span>
                          <label className="starter-size__field">
                            <span>Price ₹</span>
                            <input className="input-field" inputMode="decimal" aria-label={`${p.name} ${v.name} price`} value={row.price} onChange={(e) => setRow(key, { price: e.target.value })} />
                          </label>
                          {countsStock && (
                            <label className="starter-size__field">
                              <span>Stock</span>
                              <input className="input-field" inputMode="numeric" placeholder="0" aria-label={`${p.name} ${v.name} opening stock`} value={row.quantity} onChange={(e) => setRow(key, { quantity: e.target.value })} />
                            </label>
                          )}
                          {countsStock && perishable && (
                            <label className="starter-size__field starter-size__field--date">
                              <span>Expires</span>
                              <input className="input-field" type="date" min={today()} aria-label={`${p.name} ${v.name} expiry date`} value={row.expiresOn} onChange={(e) => setRow(key, { expiresOn: e.target.value })} />
                            </label>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {error && <p className="starter-products__error" role="alert">{error}</p>}

      <div className="starter-products__actions">
        <button type="button" className="btn btn-ghost" onClick={dismiss} disabled={adding}>I'll add my own</button>
        <button type="button" className="btn btn-primary" onClick={add} disabled={!template || chosen.length === 0 || adding}>
          <IconCheck size={16} /> {adding ? 'Adding…' : `Add ${chosen.length} ${chosen.length === 1 ? 'product' : 'products'}`}
        </button>
      </div>
    </section>
  );
}
