import React, { useState, useMemo, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { productApi, salesApi, categoryApi } from '../../api/endpoints';
import { useActiveStore } from '../../hooks/useStore';
import { useToast } from '../../hooks/useToast';
import { useNavigate } from 'react-router-dom';
import { IconSearch, IconMinus, IconPlus, IconX, IconStore, IconCheck } from '../../components/icons/Icons';
import './Sales.css';

interface CartItem { 
  variantId: string; 
  productName: string; 
  variantName: string; 
  sku: string; 
  price: number; 
  quantity: number; 
  taxPercent: number; 
  maxStock: number; 
}

export default function NewSalePage() {
  const { activeStoreId } = useActiveStore();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  
  const [cart, setCart] = useState<CartItem[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  
  const [paymentMethod, setPaymentMethod] = useState('CASH');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [discount, setDiscount] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successSale, setSuccessSale] = useState<{ id: string, total: number } | null>(null);

  const { data: categoriesRes } = useQuery({
    queryKey: ['categories', activeStoreId],
    queryFn: () => categoryApi.list(activeStoreId!),
    enabled: !!activeStoreId,
  });

  const { data: productsRes } = useQuery({
    queryKey: ['products', activeStoreId, 'all-sale'],
    queryFn: () => productApi.list(activeStoreId!, { page: 0, size: 500 }),
    enabled: !!activeStoreId,
  });

  const categories = categoriesRes?.data?.data || [];
  const products = productsRes?.data?.data || [];
  
  const allVariants = products.flatMap((p: any) => 
    (p.variants || [])
      .filter((v: any) => v.active !== false && v.isActive !== false)
      .map((v: any) => ({ 
        ...v, 
        productName: p.name, 
        categoryId: p.categoryId, 
        imageUrl: p.images && p.images.length > 0 ? p.images[0].imageUrl : null, 
        taxPercent: p.taxPercent || 0 
      }))
  );

  const filteredVariants = useMemo(() => {
    let result = allVariants;
    if (selectedCategoryId) {
      result = result.filter((v: any) => v.categoryId === selectedCategoryId);
    }
    if (searchTerm) {
      const lower = searchTerm.toLowerCase();
      result = result.filter((v: any) => 
        v.productName.toLowerCase().includes(lower) || 
        v.name.toLowerCase().includes(lower) || 
        v.sku.toLowerCase().includes(lower)
      );
    }
    return result;
  }, [allVariants, searchTerm, selectedCategoryId]);

  const addToCart = (v: any) => {
    setCart(prev => {
      const existing = prev.find(i => i.variantId === v.id);
      if (existing) { 
        return prev.map(i => i.variantId === v.id ? { ...i, quantity: Math.min(i.quantity + 1, i.maxStock || 999) } : i); 
      }
      return [...prev, { 
        variantId: v.id, 
        productName: v.productName, 
        variantName: v.name, 
        sku: v.sku, 
        price: Number(v.price), 
        quantity: 1, 
        taxPercent: Number(v.taxPercent || 0), 
        maxStock: v.quantityOnHand || 999 
      }];
    });
  };

  const updateQty = (variantId: string, qty: number) => {
    if (qty <= 0) { setCart(prev => prev.filter(i => i.variantId !== variantId)); return; }
    setCart(prev => prev.map(i => i.variantId === variantId ? { ...i, quantity: Math.min(qty, i.maxStock || 999) } : i));
  };

  const removeItem = (variantId: string) => setCart(prev => prev.filter(i => i.variantId !== variantId));

  const subtotal = cart.reduce((s, i) => s + i.price * i.quantity, 0);
  const totalTax = cart.reduce((s, i) => s + (i.price * i.quantity * i.taxPercent / 100), 0);
  const discountPercent = discount ? parseFloat(discount) || 0 : 0;
  const discountAmt = (subtotal * discountPercent) / 100;
  const grandTotal = Math.max(subtotal + totalTax - discountAmt, 0);

  const handleSubmit = async () => {
    if (cart.length === 0) { showToast('Add items to the sale first', 'warning'); return; }
    setIsSubmitting(true);
    try {
      const idempotencyKey = `sale-${Date.now()}-${Math.random().toString(36).substring(7)}`;
      const res = await salesApi.create(activeStoreId!, {
        items: cart.map(i => ({ variantId: i.variantId, quantity: i.quantity })),
        paymentMethod, 
        customerName: customerName || undefined, 
        customerPhone: customerPhone || undefined,
        discountAmount: discountAmt > 0 ? discountAmt : undefined
      }, idempotencyKey);
      
      setSuccessSale({ id: res.data.id || 'INV-' + Math.floor(Math.random() * 10000), total: grandTotal });
      queryClient.invalidateQueries({ queryKey: ['products'] });
    } catch (err: any) { 
      showToast(err.response?.data?.error?.message || 'Sale failed', 'error'); 
    } finally { 
      setIsSubmitting(false); 
    }
  };

  const resetSale = () => {
    setCart([]);
    setCustomerName('');
    setCustomerPhone('');
    setDiscount('');
    setSuccessSale(null);
  };

  // Keyboard shortcut for search
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        document.getElementById('pos-search')?.focus();
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, []);

  if (!activeStoreId) return (
    <div>
      <div className="page-header"><div><h1 className="page-title">New Sale</h1></div></div>
      <div className="empty-state"><div className="empty-state-icon"><IconStore size={32} /></div><div className="empty-state-title">No store selected</div></div>
    </div>
  );

  if (successSale) {
    return (
      <div className="sale-layout" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        <div className="sale-cart-zone" style={{ width: 480, height: 'auto', padding: 'var(--space-10)' }}>
          <div className="sale-success-overlay">
            <div className="sale-success-icon"><IconCheck size={32} /></div>
            <h2 className="heading-3" style={{ marginBottom: 'var(--space-2)' }}>Sale Completed</h2>
            <p className="body-md" style={{ color: 'var(--color-text-secondary)', marginBottom: 'var(--space-6)' }}>
              Transaction successful. Grand total: <strong style={{ color: 'var(--navy)' }}>₹{successSale.total.toLocaleString('en-IN')}</strong>
            </p>
            <div style={{ display: 'flex', gap: 'var(--space-4)', width: '100%' }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => navigate('/sales')}>View History</button>
              <button className="btn btn-primary" style={{ flex: 1 }} onClick={resetSale}>New Sale</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="sale-layout">
      {/* PRODUCTS ZONE */}
      <div className="sale-products-zone">
        <div className="sale-products-header">
          <div className="sale-search-bar">
            <IconSearch size={18} className="search-input-icon" />
            <input 
              id="pos-search"
              className="input-field" 
              placeholder="Search products by name or SKU..." 
              value={searchTerm} 
              onChange={e => setSearchTerm(e.target.value)} 
              autoFocus 
              style={{ width: '100%' }}
            />
            {!searchTerm && <div className="sale-search-shortcut">⌘K</div>}
            {searchTerm && (
              <button className="sale-search-clear" onClick={() => setSearchTerm('')}>
                <IconX size={14} />
              </button>
            )}
          </div>
          
          {categories.length > 0 && (
            <div className="sale-categories">
              <button 
                className={`sale-category-chip ${!selectedCategoryId ? 'active' : ''}`}
                onClick={() => setSelectedCategoryId(null)}
              >
                All items
              </button>
              {categories.map((c: any) => (
                <button 
                  key={c.id}
                  className={`sale-category-chip ${selectedCategoryId === c.id ? 'active' : ''}`}
                  onClick={() => setSelectedCategoryId(c.id)}
                >
                  {c.name}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="sale-product-grid">
          {filteredVariants.map((v: any) => (
            <button key={v.id} className="sale-product-card" onClick={() => addToCart(v)} disabled={v.quantityOnHand <= 0}>
              <div className="sale-product-image">
                {v.imageUrl ? (
                  <img src={v.imageUrl} alt={v.productName} loading="lazy" />
                ) : (
                  <div style={{ fontSize: '24px', fontWeight: 'bold', opacity: 0.2 }}>{v.productName.charAt(0)}</div>
                )}
              </div>
              <div className="sale-product-info">
                <div className="sale-product-name">{v.productName}</div>
                <div className="sale-product-variant">{v.name} · <span className="mono">{v.sku}</span></div>
                <div className="sale-product-bottom">
                  <span className="sale-product-price">₹{Number(v.price).toLocaleString('en-IN')}</span>
                  <span className={`badge ${v.quantityOnHand > 0 ? 'badge-success' : 'badge-danger'}`} style={{ padding: '2px 6px', fontSize: '10px' }}>
                    {v.quantityOnHand > 0 ? v.quantityOnHand : 'Out'}
                  </span>
                </div>
              </div>
            </button>
          ))}
          {filteredVariants.length === 0 && (
            <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: 'var(--space-10)', color: 'var(--color-text-tertiary)' }}>
              No products found
            </div>
          )}
        </div>
      </div>

      {/* CART ZONE */}
      <div className="sale-cart-zone">
        <div className="sale-cart-header">
          <span className="heading-4" style={{ margin: 0 }}>Current Sale</span>
          <button className="btn btn-ghost btn-sm" onClick={resetSale} disabled={cart.length === 0}>
            Clear
          </button>
        </div>

        <div className="sale-cart-items">
          {cart.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--color-text-tertiary)', padding: 'var(--space-6)' }}>
              <div style={{ opacity: 0.2, marginBottom: 'var(--space-4)' }}><IconStore size={40} /></div>
              <p>Your cart is empty.</p>
              <p style={{ fontSize: 'var(--text-sm)' }}>Select products to begin sale.</p>
            </div>
          ) : (
            cart.map(item => (
              <div key={item.variantId} className="cart-item">
                <div className="cart-item-info">
                  <div className="cart-item-name">{item.productName}</div>
                  <div className="cart-item-variant">{item.variantName}</div>
                  <div className="cart-item-price">₹{item.price.toLocaleString('en-IN')}</div>
                </div>
                <div className="cart-item-controls">
                  <div className="cart-qty-widget">
                    <button className="cart-qty-btn" onClick={() => updateQty(item.variantId, item.quantity - 1)}>
                      <IconMinus size={12} />
                    </button>
                    <span className="cart-qty-val">{item.quantity}</span>
                    <button className="cart-qty-btn" onClick={() => updateQty(item.variantId, item.quantity + 1)} disabled={item.quantity >= item.maxStock}>
                      <IconPlus size={12} />
                    </button>
                  </div>
                  <div className="cart-item-total">₹{(item.price * item.quantity).toLocaleString('en-IN')}</div>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="sale-checkout-panel">
          <div className="cart-summary">
            <div className="cart-summary-row"><span>Subtotal</span><span>₹{subtotal.toLocaleString('en-IN')}</span></div>
            <div className="cart-summary-row"><span>Tax</span><span>₹{totalTax.toFixed(2)}</span></div>
            {discountAmt > 0 && <div className="cart-summary-row" style={{ color: 'var(--color-success)' }}><span>Discount</span><span>−₹{discountAmt.toLocaleString('en-IN')}</span></div>}
            <div className="cart-total-row">
              <span className="cart-total-label">Total</span>
              <span className="cart-total-val">₹{grandTotal.toFixed(2)}</span>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
            <div className="input-wrapper" style={{ flex: 1 }}>
              <select className="input-field select-field" style={{ height: 40 }} value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)}>
                <option value="CASH">Cash</option>
                <option value="UPI">UPI</option>
                <option value="CARD">Card</option>
              </select>
            </div>
            <div className="input-wrapper" style={{ flex: 1 }}>
              <input type="number" min="0" max="100" step="0.01" className="input-field" style={{ height: 40 }} placeholder="Disc %" value={discount} onChange={e => setDiscount(e.target.value)} />
            </div>
          </div>
          
          <div className="input-wrapper">
            <input className="input-field" style={{ height: 40 }} placeholder="Customer Phone (Optional)" value={customerPhone} onChange={e => setCustomerPhone(e.target.value)} />
          </div>

          <button className="btn btn-primary btn-lg" onClick={handleSubmit} disabled={isSubmitting || cart.length === 0} style={{ width: '100%', height: 48, marginTop: 'var(--space-2)' }}>
            {isSubmitting ? 'Processing...' : 'Complete Sale'}
          </button>
        </div>
      </div>
    </div>
  );
}
