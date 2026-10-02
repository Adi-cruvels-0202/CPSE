import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { saleApi } from '../../api/endpoints';
import { useActiveStore } from '../../hooks/useStore';
import { formatPaise } from '../../lib/money';
import { EmptyState, NoStore, Pagination, Spinner, formatDateTime } from '../../components/common/ui';
import { IconTrendingUp, IconPlus, IconEye } from '../../components/icons/Icons';
import './Sales.css';

/** Counter sales, newest first. Online orders are under Online orders. */
export default function SalesHistoryPage() {
  const { activeStoreId } = useActiveStore();
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['sales', activeStoreId, page],
    queryFn: () => saleApi.list(activeStoreId!, { page, limit: 20 }),
    enabled: !!activeStoreId,
  });

  if (!activeStoreId) return <NoStore title="Sales history" />;
  const sales = data?.data.sales ?? [];

  return (
    <div>
      <div className="page-header">
        <div><h1 className="page-title">Counter sales</h1><p className="page-subtitle">{data?.meta?.total ?? 0} sales</p></div>
        <Link to="/sales/new" className="btn btn-primary"><IconPlus size={16} /> New sale</Link>
      </div>

      {isLoading ? <Spinner large /> : sales.length === 0 ? (
        <EmptyState
          icon={<IconTrendingUp size={32} />}
          title="No counter sales yet"
          description="Sales you ring up at the till show up here."
          action={<Link to="/sales/new" className="btn btn-primary">Make a sale</Link>}
        />
      ) : (
        <>
          <div className="table-container">
            <table className="table">
              <thead><tr><th>Invoice</th><th>When</th><th>Customer</th><th>Items</th><th>Paid by</th><th>Total</th><th style={{ width: 60 }}></th></tr></thead>
              <tbody>
                {sales.map((sale) => (
                  <tr key={sale.id}>
                    <td style={{ fontWeight: 'var(--font-semibold)' }}>{sale.invoiceNumber}</td>
                    <td style={{ fontSize: 'var(--text-xs)', whiteSpace: 'nowrap' }}>{formatDateTime(sale.createdAt)}</td>
                    <td>{sale.customerName ?? '—'}</td>
                    <td>{sale.itemCount} {sale.itemCount === 1 ? 'item' : 'items'}</td>
                    <td><span className="badge badge-neutral">{sale.paymentMethod.toUpperCase()}</span></td>
                    <td style={{ fontWeight: 'var(--font-bold)', whiteSpace: 'nowrap' }}>{formatPaise(sale.totals.totalPaise)}</td>
                    <td><button className="btn btn-ghost btn-sm" onClick={() => setOpenId(sale.id)} aria-label={`Open ${sale.invoiceNumber}`}><IconEye size={14} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination meta={data?.meta} onPage={setPage} />
        </>
      )}

      {openId && <SaleDetailModal storeId={activeStoreId} saleId={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function SaleDetailModal({ storeId, saleId, onClose }: { storeId: string; saleId: string; onClose: () => void }) {
  const { data, isLoading } = useQuery({ queryKey: ['sale', storeId, saleId], queryFn: () => saleApi.get(storeId, saleId) });
  const sale = data?.sale;

  return (
    <div className="dialog-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog-content dialog-lg" role="dialog" aria-modal="true" aria-labelledby="sale-title">
        <div className="dialog-header"><h2 className="dialog-title" id="sale-title">Invoice {sale?.invoiceNumber ?? ''}</h2></div>
        <div className="dialog-body">
          {isLoading || !sale ? <Spinner /> : (
            <>
              <div className="detail-grid" style={{ marginBottom: 'var(--space-4)' }}>
                <div className="detail-row"><span className="detail-label">When</span><span>{formatDateTime(sale.createdAt)}</span></div>
                {sale.customerName && <div className="detail-row"><span className="detail-label">Customer</span><span>{sale.customerName}</span></div>}
                {sale.customerPhone && <div className="detail-row"><span className="detail-label">Phone</span><span>{sale.customerPhone}</span></div>}
                <div className="detail-row"><span className="detail-label">Paid by</span><span className="badge badge-neutral">{sale.paymentMethod.toUpperCase()}</span></div>
              </div>
              <div className="table-container">
                <table className="table">
                  <thead><tr><th>Item</th><th>SKU</th><th>Qty</th><th>Price</th><th>GST</th><th>Line total</th></tr></thead>
                  <tbody>
                    {(sale.items ?? []).map((item) => (
                      <tr key={item.id}>
                        <td>{item.productName}{item.variantName && <span style={{ color: 'var(--color-text-tertiary)' }}> ({item.variantName})</span>}</td>
                        <td><code className="mono">{item.sku ?? '—'}</code></td>
                        <td>{item.quantity}</td>
                        <td>{formatPaise(item.unitPricePaise)}</td>
                        <td>{item.taxPaise > 0 ? formatPaise(item.taxPaise) : '—'}</td>
                        <td style={{ fontWeight: 'var(--font-semibold)' }}>{formatPaise(item.lineTotalPaise)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="cart-summary" style={{ marginTop: 'var(--space-4)' }}>
                <div className="cart-summary-row"><span>Subtotal</span><span>{formatPaise(sale.totals.subtotalPaise)}</span></div>
                {sale.totals.taxPaise > 0 && <div className="cart-summary-row"><span>GST</span><span>{formatPaise(sale.totals.taxPaise)}</span></div>}
                {sale.totals.discountPaise > 0 && <div className="cart-summary-row" style={{ color: 'var(--color-success)' }}><span>Discount</span><span>−{formatPaise(sale.totals.discountPaise)}</span></div>}
                <div className="cart-summary-row cart-total"><span>Total</span><span>{formatPaise(sale.totals.totalPaise)}</span></div>
              </div>
            </>
          )}
        </div>
        <div className="dialog-footer"><button className="btn btn-secondary" onClick={onClose}>Close</button></div>
      </div>
    </div>
  );
}
