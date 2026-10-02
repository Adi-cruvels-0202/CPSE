import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { productApi, inventoryApi } from '../../api/endpoints';
import { useActiveStore } from '../../hooks/useStore';
import { useToast } from '../../hooks/useToast';
import { IconClipboard, IconPlus, IconMinus, IconRefresh, IconStore } from '../../components/icons/Icons';
import './Inventory.css';

export default function InventoryPage() {
  const { activeStoreId } = useActiveStore();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [showStockOut, setShowStockOut] = useState(false);
  const [showAdjust, setShowAdjust] = useState(false);

  const { data: productsRes, isLoading } = useQuery({
    queryKey: ['products', activeStoreId, 'all'],
    queryFn: () => productApi.list(activeStoreId!, { page: 0, size: 200 }),
    enabled: !!activeStoreId,
  });

  const products = productsRes?.data?.data || [];
  const allVariants = products.flatMap((p: any) => (p.variants || []).map((v: any) => ({ ...v, productName: p.name, trackInventory: p.trackInventory })));

  if (!activeStoreId) {
    return (
      <div>
        <div className="page-header"><div><h1 className="page-title">Inventory</h1></div></div>
        <div className="empty-state">
          <div className="empty-state-icon"><IconStore size={32} /></div>
          <div className="empty-state-title">No store selected</div>
          <a href="/store/setup" className="btn btn-primary">Go to Store Setup</a>
        </div>
      </div>
    );
  }

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['products'] });

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Inventory</h1>
          <p className="page-subtitle">{allVariants.length} SKUs tracked</p>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <button className="btn btn-secondary" onClick={() => setShowStockOut(true)}><IconMinus size={16} /> Stock Out</button>
          <button className="btn btn-secondary" onClick={() => setShowAdjust(true)}><IconRefresh size={16} /> Adjust</button>
        </div>
      </div>

      {isLoading ? (
        <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner spinner-lg" /></div>
      ) : allVariants.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon"><IconClipboard size={32} /></div>
          <div className="empty-state-title">No products to track</div>
          <div className="empty-state-description">Add products first, then manage their stock here.</div>
          <a href="/products" className="btn btn-primary">Go to Products</a>
        </div>
      ) : (
        <div className="table-container">
          <table className="table">
            <thead><tr><th>Product</th><th>Variant</th><th>SKU</th><th>On Hand</th><th>Reserved</th><th>Available</th><th>Status</th></tr></thead>
            <tbody>
              {allVariants.map((v: any) => {
                const available = (v.quantityOnHand || 0) - (v.reservedQuantity || 0);
                const isLow = v.quantityOnHand <= 5 && v.quantityOnHand > 0;
                const isOut = v.quantityOnHand === 0;
                return (
                  <tr key={v.id}>
                    <td style={{ fontWeight: 'var(--font-medium)' }}>{v.productName}</td>
                    <td>{v.name}</td>
                    <td><code className="mono">{v.sku}</code></td>
                    <td style={{ fontWeight: 'var(--font-semibold)' }}>{v.quantityOnHand}</td>
                    <td>{v.reservedQuantity || 0}</td>
                    <td style={{ fontWeight: 'var(--font-semibold)' }}>{available}</td>
                    <td>
                      <span className={`badge ${isOut ? 'badge-danger' : isLow ? 'badge-warning' : 'badge-success'}`}>
                        {isOut ? 'Out of Stock' : isLow ? 'Low Stock' : 'In Stock'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showStockOut && <StockModal type="out" storeId={activeStoreId!} variants={allVariants} onClose={() => setShowStockOut(false)} onSuccess={() => { setShowStockOut(false); refresh(); }} />}
      {showAdjust && <AdjustModal storeId={activeStoreId!} variants={allVariants} onClose={() => setShowAdjust(false)} onSuccess={() => { setShowAdjust(false); refresh(); }} />}
    </div>
  );
}

function StockModal({ type, storeId, variants, onClose, onSuccess }: { type: 'in' | 'out'; storeId: string; variants: any[]; onClose: () => void; onSuccess: () => void }) {
  const { showToast } = useToast();
  const [variantId, setVariantId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unitCost, setUnitCost] = useState('');
  const [movementType, setMovementType] = useState('STOCK_OUT');
  const [notes, setNotes] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      const payload: any = { variantId, quantity: parseInt(quantity), unitCost: unitCost ? parseFloat(unitCost) : undefined, notes: notes || undefined };
      if (type === 'out') payload.type = movementType;
      
      if (type === 'in') await inventoryApi.stockIn(storeId, payload);
      else await inventoryApi.stockOut(storeId, payload);
      showToast(`Stock ${type === 'in' ? 'added' : 'removed'} successfully`, 'success');
      onSuccess();
    } catch (err: any) { showToast(err.response?.data?.error?.message || `Stock ${type} failed`, 'error'); }
    finally { setIsSaving(false); }
  };

  return (
    <div className="dialog-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog-content">
        <div className="dialog-header"><h2 className="dialog-title">Stock {type === 'in' ? 'In' : 'Out'}</h2></div>
        <form onSubmit={handleSubmit}>
          <div className="dialog-body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            <div className="input-wrapper"><label className="input-label">SKU / Variant *</label>
              <select className="input-field select-field" required value={variantId} onChange={e => setVariantId(e.target.value)}>
                <option value="">Select variant...</option>
                {variants.map((v: any) => <option key={v.id} value={v.id}>{v.productName} — {v.name} ({v.sku})</option>)}
              </select>
            </div>
            <div className="form-row">
              <div className="input-wrapper"><label className="input-label">Quantity *</label><input type="number" min="1" className="input-field" required value={quantity} onChange={e => setQuantity(e.target.value)} /></div>
              {type === 'in' && <div className="input-wrapper"><label className="input-label">Unit Cost (₹)</label><input type="number" step="0.01" min="0" className="input-field" value={unitCost} onChange={e => setUnitCost(e.target.value)} /></div>}
              {type === 'out' && (
                <div className="input-wrapper">
                  <label className="input-label">Type *</label>
                  <select className="input-field select-field" required value={movementType} onChange={e => setMovementType(e.target.value)}>
                    <option value="STOCK_OUT">General Stock Out</option>
                    <option value="DAMAGE">Damage</option>
                    <option value="EXPIRY">Expiry</option>
                  </select>
                </div>
              )}
            </div>
            <div className="input-wrapper"><label className="input-label">Notes</label><textarea className="input-field textarea-field" value={notes} onChange={e => setNotes(e.target.value)} /></div>
          </div>
          <div className="dialog-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className={`btn ${type === 'in' ? 'btn-success' : 'btn-primary'}`} disabled={isSaving}>{isSaving ? 'Processing...' : type === 'in' ? 'Add Stock' : 'Remove Stock'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function AdjustModal({ storeId, variants, onClose, onSuccess }: { storeId: string; variants: any[]; onClose: () => void; onSuccess: () => void }) {
  const { showToast } = useToast();
  const [variantId, setVariantId] = useState('');
  const [newQuantity, setNewQuantity] = useState('');
  const [movementType, setMovementType] = useState('ADJUSTMENT');
  const [reason, setReason] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const selectedVariant = variants.find((v: any) => v.id === variantId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      await inventoryApi.adjust(storeId, { variantId, newQuantity: parseInt(newQuantity), type: movementType, reason });
      showToast('Stock adjusted', 'success');
      onSuccess();
    } catch (err: any) { showToast(err.response?.data?.error?.message || 'Adjustment failed', 'error'); }
    finally { setIsSaving(false); }
  };

  return (
    <div className="dialog-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog-content">
        <div className="dialog-header"><h2 className="dialog-title">Adjust Stock</h2></div>
        <form onSubmit={handleSubmit}>
          <div className="dialog-body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            <div className="input-wrapper"><label className="input-label">SKU / Variant *</label>
              <select className="input-field select-field" required value={variantId} onChange={e => setVariantId(e.target.value)}>
                <option value="">Select variant...</option>
                {variants.map((v: any) => <option key={v.id} value={v.id}>{v.productName} — {v.name} ({v.sku}) [Current: {v.quantityOnHand}]</option>)}
              </select>
            </div>
            {selectedVariant && <div className="badge badge-neutral" style={{ alignSelf: 'flex-start' }}>Current stock: {selectedVariant.quantityOnHand}</div>}
            <div className="form-row">
              <div className="input-wrapper"><label className="input-label">New Quantity *</label><input type="number" min="0" className="input-field" required value={newQuantity} onChange={e => setNewQuantity(e.target.value)} /></div>
              <div className="input-wrapper">
                <label className="input-label">Type *</label>
                <select className="input-field select-field" required value={movementType} onChange={e => setMovementType(e.target.value)}>
                  <option value="ADJUSTMENT">General Adjustment</option>
                  <option value="DAMAGE">Damage</option>
                  <option value="EXPIRY">Expiry</option>
                </select>
              </div>
            </div>
            <div className="input-wrapper"><label className="input-label">Reason *</label><textarea className="input-field textarea-field" required value={reason} onChange={e => setReason(e.target.value)} placeholder="Why is the stock being adjusted?" /></div>
          </div>
          <div className="dialog-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={isSaving}>{isSaving ? 'Adjusting...' : 'Adjust Stock'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
