import React, { useState } from 'react';
import { storefrontApi } from '../../api/endpoints';

interface CartItem {
  variantId: string;
  name: string;
  price: number;
  quantity: number;
  maxStock: number;
}

interface CheckoutModalProps {
  slug: string;
  cart: CartItem[];
  onUpdateQuantity: (variantId: string, quantity: number) => void;
  onClose: () => void;
  onSuccess: () => void;
  storeSettings: {
    pickupEnabled: boolean;
  };
}

export default function CheckoutModal({ slug, cart, onUpdateQuantity, onClose, onSuccess, storeSettings }: CheckoutModalProps) {
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [orderType, setOrderType] = useState(storeSettings.pickupEnabled ? 'PICKUP' : 'DELIVERY');
  const [paymentMethod, setPaymentMethod] = useState('CASH');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const totalAmount = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (cart.length === 0) return;
    setIsSubmitting(true);
    setError('');

    try {
      const payload = {
        customerName,
        customerPhone,
        customerEmail,
        orderType,
        paymentMethod,
        deliveryAddress: orderType === 'DELIVERY' ? deliveryAddress : undefined,
        notes,
        items: cart.map(item => ({ variantId: item.variantId, quantity: item.quantity }))
      };
      await storefrontApi.placeOrder(slug, payload);
      onSuccess();
    } catch (err: any) {
      setError(err.response?.data?.error?.message || 'Failed to place order. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="dialog-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog-content" style={{ maxWidth: '600px', width: '90%' }}>
        <div className="dialog-header">
          <h2 className="dialog-title">Your Cart</h2>
          <button className="btn btn-secondary btn-sm" onClick={onClose} style={{ border: 'none', background: 'transparent', fontSize: '1.5rem', padding: 0 }}>×</button>
        </div>

        {cart.length === 0 ? (
          <div className="dialog-body" style={{ textAlign: 'center', padding: '2rem' }}>
            <p>Your cart is empty.</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="dialog-body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
              
              {/* Cart Items */}
              <div className="checkout-items">
                {cart.map(item => (
                  <div key={item.variantId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem', marginBottom: '0.5rem' }}>
                    <div style={{ flex: 1 }}>
                      <strong style={{ display: 'block', fontSize: '0.95rem' }}>{item.name}</strong>
                      <span style={{ fontSize: '0.85rem', color: 'var(--color-text-light)' }}>₹{item.price} each</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => onUpdateQuantity(item.variantId, item.quantity - 1)}>-</button>
                      <span style={{ minWidth: '1.5rem', textAlign: 'center' }}>{item.quantity}</span>
                      <button type="button" className="btn btn-secondary btn-sm" disabled={item.quantity >= item.maxStock} onClick={() => onUpdateQuantity(item.variantId, item.quantity + 1)}>+</button>
                    </div>
                    <div style={{ minWidth: '4rem', textAlign: 'right', fontWeight: 600 }}>
                      ₹{item.price * item.quantity}
                    </div>
                  </div>
                ))}
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '1rem', fontSize: '1.1rem', fontWeight: 700 }}>
                  <span>Total</span>
                  <span>₹{totalAmount}</span>
                </div>
              </div>

              {/* Checkout Form */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                <h3 style={{ fontSize: '1rem', margin: 0, borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>Details</h3>
                
                {error && <div className="badge badge-error" style={{ whiteSpace: 'normal', padding: '0.5rem' }}>{error}</div>}

                <div className="form-row">
                  <div className="input-wrapper">
                    <label className="input-label">Name *</label>
                    <input className="input-field" required value={customerName} onChange={e => setCustomerName(e.target.value)} />
                  </div>
                  <div className="input-wrapper">
                    <label className="input-label">Phone *</label>
                    <input type="tel" className="input-field" required value={customerPhone} onChange={e => setCustomerPhone(e.target.value)} />
                  </div>
                </div>

                <div className="form-row">
                  <div className="input-wrapper">
                    <label className="input-label">Email</label>
                    <input type="email" className="input-field" value={customerEmail} onChange={e => setCustomerEmail(e.target.value)} />
                  </div>
                  <div className="input-wrapper">
                    <label className="input-label">Order Type *</label>
                    <select className="input-field select-field" required value={orderType} onChange={e => setOrderType(e.target.value)}>
                      <option value="DELIVERY">Delivery</option>
                      {storeSettings.pickupEnabled && <option value="PICKUP">Pickup</option>}
                    </select>
                  </div>
                </div>

                {orderType === 'DELIVERY' && (
                  <div className="input-wrapper">
                    <label className="input-label">Delivery Address *</label>
                    <textarea className="input-field textarea-field" required value={deliveryAddress} onChange={e => setDeliveryAddress(e.target.value)} rows={2} />
                  </div>
                )}

                <div className="form-row">
                  <div className="input-wrapper">
                    <label className="input-label">Payment Method *</label>
                    <select className="input-field select-field" required value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)}>
                      <option value="CASH">Cash</option>
                      <option value="CARD">Card</option>
                      <option value="UPI">UPI</option>
                    </select>
                  </div>
                </div>

                <div className="input-wrapper">
                  <label className="input-label">Notes for Merchant</label>
                  <input className="input-field" value={notes} onChange={e => setNotes(e.target.value)} />
                </div>
              </div>
            </div>
            
            <div className="dialog-footer" style={{ marginTop: '0', paddingTop: '1rem', borderTop: '1px solid var(--color-border)' }}>
              <button type="button" className="btn btn-secondary" onClick={onClose} disabled={isSubmitting}>Continue Shopping</button>
              <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
                {isSubmitting ? 'Placing Order...' : `Place Order (₹${totalAmount})`}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
