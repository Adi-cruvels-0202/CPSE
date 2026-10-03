import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { productApi, saleApi, categoryApi } from '../../api/endpoints';
import { errorMessage } from '../../api/client';
import type { Sale } from '../../api/types';
import { useActiveStore } from '../../hooks/useStore';
import { useToast } from '../../hooks/useToast';
import { formatPaise, rupeesToPaise, taxFor } from '../../lib/money';
import { NoStore } from '../../components/common/ui';
import { IconSearch, IconMinus, IconPlus, IconX, IconStore, IconCheck } from '../../components/icons/Icons';
import './Sales.css';

/**
 * The till: a walk-in customer, paid on the spot. The total shown while
 * building the bill uses the same tax rounding as the server, but the server
 * prices the sale itself and its numbers are the ones on the receipt. It sells
 * only what is available — stock held for online orders is never touched.
 */

interface Sellable {
  variantId: string;
  productName: string;
  variantName: string | null;
  sku: string | null;
  categoryId: string | null;
  imageUrl: string | null;
  pricePaise: number;
  taxPercent: number;
  /** null = not counted, never runs out. */
  available: number | null;
}

interface Line extends Sellable {
  quantity: number;
}

const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : `sale-${Date.now()}-${Math.random().toString(36).slice(2)}`);

export default function NewSalePage() {
  const { activeStoreId } = useActiveStore();
  const { showToast } = useToast();
  const queryClient = useQueryClient();

  const [cart, setCart] = useState<Line[]>([]);
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'upi' | 'card' | 'other'>('cash');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [discount, setDiscount] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [done, setDone] = useState<Sale | null>(null);
  // One key per bill: a retried "Charge" after a timeout returns the same sale.
  const idempotencyKey = useRef(newKey());

  const { data: cats } = useQuery({ queryKey: ['categories', activeStoreId], queryFn: () => categoryApi.list(activeStoreId!), enabled: !!activeStoreId });
  const { data: products } = useQuery({ queryKey: ['products', activeStoreId, 'all'], queryFn: () => productApi.all(activeStoreId!), enabled: !!activeStoreId });

  const sellables = useMemo<Sellable[]>(
    () =>
      (products ?? [])
        .filter((product) => product.isActive)
        .flatMap((product) =>
          product.variants
            .filter((variant) => variant.isActive)
            .map((variant) => ({
              variantId: variant.id,
              productName: product.name,
              variantName: variant.name === 'Default' ? null : variant.name,
              sku: variant.sku,
              categoryId: product.categoryId,
              imageUrl: product.images[0]?.url ?? null,
              pricePaise: variant.pricePaise,
              taxPercent: product.taxPercent,
              available: product.trackInventory ? variant.availableQuantity : null,
            })),
        ),
    [products],
  );

  const shown = useMemo(() => {
    const term = search.trim().toLowerCase();
    return sellables.filter(
      (item) =>
        (!categoryId || item.categoryId === categoryId) &&
        (!term || `${item.productName} ${item.variantName ?? ''} ${item.sku ?? ''}`.toLowerCase().includes(term)),
    );
  }, [sellables, search, categoryId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault();
        document.getElementById('pos-search')?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  if (!activeStoreId) return <NoStore title="Counter sale" />;

  const limit = (line: Sellable) => line.available ?? 10_000;
  const add = (item: Sellable) =>
    setCart((current) => {
      const existing = current.find((line) => line.variantId === item.variantId);
      if (existing) return current.map((line) => (line.variantId === item.variantId ? { ...line, quantity: Math.min(line.quantity + 1, limit(line)) } : line));
      return [...current, { ...item, quantity: 1 }];
    });
  const setQuantity = (variantId: string, quantity: number) =>
    setCart((current) =>
      quantity <= 0
        ? current.filter((line) => line.variantId !== variantId)
        : current.map((line) => (line.variantId === variantId ? { ...line, quantity: Math.min(quantity, limit(line)) } : line)),
    );

  const subtotal = cart.reduce((sum, line) => sum + line.pricePaise * line.quantity, 0);
  const tax = cart.reduce((sum, line) => sum + taxFor(line.pricePaise * line.quantity, line.taxPercent), 0);
  const discountPaise = rupeesToPaise(discount) ?? 0;
  const discountInvalid = Number.isNaN(discountPaise) || discountPaise > subtotal + tax;
  const total = subtotal + tax - (Number.isNaN(discountPaise) ? 0 : discountPaise);

  const reset = () => {
    setCart([]);
    setCustomerName('');
    setCustomerPhone('');
    setDiscount('');
    setDone(null);
    idempotencyKey.current = newKey();
  };

  const charge = async () => {
    if (cart.length === 0 || discountInvalid) return;
    setIsSubmitting(true);
    try {
      const { sale } = await saleApi.create(
        activeStoreId,
        {
          items: cart.map((line) => ({ variantId: line.variantId, quantity: line.quantity })),
          paymentMethod,
          customerName: customerName.trim() || null,
          customerPhone: customerPhone.trim() || null,
          discountPaise,
        },
        idempotencyKey.current,
      );
      setDone(sale);
      queryClient.invalidateQueries({ queryKey: ['products', activeStoreId] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', activeStoreId] });
      queryClient.invalidateQueries({ queryKey: ['sales', activeStoreId] });
    } catch (err) {
      showToast(errorMessage(err, 'The sale did not go through.'), 'error');
      // The stock numbers on the tiles may be out of date; fetch them again.
      queryClient.invalidateQueries({ queryKey: ['products', activeStoreId] });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (done) {
    return (
      <div className="sale-layout" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        <div className="sale-cart-zone" style={{ width: 480, height: 'auto', padding: 'var(--space-10)' }}>
          <div className="sale-success-overlay" role="status">
            <div className="sale-success-icon"><IconCheck size={32} /></div>
            <h2 className="heading-3" style={{ marginBottom: 'var(--space-2)' }}>Paid — {done.invoiceNumber}</h2>
            <p className="body-md" style={{ color: 'var(--color-text-secondary)', marginBottom: 'var(--space-6)' }}>
              Total <strong style={{ color: 'var(--navy)' }}>{formatPaise(done.totals.totalPaise)}</strong>
              {done.totals.taxPaise > 0 && <> incl. {formatPaise(done.totals.taxPaise)} GST</>} · {done.paymentMethod.toUpperCase()}
            </p>
            <div style={{ display: 'flex', gap: 'var(--space-4)', width: '100%' }}>
              <Link className="btn btn-secondary" style={{ flex: 1 }} to="/sales">Sales history</Link>
              <button className="btn btn-primary" style={{ flex: 1 }} onClick={reset} autoFocus>Next customer</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="sale-layout">
      <h1 className="sr-only">New counter sale</h1>
      <div className="sale-products-zone">
        <div className="sale-products-header">
          <div className="sale-search-bar">
            <IconSearch size={18} className="search-input-icon" />
            <input id="pos-search" aria-label="Search products" className="input-field" placeholder="Search by name or SKU…" value={search} onChange={(e) => setSearch(e.target.value)} autoFocus style={{ width: '100%' }} />
            {!search && <div className="sale-search-shortcut">⌘K</div>}
            {search && <button className="sale-search-clear" onClick={() => setSearch('')} aria-label="Clear search"><IconX size={14} /></button>}
          </div>
          {(cats?.categories.length ?? 0) > 0 && (
            <div className="sale-categories">
              <button className={`sale-category-chip ${!categoryId ? 'active' : ''}`} onClick={() => setCategoryId(null)}>All items</button>
              {cats!.categories.map((c) => (
                <button key={c.id} className={`sale-category-chip ${categoryId === c.id ? 'active' : ''}`} onClick={() => setCategoryId(c.id)}>{c.name}</button>
              ))}
            </div>
          )}
        </div>

        <div className="sale-product-grid">
          {shown.map((item) => {
            const soldOut = item.available !== null && item.available <= 0;
            return (
              <button key={item.variantId} className="sale-product-card" onClick={() => add(item)} disabled={soldOut}>
                <div className="sale-product-image">
                  {item.imageUrl ? <img src={item.imageUrl} alt="" loading="lazy" /> : <div style={{ fontSize: '24px', fontWeight: 'bold', opacity: 0.2 }}>{item.productName.charAt(0)}</div>}
                </div>
                <div className="sale-product-info">
                  <div className="sale-product-name">{item.productName}</div>
                  <div className="sale-product-variant">{item.variantName ?? ' '}{item.sku && <> · <span className="mono">{item.sku}</span></>}</div>
                  <div className="sale-product-bottom">
                    <span className="sale-product-price">{formatPaise(item.pricePaise)}</span>
                    {item.available !== null && (
                      <span className={`badge ${soldOut ? 'badge-danger' : 'badge-success'}`} style={{ padding: '2px 6px', fontSize: '10px' }}>{soldOut ? 'Out' : item.available}</span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
          {shown.length === 0 && <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: 'var(--space-10)', color: 'var(--color-text-tertiary)' }}>No products found</div>}
        </div>
      </div>

      <div className="sale-cart-zone">
        <div className="sale-cart-header">
          <span className="heading-4" style={{ margin: 0 }}>Current sale</span>
          <button className="btn btn-ghost btn-sm" onClick={reset} disabled={cart.length === 0}>Clear</button>
        </div>

        <div className="sale-cart-items">
          {cart.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--color-text-tertiary)', padding: 'var(--space-6)' }}>
              <div style={{ opacity: 0.2, marginBottom: 'var(--space-4)' }}><IconStore size={40} /></div>
              <p>Tap products to add them.</p>
            </div>
          ) : (
            cart.map((line) => (
              <div key={line.variantId} className="cart-item">
                <div className="cart-item-info">
                  <div className="cart-item-name">{line.productName}</div>
                  {line.variantName && <div className="cart-item-variant">{line.variantName}</div>}
                  <div className="cart-item-price">{formatPaise(line.pricePaise)}{line.taxPercent > 0 && <> + {line.taxPercent}% GST</>}</div>
                </div>
                <div className="cart-item-controls">
                  <div className="cart-qty-widget">
                    <button className="cart-qty-btn" onClick={() => setQuantity(line.variantId, line.quantity - 1)} aria-label="One fewer"><IconMinus size={12} /></button>
                    <span className="cart-qty-val">{line.quantity}</span>
                    <button className="cart-qty-btn" onClick={() => setQuantity(line.variantId, line.quantity + 1)} disabled={line.quantity >= limit(line)} aria-label="One more"><IconPlus size={12} /></button>
                  </div>
                  <div className="cart-item-total">{formatPaise(line.pricePaise * line.quantity)}</div>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="sale-checkout-panel">
          <div className="cart-summary">
            <div className="cart-summary-row"><span>Subtotal</span><span>{formatPaise(subtotal)}</span></div>
            {tax > 0 && <div className="cart-summary-row"><span>GST</span><span>{formatPaise(tax)}</span></div>}
            {discountPaise > 0 && !Number.isNaN(discountPaise) && <div className="cart-summary-row" style={{ color: 'var(--color-success)' }}><span>Discount</span><span>−{formatPaise(discountPaise)}</span></div>}
            <div className="cart-total-row"><span className="cart-total-label">Total</span><span className="cart-total-val">{formatPaise(Math.max(total, 0))}</span></div>
          </div>

          <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
            <select className="input-field select-field" style={{ height: 40, flex: 1 }} value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as typeof paymentMethod)} aria-label="Payment method">
              <option value="cash">Cash</option>
              <option value="upi">UPI</option>
              <option value="card">Card</option>
              <option value="other">Other</option>
            </select>
            <input inputMode="decimal" className="input-field" style={{ height: 40, flex: 1 }} placeholder="Discount ₹" value={discount} onChange={(e) => setDiscount(e.target.value)} aria-label="Discount in rupees" />
          </div>
          {discountInvalid && cart.length > 0 && <span className="input-helper" style={{ color: 'var(--color-danger)' }}>The discount cannot be more than the bill.</span>}
          <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
            <input className="input-field" style={{ height: 40, flex: 1 }} placeholder="Customer name (optional)" maxLength={120} value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
            <input type="tel" className="input-field" style={{ height: 40, flex: 1 }} placeholder="Phone (optional)" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} />
          </div>

          <button className="btn btn-primary btn-lg" onClick={charge} disabled={isSubmitting || cart.length === 0 || discountInvalid} style={{ width: '100%', height: 48, marginTop: 'var(--space-2)' }}>
            {isSubmitting ? 'Charging…' : `Charge ${formatPaise(Math.max(total, 0))}`}
          </button>
        </div>
      </div>
    </div>
  );
}
