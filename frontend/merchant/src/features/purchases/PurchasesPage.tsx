import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { purchaseApi, productApi } from '../../api/endpoints';
import { useActiveStore } from '../../hooks/useStore';
import { useToast } from '../../hooks/useToast';
import { IconCart, IconPlus, IconEye, IconStore, IconX } from '../../components/icons/Icons';

export default function PurchasesPage() {
  const { activeStoreId } = useActiveStore();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(0);
  const [showModal, setShowModal] = useState(false);
  const [viewPurchase, setViewPurchase] = useState<any>(null);

  const { data: purchasesRes, isLoading } = useQuery({
    queryKey: ['purchases', activeStoreId, page],
    queryFn: () => purchaseApi.list(activeStoreId!, { page, size: 20 }),
    enabled: !!activeStoreId,
  });

  const purchases = purchasesRes?.data?.data || [];
  const totalPages = purchasesRes?.data?.totalPages || 0;

  if (!activeStoreId) return (
    <div>
      <div className="page-header"><div><h1 className="page-title">Purchases</h1></div></div>
      <div className="empty-state"><div className="empty-state-icon"><IconStore size={32} /></div><div className="empty-state-title">No store selected</div></div>
    </div>
  );

  return (
    <div>
      <div className="page-header">
        <div><h1 className="page-title">Purchases</h1><p className="page-subtitle">{purchasesRes?.data?.totalElements || 0} purchase orders</p></div>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}><IconPlus size={16} /> New Purchase</button>
      </div>

      {isLoading ? (
        <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner spinner-lg" /></div>
      ) : purchases.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon"><IconCart size={32} /></div>
          <div className="empty-state-title">No purchases yet</div>
          <div className="empty-state-description">Record a purchase to stock up your inventory.</div>
          <button className="btn btn-primary" onClick={() => setShowModal(true)}>Record Purchase</button>
        </div>
      ) : (
        <>
          <div className="table-container">
            <table className="table">
              <thead><tr><th>PO #</th><th>Date</th><th>Supplier</th><th>Items</th><th>Total</th><th style={{ width: 60 }}></th></tr></thead>
              <tbody>
                {purchases.map((p: any) => (
                  <tr key={p.id}>
                    <td style={{ fontWeight: 'var(--font-semibold)' }}>{p.purchaseNumber}</td>
                    <td style={{ fontSize: 'var(--text-xs)' }}>{new Date(p.purchaseDate || p.createdAt).toLocaleDateString('en-IN')}</td>
                    <td>{p.supplierName || '—'}</td>
                    <td>{p.itemCount} items</td>
                    <td style={{ fontWeight: 'var(--font-bold)' }}>₹{Number(p.totalAmount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                    <td><button className="btn btn-ghost btn-sm" onClick={() => setViewPurchase(p)}><IconEye size={14} /></button></td>
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

      {showModal && <NewPurchaseModal storeId={activeStoreId!} onClose={() => setShowModal(false)} onSuccess={() => { setShowModal(false); queryClient.invalidateQueries({ queryKey: ['purchases'] }); queryClient.invalidateQueries({ queryKey: ['products'] }); }} />}
      {viewPurchase && <PurchaseDetailModal storeId={activeStoreId!} purchase={viewPurchase} onClose={() => setViewPurchase(null)} />}
    </div>
  );
}

function NewPurchaseModal({ storeId, onClose, onSuccess }: { storeId: string; onClose: () => void; onSuccess: () => void }) {
  const { showToast } = useToast();
  const { data: productsRes } = useQuery({
    queryKey: ['products', storeId, 'all-purchase'],
    queryFn: () => productApi.list(storeId, { page: 0, size: 500 }),
  });
  const allVariants = (productsRes?.data?.data || []).flatMap((p: any) => (p.variants || []).map((v: any) => ({ ...v, productName: p.name })));

  const [supplierName, setSupplierName] = useState('');
  const [supplierContact, setSupplierContact] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState([{ variantId: '', quantity: '1', unitCost: '', batchNumber: '', expiryDate: '' }]);
  const [isSaving, setIsSaving] = useState(false);

  const addItem = () => setItems([...items, { variantId: '', quantity: '1', unitCost: '', batchNumber: '', expiryDate: '' }]);
  const removeItem = (i: number) => setItems(items.filter((_, idx) => idx !== i));
  const updateItem = (i: number, field: string, value: string) => setItems(items.map((item, idx) => idx === i ? { ...item, [field]: value } : item));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      await purchaseApi.create(storeId, {
        supplierName: supplierName || undefined, supplierContact: supplierContact || undefined,
        purchaseDate: new Date().toISOString().split('T')[0], notes: notes || undefined,
        items: items.filter(i => i.variantId).map(i => ({
          variantId: i.variantId, quantity: parseInt(i.quantity) || 1,
          unitCost: parseFloat(i.unitCost) || 0,
          batchNumber: i.batchNumber || undefined,
          expiryDate: i.expiryDate || undefined,
        })),
      });
      showToast('Purchase recorded!', 'success');
      onSuccess();
    } catch (err: any) { showToast(err.response?.data?.error?.message || 'Failed', 'error'); }
    finally { setIsSaving(false); }
  };

  return (
    <div className="dialog-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog-content dialog-lg" style={{ maxWidth: 720 }}>
        <div className="dialog-header"><h2 className="dialog-title">New Purchase Order</h2></div>
        <form onSubmit={handleSubmit}>
          <div className="dialog-body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', maxHeight: '60vh', overflowY: 'auto' }}>
            <div className="form-row">
              <div className="input-wrapper"><label className="input-label">Supplier Name</label><input className="input-field" value={supplierName} onChange={e => setSupplierName(e.target.value)} /></div>
              <div className="input-wrapper"><label className="input-label">Supplier Contact</label><input className="input-field" value={supplierContact} onChange={e => setSupplierContact(e.target.value)} /></div>
            </div>
            <div className="form-section-title">Items</div>
            {items.map((item, i) => {
              const lineTotal = (parseFloat(item.quantity) || 0) * (parseFloat(item.unitCost) || 0);
              return (
              <div key={i} style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-end', flexWrap: 'wrap', padding: 'var(--space-3)', background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-lg)' }}>
                <div className="input-wrapper" style={{ flex: 2, minWidth: 180 }}>
                  <label className="input-label">Product *</label>
                  <select className="input-field select-field" required value={item.variantId} onChange={e => updateItem(i, 'variantId', e.target.value)}>
                    <option value="">Select...</option>
                    {allVariants.map((v: any) => <option key={v.id} value={v.id}>{v.productName} — {v.name} ({v.sku})</option>)}
                  </select>
                </div>
                <div className="input-wrapper" style={{ width: 70 }}><label className="input-label">Qty *</label><input type="number" min="1" className="input-field" required value={item.quantity} onChange={e => updateItem(i, 'quantity', e.target.value)} /></div>
                <div className="input-wrapper" style={{ width: 90 }}><label className="input-label">Cost (₹) *</label><input type="number" step="0.01" min="0" className="input-field" required value={item.unitCost} onChange={e => updateItem(i, 'unitCost', e.target.value)} /></div>
                <div className="input-wrapper" style={{ width: 100 }}><label className="input-label">Total (₹)</label><div className="input-field" style={{ background: 'var(--color-bg-tertiary, #e9ecef)', fontWeight: 'var(--font-semibold)', display: 'flex', alignItems: 'center', color: lineTotal > 0 ? 'var(--color-success, #16a34a)' : undefined }}>₹{lineTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div></div>
                <div className="input-wrapper" style={{ width: 100 }}><label className="input-label">Batch #</label><input className="input-field" value={item.batchNumber} onChange={e => updateItem(i, 'batchNumber', e.target.value)} /></div>
                <div className="input-wrapper" style={{ width: 130 }}><label className="input-label">Expiry</label><input type="date" className="input-field" value={item.expiryDate} onChange={e => updateItem(i, 'expiryDate', e.target.value)} /></div>
                {items.length > 1 && <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeItem(i)} style={{ color: 'var(--color-danger)' }}><IconX size={14} /></button>}
              </div>
              );
            })}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <button type="button" className="btn btn-secondary btn-sm" onClick={addItem}><IconPlus size={14} /> Add Item</button>
              <div style={{ fontWeight: 'var(--font-bold)', fontSize: 'var(--text-base)' }}>
                Grand Total: <span style={{ color: 'var(--color-success, #16a34a)' }}>₹{items.reduce((sum, item) => sum + (parseFloat(item.quantity) || 0) * (parseFloat(item.unitCost) || 0), 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
              </div>
            </div>
            <div className="input-wrapper"><label className="input-label">Notes</label><textarea className="input-field textarea-field" value={notes} onChange={e => setNotes(e.target.value)} /></div>
          </div>
          <div className="dialog-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={isSaving}>{isSaving ? 'Recording...' : 'Record Purchase'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function PurchaseDetailModal({ storeId, purchase, onClose }: { storeId: string; purchase: any; onClose: () => void }) {
  const { data: detailRes } = useQuery({
    queryKey: ['purchase', storeId, purchase.id],
    queryFn: () => purchaseApi.get(storeId, purchase.id),
  });
  const detail = detailRes?.data?.data || purchase;

  return (
    <div className="dialog-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog-content dialog-lg">
        <div className="dialog-header"><h2 className="dialog-title">{detail.purchaseNumber}</h2></div>
        <div className="dialog-body">
          <div className="detail-grid" style={{ marginBottom: 'var(--space-4)' }}>
            <div className="detail-row"><span className="detail-label">Date</span><span>{new Date(detail.purchaseDate || detail.createdAt).toLocaleDateString('en-IN')}</span></div>
            {detail.supplierName && <div className="detail-row"><span className="detail-label">Supplier</span><span>{detail.supplierName}</span></div>}
            <div className="detail-row"><span className="detail-label">Total</span><span style={{ fontWeight: 'var(--font-bold)' }}>₹{Number(detail.totalAmount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span></div>
          </div>
          {detail.items && (
            <div className="table-container">
              <table className="table">
                <thead><tr><th>Product</th><th>SKU</th><th>Qty</th><th>Cost</th><th>Batch</th><th>Expiry</th><th>Total</th></tr></thead>
                <tbody>
                  {detail.items.map((i: any) => (
                    <tr key={i.id}>
                      <td>{i.productName} ({i.variantName})</td>
                      <td><code className="mono">{i.sku}</code></td>
                      <td>{i.quantity}</td>
                      <td>₹{Number(i.unitCost).toFixed(2)}</td>
                      <td>{i.batchNumber || '—'}</td>
                      <td>{i.expiryDate ? new Date(i.expiryDate).toLocaleDateString('en-IN') : '—'}</td>
                      <td style={{ fontWeight: 'var(--font-semibold)' }}>₹{Number(i.lineTotal).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className="dialog-footer"><button className="btn btn-secondary" onClick={onClose}>Close</button></div>
      </div>
    </div>
  );
}
