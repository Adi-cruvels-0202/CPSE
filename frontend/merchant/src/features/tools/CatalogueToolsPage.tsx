import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { categoryApi, productApi } from '../../api/endpoints';
import { catalogueOpsApi, type BulkResult, type ImportPreview, type StoreDefaults } from '../../api/ops';
import { errorMessage } from '../../api/client';
import { useActiveStore } from '../../hooks/useStore';
import { useToast } from '../../hooks/useToast';
import { formatPaise, rupeesToPaise } from '../../lib/money';
import { ErrorState, NoStore, PageHeader, Spinner, SubTabs } from '../../components/common/ui';
import './Tools.css';

/**
 * Catalogue set-up and upkeep (roadmap §4 P1): industry starter templates,
 * CSV import (always previewed first) and export, bulk changes (previewed
 * first) and the store's catalogue defaults.
 */
type Tab = 'templates' | 'import' | 'bulk' | 'defaults';

export default function CatalogueToolsPage() {
  const { activeStoreId } = useActiveStore();
  const [tab, setTab] = useState<Tab>('templates');
  if (!activeStoreId) return <NoStore title="Catalogue tools" />;
  return (
    <div>
      <PageHeader title="Catalogue tools" subtitle="Set up faster and change many products at once." />
      <SubTabs value={tab} onChange={setTab} options={[
        { value: 'templates', label: 'Starter templates' }, { value: 'import', label: 'Import & export' },
        { value: 'bulk', label: 'Bulk changes' }, { value: 'defaults', label: 'Defaults' },
      ]} />
      {tab === 'templates' && <Templates storeId={activeStoreId} />}
      {tab === 'import' && <ImportExport storeId={activeStoreId} />}
      {tab === 'bulk' && <Bulk storeId={activeStoreId} />}
      {tab === 'defaults' && <Defaults storeId={activeStoreId} />}
    </div>
  );
}

// ── Templates ───────────────────────────────────────────────────────────────

function Templates({ storeId }: { storeId: string }) {
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const list = useQuery({ queryKey: ['templates'], queryFn: () => catalogueOpsApi.templates() });
  const [industry, setIndustry] = useState('');
  const detail = useQuery({ queryKey: ['template', industry], queryFn: () => catalogueOpsApi.template(industry), enabled: !!industry });
  const [chosen, setChosen] = useState<Record<string, boolean>>({});
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [applyDefaults, setApplyDefaults] = useState(true);
  useEffect(() => { setChosen({}); setPrices({}); }, [industry]);

  const apply = useMutation({
    mutationFn: () => {
      const template = detail.data!.template;
      const products = template.products.filter((p) => chosen[p.key]).map((p) => {
        const own: Record<string, number> = {};
        for (const v of p.variants) {
          const typed = prices[`${p.key}:${v.name}`];
          const paise = typed ? rupeesToPaise(typed) : null;
          if (paise !== null && paise !== undefined) own[v.name] = paise;
        }
        return { key: p.key, ...(Object.keys(own).length ? { prices: own } : {}) };
      });
      return catalogueOpsApi.applyTemplate(storeId, { industry, applyDefaults, categories: 'all', products });
    },
    onSuccess: ({ report }) => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['categories'] });
      showToast(`Added ${report.categoriesCreated.length} categories and ${report.productsCreated.length} products${report.failed.length ? `; ${report.failed.length} failed` : ''}.`, report.failed.length ? 'error' : 'success');
    },
    onError: (err) => showToast(errorMessage(err), 'error'),
  });

  if (list.isLoading) return <Spinner large />;
  if (list.error) return <ErrorState error={list.error} onRetry={() => list.refetch()} />;
  const template = detail.data?.template;
  const count = Object.values(chosen).filter(Boolean).length;

  return (
    <div className="stack">
      <p className="muted">Pick your kind of shop to add its usual categories and the products you choose. Anything you already have is skipped, never overwritten. New products start hidden until you check the price and publish them.</p>
      <div className="tools-grid">
        {list.data!.templates.map((t) => (
          <button key={t.industry} type="button" className="tools-card" aria-pressed={industry === t.industry} onClick={() => setIndustry(t.industry)}
            style={industry === t.industry ? { borderColor: 'var(--color-primary)' } : undefined}>
            <span className="tools-card__label">{t.label}</span>
            <span className="tools-card__hint">{t.categoryCount} categories · {t.productCount} products</span>
          </button>
        ))}
      </div>
      {industry && (detail.isLoading ? <Spinner /> : detail.error ? <ErrorState error={detail.error} /> : template && (
        <section className="card">
          <div className="row-between">
            <h2 style={{ fontSize: 'var(--text-base)' }}>{template.label}</h2>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setChosen(Object.fromEntries(template.products.map((p) => [p.key, count < template.products.length])))}>{count < template.products.length ? 'Choose all' : 'Clear'}</button>
          </div>
          <p className="tiny">Categories: {template.categories.join(', ')}</p>
          <div className="table-container">
            <table className="table">
              <thead><tr><th /><th>Product</th><th>Category</th><th>Your price (₹) per size</th></tr></thead>
              <tbody>{template.products.map((p) => (
                <tr key={p.key}>
                  <td><input type="checkbox" aria-label={`Add ${p.name}`} checked={!!chosen[p.key]} onChange={(e) => setChosen({ ...chosen, [p.key]: e.target.checked })} /></td>
                  <td>{p.name}<div className="tiny">{p.unit} · GST {p.taxPercent}%</div></td>
                  <td className="tiny">{p.category}</td>
                  <td>{p.variants.map((v) => (
                    <div key={v.name} style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', marginBottom: 4 }}>
                      <span className="tiny" style={{ minWidth: 70 }}>{v.name}</span>
                      <input className="input-field" style={{ maxWidth: 110 }} inputMode="decimal" aria-label={`${p.name} ${v.name} price`}
                        placeholder={(v.suggestedPricePaise / 100).toFixed(2)} value={prices[`${p.key}:${v.name}`] ?? ''}
                        onChange={(e) => setPrices({ ...prices, [`${p.key}:${v.name}`]: e.target.value })} />
                    </div>
                  ))}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <label style={{ display: 'flex', gap: 'var(--space-2)', margin: 'var(--space-3) 0' }}>
            <input type="checkbox" checked={applyDefaults} onChange={(e) => setApplyDefaults(e.target.checked)} />
            Also use this template's defaults (GST {template.defaults.taxPercent}%, low-stock alert at {template.defaults.lowStockThreshold ?? 'none'}, expiry alerts {template.defaults.expiryAlertDays} days ahead)
          </label>
          <p className="tiny">An empty price uses the suggested price shown in grey.</p>
          <button type="button" className="btn btn-primary" disabled={apply.isPending} onClick={() => apply.mutate()}>
            {apply.isPending ? 'Adding…' : count ? `Add categories and ${count} product${count === 1 ? '' : 's'}` : 'Add categories only'}
          </button>
          {apply.data && <TemplateReportView report={apply.data.report} />}
        </section>
      ))}
    </div>
  );
}

function TemplateReportView({ report }: { report: Awaited<ReturnType<typeof catalogueOpsApi.applyTemplate>>['report'] }) {
  return (
    <div className="alert-strip alert-strip-info" style={{ marginTop: 'var(--space-3)', display: 'block' }}>
      <div>Created: {report.categoriesCreated.length} categories, {report.productsCreated.length} products.</div>
      {(report.categoriesSkipped.length > 0 || report.productsSkipped.length > 0) && <div>Already there (skipped): {[...report.categoriesSkipped, ...report.productsSkipped].join(', ')}</div>}
      {report.failed.map((f) => <div key={f.key}>Could not add {f.name}: {f.message}</div>)}
    </div>
  );
}

// ── Import / export ─────────────────────────────────────────────────────────

const CSV_HELP = 'Columns: product_name and price are required; also category, unit, tax_percent, track_inventory, low_stock_threshold, product_active, variant_name, sku, barcode, weight_grams, mrp, cost, quantity_on_hand, variant_active. Money in rupees, yes/no for flags. One row per size; rows with the same product_name form one product. The easiest start is an export.';

function ImportExport({ storeId }: { storeId: string }) {
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [exporting, setExporting] = useState(false);

  const check = useMutation({
    mutationFn: () => catalogueOpsApi.previewImport(storeId, csv),
    onSuccess: (data) => setPreview(data),
    onError: (err) => { setPreview(null); showToast(errorMessage(err), 'error'); },
  });
  const commit = useMutation({
    mutationFn: () => catalogueOpsApi.commitImport(storeId, csv),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['categories'] });
      setPreview(null); setCsv(''); setFileName('');
      showToast(`Imported: ${data.summary.created} new, ${data.summary.updated} updated${data.summary.failed ? `, ${data.summary.failed} failed` : ''}.`, data.summary.failed ? 'error' : 'success');
    },
    onError: (err) => showToast(errorMessage(err), 'error'),
  });
  const exportCsv = async () => {
    setExporting(true);
    try {
      const text = await catalogueOpsApi.exportCsv(storeId);
      const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
      const a = document.createElement('a');
      a.href = url; a.download = `catalogue-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
      URL.revokeObjectURL(url);
    } catch (err) { showToast(errorMessage(err), 'error'); }
    finally { setExporting(false); }
  };
  const readFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 2_000_000) { showToast('That file is over 2 MB. Split it into smaller files.', 'error'); return; }
    setFileName(file.name); setPreview(null); setCsv(await file.text());
  };

  return (
    <div className="stack">
      <section className="card">
        <h2 style={{ fontSize: 'var(--text-base)' }}>Export</h2>
        <p className="tiny">Every product and size as a CSV you can edit in a spreadsheet and import back.</p>
        <button type="button" className="btn btn-secondary" onClick={exportCsv} disabled={exporting}>{exporting ? 'Preparing…' : 'Download catalogue CSV'}</button>
      </section>
      <section className="card">
        <h2 style={{ fontSize: 'var(--text-base)' }}>Import</h2>
        <p className="tiny">{CSV_HELP} Nothing changes until you confirm the preview.</p>
        <input type="file" accept=".csv,text/csv" aria-label="CSV file" onChange={(e) => readFile(e.target.files?.[0])} />
        {fileName && <p className="tiny">{fileName} · {csv.split(/\r?\n/).filter(Boolean).length - 1} rows</p>}
        <button type="button" className="btn btn-primary" style={{ marginTop: 'var(--space-2)' }} disabled={!csv || check.isPending} onClick={() => check.mutate()}>{check.isPending ? 'Checking…' : 'Check file'}</button>
        {preview && (
          <div style={{ marginTop: 'var(--space-3)' }}>
            <div className="alert-strip alert-strip-info">
              {preview.summary.productsToCreate} new · {preview.summary.productsToUpdate} updated · {preview.summary.productsSkipped} unchanged
              {preview.summary.newCategories.length > 0 && ` · new categories: ${preview.summary.newCategories.join(', ')}`}
            </div>
            {preview.failedRows.length > 0 && (
              <div className="alert-strip alert-strip-danger" style={{ display: 'block', marginTop: 'var(--space-2)' }}>
                <strong>{preview.failedRows.length} rows have problems and will be skipped:</strong>
                <ul>{preview.failedRows.slice(0, 20).map((r) => <li key={r.line}>Line {r.line} ({r.productName || 'no name'}): {r.errors.map((e) => `${e.field} — ${e.message}`).join('; ')}</li>)}</ul>
              </div>
            )}
            <button type="button" className="btn btn-primary" style={{ marginTop: 'var(--space-2)' }} disabled={commit.isPending || preview.summary.productsToCreate + preview.summary.productsToUpdate === 0} onClick={() => commit.mutate()}>
              {commit.isPending ? 'Importing…' : 'Import now'}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

// ── Bulk changes ────────────────────────────────────────────────────────────

const ACTIONS: Record<string, string> = {
  activate: 'Show to customers', deactivate: 'Hide from customers', archive: 'Archive', set_category: 'Move to category',
  set_tax: 'Set GST %', set_low_stock_threshold: 'Set low-stock alert', adjust_price_percent: 'Change price by %', stock_in: 'Add stock to every size',
};

function Bulk({ storeId }: { storeId: string }) {
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const products = useQuery({ queryKey: ['products-all', storeId], queryFn: () => productApi.all(storeId) });
  const categories = useQuery({ queryKey: ['categories', storeId], queryFn: () => categoryApi.list(storeId) });
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState('');
  const [action, setAction] = useState('deactivate');
  const [value, setValue] = useState('');
  const [result, setResult] = useState<BulkResult | null>(null);

  const visible = useMemo(() => (products.data ?? []).filter((p) => !search.trim() || p.name.toLowerCase().includes(search.trim().toLowerCase())), [products.data, search]);
  const ids = Object.keys(selected).filter((id) => selected[id]);
  const body = (preview: boolean) => {
    const extra = action === 'set_category' ? { categoryId: value || null }
      : action === 'set_tax' ? { taxPercent: Number(value) }
      : action === 'set_low_stock_threshold' ? { threshold: value === '' ? null : Number(value) }
      : action === 'adjust_price_percent' ? { percent: Number(value) }
      : action === 'stock_in' ? { quantity: Number(value) } : {};
    return { action, ...extra, productIds: ids, preview };
  };
  const run = useMutation({
    mutationFn: (preview: boolean) => catalogueOpsApi.bulk(storeId, body(preview)),
    onSuccess: ({ bulk }) => {
      setResult(bulk);
      if (!bulk.preview) {
        queryClient.invalidateQueries({ queryKey: ['products'] });
        queryClient.invalidateQueries({ queryKey: ['products-all', storeId] });
        showToast(`Done: ${bulk.summary.ok} changed${bulk.summary.failed ? `, ${bulk.summary.failed} failed` : ''}.`, bulk.summary.failed ? 'error' : 'success');
        setSelected({});
      }
    },
    onError: (err) => showToast(errorMessage(err), 'error'),
  });
  useEffect(() => setResult(null), [action, value, ids.length]);
  const needsValue = !['activate', 'deactivate', 'archive', 'set_low_stock_threshold', 'set_category'].includes(action);

  if (products.isLoading) return <Spinner large />;
  if (products.error) return <ErrorState error={products.error} onRetry={() => products.refetch()} />;
  return (
    <div className="stack">
      <div className="filters-bar">
        <div className="input-wrapper"><label className="input-label" htmlFor="bk-action">Change</label>
          <select id="bk-action" className="input-field" value={action} onChange={(e) => { setAction(e.target.value); setValue(''); }}>
            {Object.entries(ACTIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        {action === 'set_category' ? (
          <div className="input-wrapper"><label className="input-label" htmlFor="bk-cat">Category</label>
            <select id="bk-cat" className="input-field" value={value} onChange={(e) => setValue(e.target.value)}>
              <option value="">No category</option>{(categories.data?.categories ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        ) : !['activate', 'deactivate', 'archive'].includes(action) && (
          <div className="input-wrapper"><label className="input-label" htmlFor="bk-val">{action === 'adjust_price_percent' ? '% (−10 = 10% cheaper)' : action === 'stock_in' ? 'Units' : action === 'set_tax' ? 'GST %' : 'Alert at (empty = none)'}</label>
            <input id="bk-val" type="number" className="input-field" value={value} onChange={(e) => setValue(e.target.value)} /></div>
        )}
        <button type="button" className="btn btn-secondary" disabled={!ids.length || run.isPending || (needsValue && value === '')} onClick={() => run.mutate(true)}>Preview ({ids.length})</button>
        <button type="button" className="btn btn-primary" disabled={!result?.preview || result.summary.ok === 0 || run.isPending} onClick={() => { if (window.confirm(`${ACTIONS[action]} for ${result!.summary.ok} products?`)) run.mutate(false); }}>Apply</button>
      </div>
      {result && (
        <div className={`alert-strip ${result.summary.failed ? 'alert-strip-warning' : 'alert-strip-info'}`} style={{ display: 'block' }}>
          {result.preview ? 'Preview' : 'Result'}: {result.summary.ok} will change{result.summary.failed ? `, ${result.summary.failed} cannot` : ''}.
          <ul>{result.results.filter((r) => r.status === 'failed').slice(0, 10).map((r) => <li key={r.productId}>{r.name}: {r.errors?.map((e) => e.message).join('; ')}</li>)}</ul>
        </div>
      )}
      <div className="input-wrapper"><label className="input-label" htmlFor="bk-search">Find products</label>
        <input id="bk-search" className="input-field" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
      <div className="table-container">
        <table className="table">
          <thead><tr>
            <th><input type="checkbox" aria-label="Select all shown" checked={visible.length > 0 && visible.every((p) => selected[p.id])}
              onChange={(e) => setSelected({ ...selected, ...Object.fromEntries(visible.slice(0, 200).map((p) => [p.id, e.target.checked])) })} /></th>
            <th>Product</th><th>Sizes</th><th>Status</th></tr></thead>
          <tbody>{visible.map((p) => (
            <tr key={p.id}>
              <td><input type="checkbox" aria-label={`Select ${p.name}`} checked={!!selected[p.id]} onChange={(e) => setSelected({ ...selected, [p.id]: e.target.checked })} /></td>
              <td>{p.name}</td>
              <td className="tiny">{p.variants.map((v) => `${v.name} ${formatPaise(v.pricePaise)}`).join(' · ')}</td>
              <td><span className={`badge ${p.isActive ? 'badge-success' : 'badge-neutral'}`}>{p.isActive ? 'Visible' : 'Hidden'}</span></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <p className="tiny">Up to 200 products per change.</p>
    </div>
  );
}

// ── Defaults ────────────────────────────────────────────────────────────────

function Defaults({ storeId }: { storeId: string }) {
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ['defaults', storeId], queryFn: () => catalogueOpsApi.defaults(storeId) });
  const [form, setForm] = useState<StoreDefaults | null>(null);
  useEffect(() => { if (query.data) setForm(query.data.defaults); }, [query.data]);
  const save = useMutation({
    mutationFn: () => catalogueOpsApi.saveDefaults(storeId, { lowStockThreshold: form!.lowStockThreshold, taxPercent: form!.taxPercent, trackInventory: form!.trackInventory, expiryAlertDays: form!.expiryAlertDays }),
    onSuccess: (data) => { queryClient.setQueryData(['defaults', storeId], data); showToast('Defaults saved', 'success'); },
    onError: (err) => showToast(errorMessage(err), 'error'),
  });
  if (query.isLoading || !form) return query.error ? <ErrorState error={query.error} onRetry={() => query.refetch()} /> : <Spinner large />;
  return (
    <form className="card form-grid" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <p className="tiny" style={{ margin: 0 }}>Used for new products. Existing products keep their own settings — use Bulk changes to update them.</p>
      <div className="form-row">
        <div className="input-wrapper"><label className="input-label" htmlFor="df-tax">GST %</label>
          <select id="df-tax" className="input-field" value={form.taxPercent} onChange={(e) => setForm({ ...form, taxPercent: Number(e.target.value) })}>{[0, 5, 12, 18, 28].map((t) => <option key={t} value={t}>{t}%</option>)}</select></div>
        <div className="input-wrapper"><label className="input-label" htmlFor="df-low">Low-stock alert at (empty = none)</label>
          <input id="df-low" type="number" min={0} className="input-field" value={form.lowStockThreshold ?? ''} onChange={(e) => setForm({ ...form, lowStockThreshold: e.target.value === '' ? null : Number(e.target.value) })} /></div>
      </div>
      <div className="input-wrapper"><label className="input-label" htmlFor="df-exp">Warn about expiring stock this many days ahead</label>
        <input id="df-exp" type="number" min={0} max={365} className="input-field" value={form.expiryAlertDays} onChange={(e) => setForm({ ...form, expiryAlertDays: Number(e.target.value) })} /></div>
      <label style={{ display: 'flex', gap: 'var(--space-2)' }}><input type="checkbox" checked={form.trackInventory} onChange={(e) => setForm({ ...form, trackInventory: e.target.checked })} />Track stock for new products</label>
      {form.templateApplied && <p className="tiny">Started from the “{form.templateApplied}” template.</p>}
      <button type="submit" className="btn btn-primary" disabled={save.isPending}>Save defaults</button>
    </form>
  );
}
