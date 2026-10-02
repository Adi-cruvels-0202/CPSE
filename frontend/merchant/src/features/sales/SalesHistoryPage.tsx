import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { salesApi } from '../../api/endpoints';
import { useActiveStore } from '../../hooks/useStore';
import { IconTrendingUp, IconPlus, IconEye, IconStore } from '../../components/icons/Icons';
import './Sales.css';

export default function SalesHistoryPage() {
  const { activeStoreId } = useActiveStore();
  const [page, setPage] = useState(0);
  const [viewSale, setViewSale] = useState<any>(null);

  const { data: salesRes, isLoading } = useQuery({
    queryKey: ['sales', activeStoreId, page],
    queryFn: () => salesApi.list(activeStoreId!, { page, size: 20 }),
    enabled: !!activeStoreId,
  });

  const sales = salesRes?.data?.data || [];
  const totalPages = salesRes?.data?.totalPages || 0;

  if (!activeStoreId) return (
    <div>
      <div className="page-header"><div><h1 className="page-title">Sales History</h1></div></div>
      <div className="empty-state"><div className="empty-state-icon"><IconStore size={32} /></div><div className="empty-state-title">No store selected</div></div>
    </div>
  );

  return (
    <div>
      <div className="page-header">
        <div><h1 className="page-title">Sales History</h1><p className="page-subtitle">{salesRes?.data?.totalElements || 0} sales</p></div>
        <a href="/sales/new" className="btn btn-primary"><IconPlus size={16} /> New Sale</a>
      </div>

      {isLoading ? (
        <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner spinner-lg" /></div>
      ) : sales.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon"><IconTrendingUp size={32} /></div>
          <div className="empty-state-title">No sales yet</div>
          <div className="empty-state-description">Your sales will appear here after you record your first sale.</div>
          <a href="/sales/new" className="btn btn-primary">Make a Sale</a>
        </div>
      ) : (
        <>
          <div className="table-container">
            <table className="table">
              <thead><tr><th>Invoice</th><th>Date</th><th>Customer</th><th>Items</th><th>Payment</th><th>Total</th><th style={{ width: 60 }}></th></tr></thead>
              <tbody>
                {sales.map((s: any) => (
                  <tr key={s.id}>
                    <td style={{ fontWeight: 'var(--font-semibold)' }}>{s.invoiceNumber}</td>
                    <td style={{ fontSize: 'var(--text-xs)', whiteSpace: 'nowrap' }}>{new Date(s.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</td>
                    <td>{s.customerName || '—'}</td>
                    <td>{s.itemCount} {s.itemCount === 1 ? 'item' : 'items'}</td>
                    <td><span className="badge badge-neutral">{(s.paymentMethod || 'N/A').replace('_', ' ')}</span></td>
                    <td style={{ fontWeight: 'var(--font-bold)', whiteSpace: 'nowrap' }}>₹{Number(s.totalAmount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                    <td><button className="btn btn-ghost btn-sm" onClick={() => setViewSale(s)}><IconEye size={14} /></button></td>
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

      {viewSale && <SaleDetailModal storeId={activeStoreId!} sale={viewSale} onClose={() => setViewSale(null)} />}
    </div>
  );
}

function SaleDetailModal({ storeId, sale, onClose }: { storeId: string; sale: any; onClose: () => void }) {
  const { data: detailRes } = useQuery({
    queryKey: ['sale', storeId, sale.id],
    queryFn: () => salesApi.get(storeId, sale.id),
  });
  const detail = detailRes?.data?.data || sale;

  return (
    <div className="dialog-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog-content dialog-lg">
        <div className="dialog-header"><h2 className="dialog-title">Invoice {detail.invoiceNumber}</h2></div>
        <div className="dialog-body">
          <div className="detail-grid" style={{ marginBottom: 'var(--space-4)' }}>
            <div className="detail-row"><span className="detail-label">Date</span><span>{new Date(detail.createdAt).toLocaleString('en-IN')}</span></div>
            {detail.customerName && <div className="detail-row"><span className="detail-label">Customer</span><span>{detail.customerName}</span></div>}
            {detail.customerPhone && <div className="detail-row"><span className="detail-label">Phone</span><span>{detail.customerPhone}</span></div>}
            <div className="detail-row"><span className="detail-label">Payment</span><span className="badge badge-neutral">{(detail.paymentMethod || 'N/A').replace('_', ' ')}</span></div>
          </div>

          {detail.items && detail.items.length > 0 && (
            <div className="table-container">
              <table className="table">
                <thead><tr><th>Product</th><th>SKU</th><th>Qty</th><th>Price</th><th>Tax</th><th>Total</th></tr></thead>
                <tbody>
                  {detail.items.map((i: any) => (
                    <tr key={i.id}>
                      <td>{i.productName} <span style={{ color: 'var(--color-text-tertiary)' }}>({i.variantName})</span></td>
                      <td><code className="mono">{i.sku}</code></td>
                      <td>{i.quantity}</td>
                      <td>₹{Number(i.unitPrice).toLocaleString('en-IN')}</td>
                      <td>₹{Number(i.taxAmount).toFixed(2)}</td>
                      <td style={{ fontWeight: 'var(--font-semibold)' }}>₹{Number(i.lineTotal).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="cart-summary" style={{ marginTop: 'var(--space-4)' }}>
            <div className="cart-summary-row"><span>Subtotal</span><span>₹{Number(detail.subtotal).toFixed(2)}</span></div>
            <div className="cart-summary-row"><span>Tax</span><span>₹{Number(detail.taxAmount).toFixed(2)}</span></div>
            {Number(detail.discountAmount) > 0 && <div className="cart-summary-row" style={{ color: 'var(--color-success)' }}><span>Discount</span><span>−₹{Number(detail.discountAmount).toFixed(2)}</span></div>}
            <div className="cart-summary-row cart-total"><span>Total</span><span>₹{Number(detail.totalAmount).toFixed(2)}</span></div>
          </div>
        </div>
        <div className="dialog-footer"><button className="btn btn-secondary" onClick={onClose}>Close</button></div>
      </div>
    </div>
  );
}
