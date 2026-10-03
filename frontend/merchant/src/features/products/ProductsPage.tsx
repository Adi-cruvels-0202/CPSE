import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { productApi, categoryApi } from '../../api/endpoints';
import { errorMessage } from '../../api/client';
import type { Category, Product, Variant } from '../../api/types';
import { useActiveStore } from '../../hooks/useStore';
import { useToast } from '../../hooks/useToast';
import { formatPaise, paiseToRupees, rupeesToPaise } from '../../lib/money';
import { EmptyState, NoStore, Pagination, Spinner } from '../../components/common/ui';
import { IconPackage, IconPlus, IconSearch, IconEdit, IconEye, IconX, IconUpload, IconTrash, IconTag } from '../../components/icons/Icons';
import './Products.css';

const UNITS = ['pcs', 'kg', 'g', 'l', 'ml', 'm', 'cm', 'dozen', 'pack', 'box', 'pair', 'set', 'roll', 'plate', 'serving'];

/**
 * The catalogue. Price, MRP, cost, SKU and stock live on the variant; a
 * product sold without options has one variant called "Default", which
 * customers never see as a choice. Stock is never typed here except as a new
 * variant's opening stock — after that it moves through Stock, so every
 * change is in the history.
 */
export default function ProductsPage() {
  const { activeStoreId } = useActiveStore();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [filter, setFilter] = useState<'' | 'active' | 'inactive' | 'low'>('');
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const params = {
    page,
    limit: 20,
    search: search.trim() || undefined,
    categoryId: categoryId || undefined,
    isActive: filter === 'active' ? 'true' : filter === 'inactive' ? 'false' : undefined,
    lowStock: filter === 'low' ? 'true' : undefined,
  };

  const { data: list, isLoading } = useQuery({
    queryKey: ['products', activeStoreId, params],
    queryFn: () => productApi.list(activeStoreId!, params),
    enabled: !!activeStoreId,
  });
  const { data: cats } = useQuery({
    queryKey: ['categories', activeStoreId],
    queryFn: () => categoryApi.list(activeStoreId!),
    enabled: !!activeStoreId,
  });

  if (!activeStoreId) return <NoStore title="Products" />;

  const products = list?.data.products ?? [];
  const categories = cats?.categories ?? [];
  const reload = () => queryClient.invalidateQueries({ queryKey: ['products', activeStoreId] });

  const toggle = async (product: Product) => {
    try {
      if (product.isActive) await productApi.deactivate(activeStoreId, product.id);
      else await productApi.activate(activeStoreId, product.id);
      showToast(product.isActive ? `${product.name} is now unavailable to customers` : `${product.name} is available again`, 'info');
      reload();
    } catch (err) {
      showToast(errorMessage(err), 'error');
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Products</h1>
          <p className="page-subtitle">{list?.meta?.total ?? 0} products</p>
        </div>
        <div className="page-actions">
          <Link className="btn btn-secondary" to="/categories"><IconTag size={16} /> Categories</Link>
          <button className="btn btn-primary" onClick={() => setCreating(true)}><IconPlus size={16} /> Add product</button>
        </div>
      </div>

      <div className="filters-bar">
        <div className="search-input-wrap">
          <IconSearch size={16} className="search-input-icon" />
          <input aria-label="Search products" className="input-field search-input" placeholder="Search products…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        </div>
        <select aria-label="Category" className="input-field select-field" value={categoryId} onChange={(e) => { setCategoryId(e.target.value); setPage(1); }} style={{ maxWidth: 200 }}>
          <option value="">All categories</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select aria-label="Show" className="input-field select-field" value={filter} onChange={(e) => { setFilter(e.target.value as typeof filter); setPage(1); }} style={{ maxWidth: 180 }}>
          <option value="">Everything</option>
          <option value="active">Available</option>
          <option value="inactive">Unavailable</option>
          <option value="low">Low stock</option>
        </select>
      </div>

      {isLoading ? <Spinner large /> : products.length === 0 ? (
        <EmptyState
          icon={<IconPackage size={32} />}
          title={search || categoryId || filter ? 'Nothing matches' : 'No products yet'}
          description={search || categoryId || filter ? 'Try a different search or filter.' : 'Add your first product to start selling.'}
          action={!search && !categoryId && !filter ? <button className="btn btn-primary" onClick={() => setCreating(true)}><IconPlus size={16} /> Add product</button> : undefined}
        />
      ) : (
        <>
          <div className="table-container">
            <table className="table products-table">
              <thead><tr><th style={{ width: 44 }}></th><th>Product</th><th>Category</th><th>Price</th><th>Can sell</th><th>Status</th><th style={{ width: 100 }}></th></tr></thead>
              <tbody>
                {products.map((product) => (
                  <tr key={product.id} style={{ cursor: 'pointer' }} onClick={() => setOpenId(product.id)}>
                    <td>
                      <div className="product-thumb">
                        {product.images[0] ? <img src={product.images[0].url} alt="" /> : <IconPackage size={16} />}
                      </div>
                    </td>
                    <td>
                      <span style={{ fontWeight: 'var(--font-semibold)' }}>{product.name}</span>
                      {product.variants.length > 1 && <span className="body-xs" style={{ display: 'block', marginTop: 2 }}>{product.variants.length} variants</span>}
                    </td>
                    <td><span className="body-sm">{product.categoryName || '—'}</span></td>
                    <td style={{ fontWeight: 'var(--font-semibold)' }}>
                      {product.variants.length > 1 ? 'from ' : ''}{formatPaise(product.pricePaise)}
                      {product.taxPercent > 0 && <span className="body-xs" style={{ display: 'block' }}>+ {product.taxPercent}% GST</span>}
                    </td>
                    <td>
                      {product.stock === null ? <span className="badge badge-neutral">Not counted</span> : (
                        <span className={`badge ${product.stock.availableQuantity <= 0 ? 'badge-danger' : product.isLowStock ? 'badge-warning' : 'badge-success'}`}>
                          {product.stock.availableQuantity <= 0 ? 'Sold out' : product.stock.availableQuantity}
                        </span>
                      )}
                    </td>
                    <td><span className={`badge ${product.isActive ? 'badge-primary' : 'badge-neutral'}`}>{product.isActive ? 'Available' : 'Unavailable'}</span></td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
                        <button className="btn btn-ghost btn-sm" onClick={() => setOpenId(product.id)} aria-label={`Edit ${product.name}`}><IconEdit size={18} /></button>
                        <button className="btn btn-ghost btn-sm" onClick={() => toggle(product)} title={product.isActive ? 'Make unavailable' : 'Make available'} aria-label="Toggle availability"><IconEye size={18} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination meta={list?.meta} onPage={setPage} />
        </>
      )}

      {creating && (
        <CreateProductModal
          storeId={activeStoreId}
          categories={categories}
          onClose={() => setCreating(false)}
          onCreated={(product) => { setCreating(false); reload(); setOpenId(product.id); }}
        />
      )}
      {openId && <ProductPanel storeId={activeStoreId} productId={openId} categories={categories} onClose={() => setOpenId(null)} onChanged={reload} />}
    </div>
  );
}

// ── Create ───────────────────────────────────────────────────────────────────

interface VariantRow {
  name: string;
  sku: string;
  price: string;
  mrp: string;
  cost: string;
  opening: string;
}

const emptyVariant = (name = ''): VariantRow => ({ name, sku: '', price: '', mrp: '', cost: '', opening: '' });

/** A variant form row → the API's variant, or a message saying what is wrong. */
function toVariantBody(row: VariantRow, { withOpening }: { withOpening: boolean }): Record<string, unknown> | string {
  const price = rupeesToPaise(row.price);
  const mrp = rupeesToPaise(row.mrp);
  const cost = rupeesToPaise(row.cost);
  if (price === null || Number.isNaN(price)) return `Enter a price for ${row.name || 'each variant'}.`;
  if ([mrp, cost].some((value) => Number.isNaN(value))) return 'Use rupee amounts like 129 or 129.50.';
  if (mrp !== null && mrp < price) return `The MRP of ${row.name} is below its price.`;
  const opening = row.opening.trim() === '' ? 0 : Number(row.opening);
  if (!Number.isInteger(opening) || opening < 0) return 'Opening stock is a whole number.';
  return {
    name: row.name.trim(),
    ...(row.sku.trim() ? { sku: row.sku.trim() } : {}),
    pricePaise: price,
    mrpPaise: mrp,
    costPaise: cost,
    ...(withOpening ? { openingQuantity: opening } : {}),
  };
}

function CreateProductModal({ storeId, categories, onClose, onCreated }: { storeId: string; categories: Category[]; onClose: () => void; onCreated: (product: Product) => void }) {
  const { showToast } = useToast();
  const [form, setForm] = useState({ name: '', description: '', categoryId: '', unit: 'pcs', taxPercent: '0', trackInventory: true, lowStockThreshold: '5' });
  const [hasOptions, setHasOptions] = useState(false);
  const [variants, setVariants] = useState<VariantRow[]>([emptyVariant('Default')]);
  const [isSaving, setIsSaving] = useState(false);

  const setVariant = (index: number, field: keyof VariantRow, value: string) =>
    setVariants(variants.map((v, i) => (i === index ? { ...v, [field]: value } : v)));
  // The table's inputs have only a column header above them, so each carries its own name.
  const cellLabel = (column: string, index: number) => (hasOptions ? `${column}, option ${index + 1}` : column);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const rows = hasOptions ? variants : [{ ...variants[0], name: 'Default' }];
    const bodies = rows.map((row) => toVariantBody(row, { withOpening: form.trackInventory }));
    const problem = bodies.find((body) => typeof body === 'string');
    if (problem) {
      showToast(problem as string, 'error');
      return;
    }
    setIsSaving(true);
    try {
      const { product } = await productApi.create(storeId, {
        name: form.name.trim(),
        description: form.description.trim() || null,
        categoryId: form.categoryId || null,
        unit: form.unit,
        taxPercent: Number(form.taxPercent) || 0,
        trackInventory: form.trackInventory,
        lowStockThreshold: form.lowStockThreshold.trim() === '' ? null : Number(form.lowStockThreshold),
        variants: bodies,
      });
      showToast('Product created. Add photos from its panel.', 'success');
      onCreated(product);
    } catch (err) {
      showToast(errorMessage(err, 'Could not create the product.'), 'error');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="dialog-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog-content dialog-lg" role="dialog" aria-modal="true" aria-labelledby="new-product">
        <div className="dialog-header"><h2 className="dialog-title" id="new-product">New product</h2></div>
        <form onSubmit={handleSubmit}>
          <div className="dialog-body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            <div className="form-row">
              <div className="input-wrapper" style={{ flex: 2 }}>
                <label className="input-label" htmlFor="product-name">Name *</label>
                <input id="product-name" className="input-field" required maxLength={200} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. India Gate Basmati Rice" autoFocus />
              </div>
              <div className="input-wrapper" style={{ flex: 1 }}>
                <label className="input-label" htmlFor="product-category">Category</label>
                <select id="product-category" className="input-field select-field" value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
                  <option value="">None</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            </div>
            <div className="input-wrapper">
              <label className="input-label" htmlFor="product-description-2">Description</label>
              <textarea id="product-description-2" className="input-field textarea-field" maxLength={2000} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
            <div className="form-row" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
              <div className="input-wrapper">
                <label className="input-label" htmlFor="product-gst">GST %</label>
                <select id="product-gst" className="input-field select-field" value={form.taxPercent} onChange={(e) => setForm({ ...form, taxPercent: e.target.value })}>
                  {['0', '5', '12', '18', '28'].map((rate) => <option key={rate} value={rate}>{rate}%</option>)}
                </select>
                <span className="input-helper">Added on top of the price at checkout.</span>
              </div>
              <div className="input-wrapper">
                <label className="input-label" htmlFor="product-sold-by">Sold by</label>
                <select id="product-sold-by" className="input-field select-field" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}>
                  {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
              <div className="input-wrapper">
                <label className="input-label" htmlFor="product-low-stock-alert-at">Low-stock alert at</label>
                <input id="product-low-stock-alert-at" type="number" min="0" className="input-field" value={form.lowStockThreshold} onChange={(e) => setForm({ ...form, lowStockThreshold: e.target.value })} disabled={!form.trackInventory} />
              </div>
            </div>
            <label className="switch" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
              <input type="checkbox" className="switch-input" checked={form.trackInventory} onChange={(e) => setForm({ ...form, trackInventory: e.target.checked })} />
              <span className="switch-slider" /><span style={{ fontSize: 'var(--text-sm)' }}>Count stock (turn off for things that never run out, like made-to-order food)</span>
            </label>
            <label className="switch" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
              <input type="checkbox" className="switch-input" checked={hasOptions} onChange={(e) => { setHasOptions(e.target.checked); setVariants(e.target.checked ? [emptyVariant(), emptyVariant()] : [emptyVariant('Default')]); }} />
              <span className="switch-slider" /><span style={{ fontSize: 'var(--text-sm)' }}>Sold in sizes or options (1 kg / 5 kg, Small / Large)</span>
            </label>

            <div className="form-section-title">{hasOptions ? 'Options' : 'Price'}</div>
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    {hasOptions && <th>Option *</th>}
                    <th>Price ₹ *</th><th>MRP ₹</th><th>Cost ₹</th><th>SKU</th>
                    {form.trackInventory && <th>Opening stock</th>}
                    {hasOptions && <th></th>}
                  </tr>
                </thead>
                <tbody>
                  {variants.map((row, index) => (
                    <tr key={index}>
                      {hasOptions && <td><input aria-label={`Option ${index + 1} name`} className="input-field" required maxLength={120} value={row.name} onChange={(e) => setVariant(index, 'name', e.target.value)} placeholder="1 kg" /></td>}
                      <td><input aria-label={cellLabel('Price ₹', index)} className="input-field" inputMode="decimal" required value={row.price} onChange={(e) => setVariant(index, 'price', e.target.value)} placeholder="129" /></td>
                      <td><input aria-label={cellLabel('MRP ₹', index)} className="input-field" inputMode="decimal" value={row.mrp} onChange={(e) => setVariant(index, 'mrp', e.target.value)} /></td>
                      <td><input aria-label={cellLabel('Cost ₹', index)} className="input-field" inputMode="decimal" value={row.cost} onChange={(e) => setVariant(index, 'cost', e.target.value)} title="What you paid — never shown to customers" /></td>
                      <td><input aria-label={cellLabel('SKU', index)} className="input-field mono" maxLength={50} value={row.sku} onChange={(e) => setVariant(index, 'sku', e.target.value)} placeholder="auto" /></td>
                      {form.trackInventory && <td><input aria-label={cellLabel('Opening stock', index)} type="number" min="0" className="input-field" value={row.opening} onChange={(e) => setVariant(index, 'opening', e.target.value)} placeholder="0" /></td>}
                      {hasOptions && <td>{variants.length > 1 && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setVariants(variants.filter((_, i) => i !== index))} aria-label="Remove option"><IconX size={14} /></button>}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="body-xs" style={{ color: 'var(--color-text-tertiary)' }}>
              <strong>Price</strong> is what customers pay. <strong>MRP</strong> is the printed maximum price — when it is higher, customers see the discount.{' '}
              <strong>Cost</strong> is what you paid your supplier; only you see it. <strong>SKU</strong> is your own code for the item (for a barcode or your records) — leave it empty and one is made for you.
            </p>
            {hasOptions && variants.length < 50 && (
              <button type="button" className="btn btn-secondary btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setVariants([...variants, emptyVariant()])}><IconPlus size={14} /> Add option</button>
            )}
          </div>
          <div className="dialog-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={isSaving}>{isSaving ? 'Creating…' : 'Create product'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Deleting: archives, so past orders and stock history keep the product ────
function DeleteProduct({ storeId, product, onDeleted }: { storeId: string; product: Product; onDeleted: () => void }) {
  const { showToast } = useToast();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const remove = async () => {
    setDeleting(true);
    try {
      await productApi.remove(storeId, product.id);
      showToast(`${product.name} deleted`, 'success');
      onDeleted();
    } catch (err) {
      showToast(errorMessage(err), 'error');
      setDeleting(false);
    }
  };

  return (
    <div className="product-delete">
      <div className="form-section-title">Delete product</div>
      {confirming ? (
        <>
          <p className="body-sm">
            Delete <strong>{product.name}</strong>? It disappears from your products, your shop and the till. Past orders and stock history keep it. This cannot be undone.
          </p>
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <button className="btn btn-secondary" onClick={() => setConfirming(false)} disabled={deleting}>Keep it</button>
            <button className="btn btn-danger" onClick={remove} disabled={deleting}><IconTrash size={16} /> {deleting ? 'Deleting…' : 'Yes, delete'}</button>
          </div>
        </>
      ) : (
        <>
          <p className="body-xs" style={{ color: 'var(--color-text-tertiary)' }}>Only want to stop selling it for a while? Make it unavailable instead (the eye icon in the list).</p>
          <button className="btn btn-secondary product-delete__start" onClick={() => setConfirming(true)}><IconTrash size={16} /> Delete product</button>
        </>
      )}
    </div>
  );
}

// ── Product panel: details, photos, variants ─────────────────────────────────

function ProductPanel({ storeId, productId, categories, onClose, onChanged }: { storeId: string; productId: string; categories: Category[]; onClose: () => void; onChanged: () => void }) {
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const key = ['product', storeId, productId];
  const { data, isLoading } = useQuery({ queryKey: key, queryFn: () => productApi.get(storeId, productId) });
  const [uploading, setUploading] = useState(false);
  const [editingVariant, setEditingVariant] = useState<Variant | 'new' | null>(null);

  const product = data?.product;
  const applied = (updated: Product) => {
    queryClient.setQueryData(key, { product: updated });
    onChanged();
  };
  const run = async (work: () => Promise<{ product: Product }>, done?: string) => {
    try {
      applied((await work()).product);
      if (done) showToast(done, 'success');
    } catch (err) {
      showToast(errorMessage(err), 'error');
    }
  };

  const upload = async (file: File) => {
    if (file.size > 5 * 1024 * 1024) return showToast('Photos can be at most 5 MB.', 'error');
    setUploading(true);
    await run(() => productApi.uploadImage(storeId, productId, file), 'Photo added');
    setUploading(false);
  };

  return (
    <div className="dialog-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="drawer-content" role="dialog" aria-modal="true" aria-label={product?.name ?? 'Product'}>
        <div className="dialog-header" style={{ padding: 'var(--space-5) var(--space-6)' }}>
          <h2 className="dialog-title">{product?.name ?? 'Product'}</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close"><IconX size={18} /></button>
        </div>
        {isLoading || !product ? <Spinner /> : (
          <div className="drawer-body">
            <div className="form-section-title">Photos</div>
            <p className="body-xs" style={{ color: 'var(--color-text-tertiary)' }}>The first photo is the one customers see on the product card. JPEG, PNG or WebP up to 5 MB.</p>
            <div className="product-images-grid">
              {product.images.map((image) => (
                <div key={image.id} className="product-image-thumb" style={{ position: 'relative' }}>
                  <img src={image.url} alt={image.altText ?? product.name} />
                  <button className="btn btn-ghost btn-sm" style={{ position: 'absolute', top: 2, right: 2, background: 'var(--color-surface)' }} onClick={() => run(() => productApi.deleteImage(storeId, productId, image.id), 'Photo removed')} aria-label="Remove photo"><IconTrash size={12} /></button>
                </div>
              ))}
              {product.images.length < 10 && (
                <label className="product-image-upload" aria-label="Upload a photo" style={{ opacity: uploading ? 0.5 : 1 }}>
                  <input type="file" accept="image/jpeg,image/png,image/webp" style={{ display: 'none' }} disabled={uploading} onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) upload(file); }} />
                  {uploading ? <span className="spinner spinner-sm" /> : <IconUpload size={18} />}
                </label>
              )}
            </div>

            <div className="form-section-title" style={{ marginTop: 'var(--space-6)' }}>
              {product.variants.length > 1 ? 'Options' : 'Price & stock'}
            </div>
            <div className="table-container" style={{ marginTop: 'var(--space-2)' }}>
              <table className="table">
                <thead><tr><th>Option</th><th>Price</th><th>MRP</th><th>Cost</th>{product.trackInventory && <th>On shelf / held / can sell</th>}<th></th></tr></thead>
                <tbody>
                  {product.variants.map((variant) => (
                    <tr key={variant.id} style={{ opacity: variant.isActive ? 1 : 0.5 }}>
                      <td>{variant.name}<div className="mono body-xs">{variant.sku}</div></td>
                      <td style={{ fontWeight: 'var(--font-semibold)' }}>{formatPaise(variant.pricePaise)}</td>
                      <td>{formatPaise(variant.mrpPaise)}</td>
                      <td>{formatPaise(variant.costPaise)}</td>
                      {product.trackInventory && (
                        <td>
                          {variant.quantityOnHand} / {variant.reservedQuantity} /{' '}
                          <span className={`badge ${(variant.availableQuantity ?? 0) <= 0 ? 'badge-danger' : variant.isLowStock ? 'badge-warning' : 'badge-success'}`}>{variant.availableQuantity}</span>
                        </td>
                      )}
                      <td>
                        <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
                          <button className="btn btn-ghost btn-sm" onClick={() => setEditingVariant(variant)} aria-label={`Edit ${variant.name}`}><IconEdit size={13} /></button>
                          <button className="btn btn-ghost btn-sm" onClick={() => run(() => productApi.setVariantActive(storeId, productId, variant.id, !variant.isActive))} title={variant.isActive ? 'Stop selling this option' : 'Sell this option again'} aria-label="Toggle option"><IconEye size={13} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button className="btn btn-secondary btn-sm" style={{ marginTop: 'var(--space-2)' }} onClick={() => setEditingVariant('new')}><IconPlus size={14} /> Add option</button>
            {product.trackInventory && <p className="body-xs" style={{ color: 'var(--color-text-tertiary)', marginTop: 'var(--space-2)' }}>"Held" is promised to open orders. Receive and count stock under Stock.</p>}

            <ProductDetailsForm storeId={storeId} product={product} categories={categories} onSaved={applied} />

            <DeleteProduct storeId={storeId} product={product} onDeleted={() => { onChanged(); onClose(); }} />
          </div>
        )}
      </div>

      {editingVariant && product && (
        <VariantModal
          storeId={storeId}
          product={product}
          variant={editingVariant === 'new' ? null : editingVariant}
          onClose={() => setEditingVariant(null)}
          onSaved={(updated) => { setEditingVariant(null); applied(updated); }}
        />
      )}
    </div>
  );
}

function ProductDetailsForm({ storeId, product, categories, onSaved }: { storeId: string; product: Product; categories: Category[]; onSaved: (product: Product) => void }) {
  const { showToast } = useToast();
  const [form, setForm] = useState({
    name: product.name,
    description: product.description ?? '',
    categoryId: product.categoryId ?? '',
    unit: product.unit,
    taxPercent: String(product.taxPercent),
    trackInventory: product.trackInventory,
    lowStockThreshold: product.lowStockThreshold === null ? '' : String(product.lowStockThreshold),
  });
  const [isSaving, setIsSaving] = useState(false);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setIsSaving(true);
    try {
      const { product: updated } = await productApi.update(storeId, product.id, {
        name: form.name.trim(),
        description: form.description.trim() || null,
        categoryId: form.categoryId || null,
        unit: form.unit,
        taxPercent: Number(form.taxPercent) || 0,
        trackInventory: form.trackInventory,
        lowStockThreshold: form.lowStockThreshold.trim() === '' ? null : Number(form.lowStockThreshold),
      });
      onSaved(updated);
      showToast('Product saved', 'success');
    } catch (err) {
      showToast(errorMessage(err), 'error');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <form onSubmit={save} style={{ marginTop: 'var(--space-6)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <div className="form-section-title">Details</div>
      <div className="input-wrapper"><label className="input-label" htmlFor="product-name-2">Name</label><input id="product-name-2" className="input-field" required maxLength={200} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
      <div className="input-wrapper"><label className="input-label" htmlFor="product-description">Description</label><textarea id="product-description" className="input-field textarea-field" maxLength={2000} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
      <div className="form-row">
        <div className="input-wrapper"><label className="input-label" htmlFor="product-category-2">Category</label>
          <select id="product-category-2" className="input-field select-field" value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
            <option value="">None</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="input-wrapper"><label className="input-label" htmlFor="product-gst-2">GST %</label>
          <input id="product-gst-2" type="number" min="0" max="100" step="0.01" className="input-field" value={form.taxPercent} onChange={(e) => setForm({ ...form, taxPercent: e.target.value })} />
        </div>
      </div>
      <div className="form-row">
        <div className="input-wrapper"><label className="input-label" htmlFor="product-sold-by-2">Sold by</label>
          <select id="product-sold-by-2" className="input-field select-field" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}>{UNITS.map((u) => <option key={u} value={u}>{u}</option>)}</select>
        </div>
        <div className="input-wrapper"><label className="input-label" htmlFor="product-low-stock-alert-at-2">Low-stock alert at</label>
          <input id="product-low-stock-alert-at-2" type="number" min="0" className="input-field" value={form.lowStockThreshold} onChange={(e) => setForm({ ...form, lowStockThreshold: e.target.value })} placeholder="No alert" />
        </div>
      </div>
      <label className="switch" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
        <input type="checkbox" className="switch-input" checked={form.trackInventory} onChange={(e) => setForm({ ...form, trackInventory: e.target.checked })} />
        <span className="switch-slider" /><span style={{ fontSize: 'var(--text-sm)' }}>Count stock</span>
      </label>
      <button type="submit" className="btn btn-primary" disabled={isSaving} style={{ alignSelf: 'flex-end' }}>{isSaving ? 'Saving…' : 'Save details'}</button>
    </form>
  );
}

function VariantModal({ storeId, product, variant, onClose, onSaved }: { storeId: string; product: Product; variant: Variant | null; onClose: () => void; onSaved: (product: Product) => void }) {
  const { showToast } = useToast();
  const [row, setRow] = useState<VariantRow>({
    name: variant?.name ?? '',
    sku: variant?.sku ?? '',
    price: paiseToRupees(variant?.pricePaise),
    mrp: paiseToRupees(variant?.mrpPaise),
    cost: paiseToRupees(variant?.costPaise),
    opening: '',
  });
  const [isSaving, setIsSaving] = useState(false);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const body = toVariantBody(row, { withOpening: !variant && product.trackInventory });
    if (typeof body === 'string') return showToast(body, 'error');
    setIsSaving(true);
    try {
      const { product: updated } = variant
        ? await productApi.updateVariant(storeId, product.id, variant.id, body)
        : await productApi.addVariant(storeId, product.id, body);
      showToast(variant ? 'Option saved' : 'Option added', 'success');
      onSaved(updated);
    } catch (err) {
      showToast(errorMessage(err), 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const field = (name: keyof VariantRow, label: string, props: Record<string, unknown> = {}) => (
    <div className="input-wrapper">
      <label className="input-label" htmlFor={`variant-${name}`}>{label}</label>
      <input id={`variant-${name}`} className="input-field" value={row[name]} onChange={(e) => setRow({ ...row, [name]: e.target.value })} {...props} />
    </div>
  );

  return (
    <div className="dialog-overlay" style={{ zIndex: 1100 }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog-content" role="dialog" aria-modal="true" aria-labelledby="variant-title">
        <div className="dialog-header"><h2 className="dialog-title" id="variant-title">{variant ? `Edit ${variant.name}` : `New option for ${product.name}`}</h2></div>
        <form onSubmit={save}>
          <div className="dialog-body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            {field('name', 'Option name *', { required: true, maxLength: 120, placeholder: '5 kg', autoFocus: true })}
            <div className="form-row">
              {field('price', 'Price ₹ *', { required: true, inputMode: 'decimal' })}
              {field('mrp', 'MRP ₹', { inputMode: 'decimal' })}
            </div>
            <div className="form-row">
              {field('cost', 'Cost ₹ (only you see this)', { inputMode: 'decimal' })}
              {field('sku', 'SKU', { maxLength: 50, placeholder: 'auto' })}
            </div>
            {!variant && product.trackInventory && field('opening', 'Opening stock', { type: 'number', min: 0, placeholder: '0' })}
            {variant && product.trackInventory && <p className="body-xs" style={{ color: 'var(--color-text-tertiary)' }}>To change stock, use Stock → receive, remove or count.</p>}
          </div>
          <div className="dialog-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={isSaving}>{isSaving ? 'Saving…' : 'Save'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
