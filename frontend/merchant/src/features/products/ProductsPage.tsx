import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { productApi, categoryApi } from '../../api/endpoints';
import { useActiveStore } from '../../hooks/useStore';
import { useToast } from '../../hooks/useToast';
import { IconPackage, IconPlus, IconSearch, IconEdit, IconCopy, IconEye, IconX, IconUpload, IconImage } from '../../components/icons/Icons';
import './Products.css';

export default function ProductsPage() {
  const { activeStoreId } = useActiveStore();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<any>(null);
  const [viewingProduct, setViewingProduct] = useState<any>(null);

  const { data: productsRes, isLoading } = useQuery({
    queryKey: ['products', activeStoreId, page, search, categoryFilter],
    queryFn: () => productApi.list(activeStoreId!, { page, size: 20, search: search || undefined, categoryId: categoryFilter || undefined }),
    enabled: !!activeStoreId,
  });

  const { data: catsRes } = useQuery({
    queryKey: ['categories', activeStoreId],
    queryFn: () => categoryApi.list(activeStoreId!),
    enabled: !!activeStoreId,
  });

  const products = productsRes?.data?.data || [];
  const totalPages = productsRes?.data?.totalPages || 0;
  const categories = catsRes?.data?.data || [];

  if (!activeStoreId) {
    return (
      <div>
        <div className="page-header"><div><h1 className="page-title">Products</h1></div></div>
        <div className="empty-state">
          <div className="empty-state-icon"><IconPackage size={32} /></div>
          <div className="empty-state-title">No store selected</div>
          <div className="empty-state-description">Create a store first.</div>
          <a href="/store/setup" className="btn btn-primary">Go to Store Setup</a>
        </div>
      </div>
    );
  }

  const handleToggleActive = async (p: any) => {
    try {
      if (p.active || p.isActive) { await productApi.deactivate(activeStoreId!, p.id); showToast(`${p.name} deactivated`, 'info'); }
      else { await productApi.activate(activeStoreId!, p.id); showToast(`${p.name} activated`, 'success'); }
      queryClient.invalidateQueries({ queryKey: ['products'] });
    } catch (err: any) { showToast(err.response?.data?.error?.message || 'Failed', 'error'); }
  };

  const handleDuplicate = async (p: any) => {
    try {
      await productApi.duplicate(activeStoreId!, p.id);
      showToast(`${p.name} duplicated`, 'success');
      queryClient.invalidateQueries({ queryKey: ['products'] });
    } catch (err: any) { showToast(err.response?.data?.error?.message || 'Failed', 'error'); }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Products</h1>
          <p className="page-subtitle">{productsRes?.data?.totalElements || 0} products in catalogue</p>
        </div>
        <button className="btn btn-primary" onClick={() => { setEditingProduct(null); setShowModal(true); }}>
          <IconPlus size={16} />
          Add Product
        </button>
      </div>

      <div className="filters-bar">
        <div className="search-input-wrap">
          <IconSearch size={16} className="search-input-icon" />
          <input className="input-field search-input" placeholder="Search products..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} />
        </div>
        <select className="input-field select-field" value={categoryFilter} onChange={(e) => { setCategoryFilter(e.target.value); setPage(0); }} style={{ maxWidth: 200 }}>
          <option value="">All Categories</option>
          {categories.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {isLoading ? (
        <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner spinner-lg" /></div>
      ) : products.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon"><IconPackage size={32} /></div>
          <div className="empty-state-title">No products yet</div>
          <div className="empty-state-description">Add your first product to start building your catalogue.</div>
          <button className="btn btn-primary" onClick={() => setShowModal(true)}>
            <IconPlus size={16} />
            Add Product
          </button>
        </div>
      ) : (
        <>
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 44 }}></th>
                  <th>Product</th>
                  <th>Category</th>
                  <th>Price</th>
                  <th>Stock</th>
                  <th>Status</th>
                  <th style={{ width: 160 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {products.map((p: any) => (
                  <tr key={p.id} style={{ cursor: 'pointer' }} onClick={() => setViewingProduct(p)}>
                    <td>
                      <div className="product-thumb">
                        {p.images && p.images.length > 0 ? (
                          <img src={p.images[0].imageUrl} alt={p.name} />
                        ) : (
                          <IconPackage size={16} />
                        )}
                      </div>
                    </td>
                    <td>
                      <span style={{ fontWeight: 'var(--font-semibold)' }}>{p.name}</span>
                      {p.variants && p.variants.length > 0 && (
                        <span className="body-xs" style={{ display: 'block', marginTop: 2 }}>
                          {p.variants.length} variant{p.variants.length !== 1 ? 's' : ''}
                        </span>
                      )}
                    </td>
                    <td><span className="body-sm">{p.categoryName || '—'}</span></td>
                    <td style={{ fontWeight: 'var(--font-semibold)' }}>₹{Number(p.price).toLocaleString('en-IN')}</td>
                    <td>
                      <span className={`badge ${p.totalStock > 0 ? 'badge-success' : 'badge-danger'}`}>
                        {p.totalStock > 0 ? `${p.totalStock} in stock` : 'Out of stock'}
                      </span>
                    </td>
                    <td>
                      <span className={`badge ${(p.active || p.isActive) ? 'badge-primary' : 'badge-neutral'}`}>
                        {(p.active || p.isActive) ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
                        <button className="btn btn-ghost btn-sm" onClick={() => { setEditingProduct(p); setShowModal(true); }} title="Edit">
                          <IconEdit size={14} />
                        </button>
                        <button className="btn btn-ghost btn-sm" onClick={() => handleToggleActive(p)} title={(p.active || p.isActive) ? 'Deactivate' : 'Activate'}>
                          <IconEye size={14} />
                        </button>
                        <button className="btn btn-ghost btn-sm" onClick={() => handleDuplicate(p)} title="Duplicate">
                          <IconCopy size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="pagination">
              <button className="btn btn-secondary btn-sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Previous</button>
              <span className="pagination-info">Page {page + 1} of {totalPages}</span>
              <button className="btn btn-secondary btn-sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>Next</button>
            </div>
          )}
        </>
      )}

      {showModal && <ProductModal storeId={activeStoreId!} product={editingProduct} categories={categories} onClose={() => { setShowModal(false); setEditingProduct(null); }} onSuccess={() => { setShowModal(false); setEditingProduct(null); queryClient.invalidateQueries({ queryKey: ['products'] }); }} />}
      {viewingProduct && <ProductDetailDrawer storeId={activeStoreId!} product={viewingProduct} onClose={() => setViewingProduct(null)} />}
    </div>
  );
}

function ProductModal({ storeId, product, categories, onClose, onSuccess }: { storeId: string; product: any; categories: any[]; onClose: () => void; onSuccess: () => void }) {
  const { showToast } = useToast();
  const [form, setForm] = useState({
    name: product?.name || '', description: product?.description || '', price: product?.price?.toString() || '',
    compareAtPrice: product?.compareAtPrice?.toString() || '', costPrice: product?.costPrice?.toString() || '',
    taxPercent: product?.taxPercent?.toString() || '', categoryId: product?.categoryId || '',
    unit: product?.unit || 'PCS', trackInventory: product?.trackInventory ?? true,
    lowStockThreshold: product?.lowStockThreshold?.toString() || '5', hasVariants: product?.hasVariants || false,
  });
  const [isSaving, setIsSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      const payload = {
        ...form, price: parseFloat(form.price) || 0,
        compareAtPrice: form.compareAtPrice ? parseFloat(form.compareAtPrice) : null,
        costPrice: form.costPrice ? parseFloat(form.costPrice) : null,
        taxPercent: form.taxPercent ? parseFloat(form.taxPercent) : null,
        categoryId: form.categoryId || null,
        lowStockThreshold: form.lowStockThreshold ? parseInt(form.lowStockThreshold) : null,
      };
      if (product) { await productApi.update(storeId, product.id, payload); showToast('Product updated', 'success'); }
      else { await productApi.create(storeId, payload); showToast('Product created', 'success'); }
      onSuccess();
    } catch (err: any) { showToast(err.response?.data?.error?.message || 'Failed', 'error'); }
    finally { setIsSaving(false); }
  };

  return (
    <div className="dialog-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog-content dialog-lg">
        <div className="dialog-header"><h2 className="dialog-title">{product ? 'Edit Product' : 'New Product'}</h2></div>
        <form onSubmit={handleSubmit}>
          <div className="dialog-body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            <div className="form-row">
              <div className="input-wrapper" style={{ flex: 2 }}>
                <label className="input-label">Name *</label>
                <input className="input-field" required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Product name" autoFocus />
              </div>
              <div className="input-wrapper" style={{ flex: 1 }}>
                <label className="input-label">Category</label>
                <select className="input-field select-field" value={form.categoryId} onChange={e => setForm({ ...form, categoryId: e.target.value })}>
                  <option value="">None</option>
                  {categories.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            </div>
            <div className="input-wrapper">
              <label className="input-label">Description</label>
              <textarea className="input-field textarea-field" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Product description" />
            </div>
            <div className="form-row" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
              <div className="input-wrapper"><label className="input-label">Price (₹) *</label><input type="number" step="0.01" min="0" className="input-field" required value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} /></div>
              <div className="input-wrapper"><label className="input-label">Compare At (₹)</label><input type="number" step="0.01" min="0" className="input-field" value={form.compareAtPrice} onChange={e => setForm({ ...form, compareAtPrice: e.target.value })} /></div>
              <div className="input-wrapper"><label className="input-label">Cost (₹)</label><input type="number" step="0.01" min="0" className="input-field" value={form.costPrice} onChange={e => setForm({ ...form, costPrice: e.target.value })} /></div>
            </div>
            <div className="form-row" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
              <div className="input-wrapper"><label className="input-label">Tax %</label><input type="number" step="0.01" min="0" max="100" className="input-field" value={form.taxPercent} onChange={e => setForm({ ...form, taxPercent: e.target.value })} /></div>
              <div className="input-wrapper"><label className="input-label">Unit</label>
                <select className="input-field select-field" value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })}>
                  {['PCS','KG','G','L','ML','M','CM','DOZEN','PACK','BOX','PAIR','SET','ROLL','PLATE','SERVING'].map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
              <div className="input-wrapper"><label className="input-label">Low Stock Alert</label><input type="number" min="0" className="input-field" value={form.lowStockThreshold} onChange={e => setForm({ ...form, lowStockThreshold: e.target.value })} /></div>
            </div>
            <label className="switch" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
              <input type="checkbox" className="switch-input" checked={form.trackInventory} onChange={e => setForm({ ...form, trackInventory: e.target.checked })} />
              <span className="switch-slider" /><span style={{ fontSize: 'var(--text-sm)' }}>Track inventory</span>
            </label>
          </div>
          <div className="dialog-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={isSaving}>{isSaving ? 'Saving...' : product ? 'Update' : 'Create'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ProductDetailDrawer({ storeId, product, onClose }: { storeId: string; product: any; onClose: () => void }) {
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const { data: detailRes } = useQuery({
    queryKey: ['product', storeId, product.id],
    queryFn: () => productApi.get(storeId, product.id),
  });
  const detail = detailRes?.data?.data || product;

  const handleImageUpload = async (file: File) => {
    try {
      await productApi.uploadImage(storeId, product.id, file);
      queryClient.invalidateQueries({ queryKey: ['product', storeId, product.id] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      showToast('Image uploaded', 'success');
    } catch (err: any) { showToast(err.response?.data?.error?.message || 'Upload failed', 'error'); }
  };

  return (
    <div className="dialog-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="drawer-content">
        <div className="dialog-header" style={{ padding: 'var(--space-5) var(--space-6)' }}>
          <h2 className="dialog-title">{detail.name}</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose}><IconX size={18} /></button>
        </div>
        <div className="drawer-body">
          <div className="form-section-title">Images</div>
          <div className="product-images-grid">
            {(detail.images || []).map((img: any) => (
              <div key={img.id} className="product-image-thumb">
                <img src={img.imageUrl} alt={detail.name} />
              </div>
            ))}
            <label className="product-image-upload">
              <input type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { if (e.target.files?.[0]) handleImageUpload(e.target.files[0]); }} />
              <IconUpload size={18} />
            </label>
          </div>

          <div className="form-section-title" style={{ marginTop: 'var(--space-6)' }}>Details</div>
          <div className="detail-grid">
            <div className="detail-row"><span className="detail-label">Price</span><span style={{ fontWeight: 'var(--font-semibold)' }}>₹{Number(detail.price).toLocaleString('en-IN')}</span></div>
            {detail.costPrice && <div className="detail-row"><span className="detail-label">Cost</span><span>₹{Number(detail.costPrice).toLocaleString('en-IN')}</span></div>}
            {detail.taxPercent && <div className="detail-row"><span className="detail-label">Tax</span><span>{detail.taxPercent}%</span></div>}
            <div className="detail-row"><span className="detail-label">Unit</span><span>{detail.unit}</span></div>
            <div className="detail-row"><span className="detail-label">Status</span><span className={`badge ${(detail.active || detail.isActive) ? 'badge-success' : 'badge-neutral'}`}>{(detail.active || detail.isActive) ? 'Active' : 'Inactive'}</span></div>
            <div className="detail-row"><span className="detail-label">Total Stock</span><span style={{ fontWeight: 'var(--font-semibold)' }}>{detail.totalStock || 0}</span></div>
          </div>

          {detail.variants && detail.variants.length > 0 && (
            <>
              <div className="form-section-title" style={{ marginTop: 'var(--space-6)' }}>Variants</div>
              <div className="table-container" style={{ marginTop: 'var(--space-2)' }}>
                <table className="table">
                  <thead><tr><th>Name</th><th>SKU</th><th>Price</th><th>Stock</th></tr></thead>
                  <tbody>
                    {detail.variants.map((v: any) => (
                      <tr key={v.id}>
                        <td>{v.name}</td>
                        <td><code className="mono">{v.sku}</code></td>
                        <td>₹{Number(v.price).toLocaleString('en-IN')}</td>
                        <td><span className={`badge ${v.quantityOnHand > 0 ? 'badge-success' : 'badge-danger'}`}>{v.quantityOnHand}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
