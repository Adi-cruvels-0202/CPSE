import React, { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { storefrontApi } from '../../api/endpoints';
import Logo from '../../components/brand/Logo';
import CheckoutModal from './CheckoutModal';
import './Storefront.css';

export default function StorefrontPage() {
  const { slug } = useParams<{ slug: string }>();
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [productPage, setProductPage] = useState(0);

  const { data: storeRes, isLoading, error } = useQuery({
    queryKey: ['storefront', slug],
    queryFn: () => storefrontApi.getStore(slug!),
    enabled: !!slug,
  });

  const { data: catsRes } = useQuery({
    queryKey: ['storefront-cats', slug],
    queryFn: () => storefrontApi.getCategories(slug!),
    enabled: !!slug,
  });

  const { data: productsRes } = useQuery({
    queryKey: ['storefront-products', slug, selectedCategory, productPage],
    queryFn: () => storefrontApi.getProducts(slug!, { categoryId: selectedCategory || undefined, page: productPage, size: 20 }),
    enabled: !!slug,
  });

  const store = storeRes?.data?.data;
  const categories = catsRes?.data?.data || [];
  const products = productsRes?.data?.data || [];
  const totalPages = productsRes?.data?.totalPages || 0;

  // --- CART STATE ---
  const [cart, setCart] = useState<any[]>([]);
  const [showCheckout, setShowCheckout] = useState(false);
  const [selectedVariants, setSelectedVariants] = useState<Record<string, string>>({}); // productId -> variantId

  const handleVariantChange = (productId: string, variantId: string) => {
    setSelectedVariants(prev => ({ ...prev, [productId]: variantId }));
  };

  const getSelectedVariant = (p: any) => {
    if (!p.hasVariants || p.variants.length === 1) return p.variants[0];
    const selectedId = selectedVariants[p.id];
    if (selectedId) return p.variants.find((v: any) => v.id === selectedId) || p.variants[0];
    return p.variants[0];
  };

  const handleAddToCart = (p: any) => {
    const variant = getSelectedVariant(p);
    if (!variant || variant.availableQuantity <= 0) return;

    setCart(prev => {
      const existing = prev.find(item => item.variantId === variant.id);
      if (existing) {
        if (existing.quantity >= variant.availableQuantity) return prev;
        return prev.map(item => item.variantId === variant.id ? { ...item, quantity: item.quantity + 1 } : item);
      }
      return [...prev, {
        variantId: variant.id,
        name: p.hasVariants ? `${p.name} — ${variant.name}` : p.name,
        price: variant.price,
        quantity: 1,
        maxStock: variant.availableQuantity
      }];
    });
  };

  const updateCartQuantity = (variantId: string, quantity: number) => {
    setCart(prev => {
      if (quantity <= 0) return prev.filter(item => item.variantId !== variantId);
      return prev.map(item => item.variantId === variantId ? { ...item, quantity } : item);
    });
  };

  if (isLoading) return (
    <div className="sf-loading"><div className="spinner spinner-lg" /></div>
  );

  if (error || !store) return (
    <div className="sf-error">
      <h1 className="heading-2">Store not found</h1>
      <p className="body-sm">This store doesn't exist or isn't published yet.</p>
    </div>
  );

  const cartItemCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <div className="sf">
      <header className="sf-header">
        {store.coverImageUrl && <div className="sf-cover" style={{ backgroundImage: `url(${store.coverImageUrl})` }} />}
        <div className="sf-header-content">
          {store.logoUrl && <img src={store.logoUrl} alt={store.name} className="sf-logo" />}
          <div className="sf-store-info-box" style={{ flex: 1 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <h1 className="sf-store-name">{store.name}</h1>
                {store.description && <p className="sf-store-desc">{store.description}</p>}
                
                <div className="sf-store-meta">
                  {store.address && <span className="meta-item">📍 {store.address}</span>}
                  {store.phone && <span className="meta-item">📞 {store.phone}</span>}
                  {store.email && <span className="meta-item">✉️ {store.email}</span>}
                  {store.pickupEnabled && <span className="meta-item badge badge-primary" style={{marginLeft: '8px', fontSize: '11px', padding: '2px 6px'}}>Pickup Available</span>}
                </div>
              </div>
              <button 
                className="btn btn-primary" 
                onClick={() => setShowCheckout(true)}
                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 1.2rem', borderRadius: 'var(--radius-full)' }}
              >
                <span>Cart</span>
                {cartItemCount > 0 && (
                  <span style={{ background: 'rgba(255,255,255,0.25)', padding: '0.15rem 0.6rem', borderRadius: 'var(--radius-full)', fontSize: '0.85rem', fontWeight: 600 }}>
                    {cartItemCount}
                  </span>
                )}
              </button>
            </div>
          </div>
        </div>
      </header>

      {categories.length > 0 && (
        <nav className="sf-categories" aria-label="Product categories">
          <button className={`sf-cat-btn ${!selectedCategory ? 'sf-cat-active' : ''}`} onClick={() => { setSelectedCategory(''); setProductPage(0); }}>All</button>
          {categories.map((c: any) => (
            <button key={c.id} className={`sf-cat-btn ${selectedCategory === c.id ? 'sf-cat-active' : ''}`} onClick={() => { setSelectedCategory(c.id); setProductPage(0); }}>{c.name}</button>
          ))}
        </nav>
      )}

      <main className="sf-products">
        {products.length === 0 ? (
          <div className="sf-empty">No products available{selectedCategory ? ' in this category' : ''}.</div>
        ) : (
          <div className="sf-grid">
            {products.map((p: any) => {
              const variant = getSelectedVariant(p);
              const isOutOfStock = !variant || variant.availableQuantity <= 0;
              const cartItem = variant ? cart.find(i => i.variantId === variant.id) : null;
              const atMaxCapacity = cartItem && variant ? cartItem.quantity >= variant.availableQuantity : false;

              return (
                <div key={p.id} className="sf-product-card">
                  <div className="sf-product-img">
                    {p.images && p.images.length > 0 ? <img src={p.images[0].imageUrl} alt={p.name} /> : <div className="sf-product-placeholder">📦</div>}
                  </div>
                  <div className="sf-product-body">
                    <h3 className="sf-product-name">{p.name}</h3>
                    {p.description && <p className="sf-product-desc">{p.description}</p>}
                    
                    {p.hasVariants && p.variants.length > 1 && (
                      <div style={{ marginTop: '0.5rem', marginBottom: '0.5rem' }}>
                        <select 
                          className="input-field select-field" 
                          style={{ padding: '4px 8px', fontSize: '0.85rem', height: 'auto' }}
                          value={selectedVariants[p.id] || p.variants[0].id}
                          onChange={(e) => handleVariantChange(p.id, e.target.value)}
                        >
                          {p.variants.map((v: any) => (
                            <option key={v.id} value={v.id}>{v.name} (Available: {v.availableQuantity})</option>
                          ))}
                        </select>
                      </div>
                    )}

                    <div className="sf-product-footer" style={{ marginTop: 'auto', paddingTop: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div className="sf-product-price">
                          ₹{Number(variant?.price || p.price).toLocaleString('en-IN')}
                          {p.compareAtPrice && Number(p.compareAtPrice) > Number(variant?.price || p.price) && (
                            <span className="sf-product-compare">₹{Number(p.compareAtPrice).toLocaleString('en-IN')}</span>
                          )}
                        </div>
                        <span className="sf-product-unit">per {p.unit?.toLowerCase()}</span>
                      </div>
                      
                      {isOutOfStock ? (
                        <div className="sf-out-of-stock" style={{ marginTop: 0 }}>Out of Stock</div>
                      ) : cartItem ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', background: 'var(--color-bg-secondary)', padding: '0.2rem', borderRadius: 'var(--radius-md)' }}>
                          <button type="button" className="btn btn-secondary btn-sm" style={{ padding: '0.25rem 0.5rem', minWidth: 'auto', border: 'none' }} onClick={() => updateCartQuantity(variant.id, cartItem.quantity - 1)}>-</button>
                          <span style={{ minWidth: '1.2rem', textAlign: 'center', fontWeight: 600, fontSize: '0.9rem' }}>{cartItem.quantity}</span>
                          <button type="button" className="btn btn-secondary btn-sm" style={{ padding: '0.25rem 0.5rem', minWidth: 'auto', border: 'none' }} disabled={atMaxCapacity} onClick={() => updateCartQuantity(variant.id, cartItem.quantity + 1)}>+</button>
                        </div>
                      ) : (
                        <button 
                          className="btn btn-primary btn-sm" 
                          disabled={atMaxCapacity}
                          onClick={() => handleAddToCart(p)}
                          style={{ padding: '6px 16px', borderRadius: 'var(--radius-full)' }}
                        >
                          Add
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {totalPages > 1 && (
          <div className="pagination" style={{ marginTop: 'var(--space-6)' }}>
            <button className="btn btn-secondary btn-sm" disabled={productPage === 0} onClick={() => setProductPage(p => p - 1)}>Previous</button>
            <span className="pagination-info">Page {productPage + 1} of {totalPages}</span>
            <button className="btn btn-secondary btn-sm" disabled={productPage >= totalPages - 1} onClick={() => setProductPage(p => p + 1)}>Next</button>
          </div>
        )}
      </main>

      <footer className="sf-footer">
        <p>Powered by <Logo size="sm" /></p>
      </footer>

      {showCheckout && (
        <CheckoutModal
          slug={slug!}
          cart={cart}
          onUpdateQuantity={updateCartQuantity}
          onClose={() => setShowCheckout(false)}
          onSuccess={() => {
            setCart([]);
            setShowCheckout(false);
            alert("Order placed successfully! Thank you.");
          }}
          storeSettings={{ pickupEnabled: store.pickupEnabled }}
        />
      )}
    </div>
  );
}
