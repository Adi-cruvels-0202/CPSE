import { useState } from 'react';
import { formatPaise } from '../../lib/money.js';

/**
 * The pieces of the checkout screen — checklist 11.8.
 *
 * Split out of CheckoutPage so the page reads as the flow it is: mode, address,
 * payment, note, review.
 */

/** A labelled block, numbered so the flow is visible at a glance. */
export function Step({ step, title, children, hint }) {
  return (
    <section className="checkout__step" aria-labelledby={`step-${step}`}>
      <h2 id={`step-${step}`} className="checkout__step-title">
        <span className="checkout__step-number" aria-hidden="true">
          {step}
        </span>
        {title}
      </h2>
      {hint ? <p className="field__hint">{hint}</p> : null}
      {children}
    </section>
  );
}

/**
 * Pickup or delivery — only what the shop actually offers.
 *
 * Radios rather than a segmented control, because the two options carry different
 * consequences (a fee, an address) and want room to say so.
 */
export function FulfilmentChoice({ fulfilment, value, onChange, disabled }) {
  const options = [
    fulfilment?.pickupEnabled && {
      code: 'pickup',
      label: 'Pick it up',
      detail: 'Collect from the shop. No delivery fee.',
    },
    fulfilment?.deliveryEnabled && {
      code: 'delivery',
      label: 'Have it delivered',
      detail:
        fulfilment.deliveryFeePaise > 0
          ? `${formatPaise(fulfilment.deliveryFeePaise)} delivery fee.`
          : 'Free delivery.',
    },
  ].filter(Boolean);

  return (
    <div className="choices" role="radiogroup" aria-label="How to get your order">
      {options.map((option) => (
        <label
          key={option.code}
          className={`choice${value === option.code ? ' choice--selected' : ''}`}
        >
          <input
            type="radio"
            name="fulfilmentMode"
            value={option.code}
            checked={value === option.code}
            onChange={() => onChange(option.code)}
            disabled={disabled}
          />
          <span className="choice__body">
            <span className="choice__label">{option.label}</span>
            <span className="choice__detail">{option.detail}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

/** Cash or online, as the server lists them. */
export function PaymentChoice({ methods, value, onChange, disabled }) {
  return (
    <div className="choices" role="radiogroup" aria-label="How to pay">
      {(methods ?? []).map((method) => (
        <label
          key={method.code}
          className={`choice${value === method.code ? ' choice--selected' : ''}`}
        >
          <input
            type="radio"
            name="paymentMethod"
            value={method.code}
            checked={value === method.code}
            onChange={() => onChange(method.code)}
            disabled={disabled}
          />
          <span className="choice__body">
            <span className="choice__label">{method.label}</span>
            <span className="choice__detail">{method.description}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

/**
 * What the customer is about to be charged, itemised.
 *
 * Every figure is the quote's. The quote is the single gate every order passes
 * through, and order creation prices from the same engine — so a total worked out
 * here could only ever be a number nobody will charge.
 */
export function Review({ quote }) {
  const { lines, totals, store, fulfilmentMode, address } = quote;

  return (
    <div className="stack">
      <ul className="checkout__lines">
        {lines.map((line) => (
          <li key={line.id}>
            <span className="checkout__line-name">
              {line.name}
              {line.variantName ? <span className="muted"> · {line.variantName}</span> : null}
              <span className="muted"> × {line.quantity}</span>
            </span>
            <span className="numeric">{formatPaise(line.lineSubtotalPaise ?? line.lineTotalPaise)}</span>
          </li>
        ))}
      </ul>

      <dl className="checkout__totals">
        <Row label="Subtotal">{formatPaise(totals.subtotalPaise)}</Row>
        {quote.benefits?.coupon?.applies && quote.benefits.coupon.discountPaise > 0 ? (
          <Row label={`Coupon ${quote.benefits.coupon.code}`}>−{formatPaise(quote.benefits.coupon.discountPaise)}</Row>
        ) : null}
        {quote.benefits?.loyalty?.discountPaise > 0 ? (
          <Row label={`${quote.benefits.loyalty.pointsUsed} points`}>−{formatPaise(quote.benefits.loyalty.discountPaise)}</Row>
        ) : null}
        {totals.discountPaise > 0 && !quote.benefits ? (
          <Row label="Discount">−{formatPaise(totals.discountPaise)}</Row>
        ) : null}
        {fulfilmentMode === 'delivery' ? (
          <Row label="Delivery">
            {totals.deliveryFeePaise > 0 ? formatPaise(totals.deliveryFeePaise) : 'Free'}
            {totals.waivedDeliveryPaise > 0 ? <span className="muted"> (coupon)</span> : null}
          </Row>
        ) : null}
        {totals.taxPaise > 0 ? <Row label="GST">{formatPaise(totals.taxPaise)}</Row> : null}
        <Row label="To pay" strong>
          {formatPaise(totals.totalPaise)}
        </Row>
      </dl>


      <div className="checkout__where">
        {fulfilmentMode === 'delivery' && address ? (
          <p className="muted">
            Delivering to {address.recipientName}, {address.line1}, {address.city}
          </p>
        ) : (
          <p className="muted">
            Collect from {store.name}, {store.addressLine1}, {store.city}
          </p>
        )}
      </div>
    </div>
  );
}

function Row({ label, children, strong }) {
  return (
    <div className={`checkout__row${strong ? ' checkout__row--total' : ''}`}>
      <dt>{label}</dt>
      <dd className="numeric">{children}</dd>
    </div>
  );
}

/**
 * Blockers and warnings, exactly as the quote reports them.
 *
 * The distinction is the quote's, not the screen's: a blocker is why the button
 * is disabled, a warning is something to know. A closed shop is a *warning* — the
 * order waits until the shop opens, and blocking it would simply lose the order.
 */
export function QuoteIssues({ blockers, warnings }) {
  return (
    <>
      {(blockers ?? []).length > 0 ? (
        <ul className="checkout__issues" role="alert">
          {blockers.map((blocker, index) => (
            <li key={`${blocker.code}-${index}`} className="notice notice--danger">
              {blocker.message}
              {blocker.shortfallPaise ? (
                <>
                  {' '}
                  Add <strong className="numeric">{formatPaise(blocker.shortfallPaise)}</strong> more.
                </>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {(warnings ?? []).length > 0 ? (
        <ul className="checkout__issues" role="status">
          {warnings.map((warning, index) => (
            <li key={`${warning.code}-${index}`} className="notice notice--warning">
              {warning.message}
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

/**
 * Coupons and points (roadmap §5 P4). The quote judges both: a code that does
 * not apply comes back as a blocker with the reason, and the most points this
 * order can take comes back with the quote — nothing is worked out here.
 */
export function Benefits({ coupons, couponCode, onCoupon, loyalty, quoteLoyalty, redeemPoints, onRedeem, disabled }) {
  const [draft, setDraft] = useState('');
  const balance = quoteLoyalty?.balancePoints ?? loyalty?.balance?.points ?? 0;
  const program = loyalty?.program ?? null;
  const max = quoteLoyalty?.maxRedeemablePoints ?? null;
  const pointValue = quoteLoyalty?.pointValuePaise ?? program?.pointValuePaise ?? null;

  return (
    <div className="stack">
      {couponCode ? (
        <div className="notice notice--success spread">
          <span>
            Coupon <strong>{couponCode}</strong> added
          </span>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => onCoupon(null)} disabled={disabled}>
            Remove
          </button>
        </div>
      ) : (
        <form
          className="inline-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (draft.trim()) onCoupon(draft.trim().toUpperCase());
          }}
        >
          <input
            className="field__input"
            aria-label="Coupon code"
            placeholder="Coupon code"
            value={draft}
            maxLength={30}
            onChange={(event) => setDraft(event.target.value)}
            disabled={disabled}
          />
          <button type="submit" className="btn btn--secondary btn--sm" disabled={disabled || !draft.trim()}>
            Apply
          </button>
        </form>
      )}

      {!couponCode && (coupons ?? []).length > 0 ? (
        <ul className="checkout__coupons" aria-label="Coupons you can use">
          {coupons.map((coupon) => (
            <li key={coupon.id ?? coupon.code}>
              <button type="button" className="coupon-chip" onClick={() => onCoupon(coupon.code)} disabled={disabled}>
                <strong>{coupon.code}</strong> · {coupon.title}
                {coupon.minOrderPaise ? <span className="muted"> (on {formatPaise(coupon.minOrderPaise)}+)</span> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {program && balance > 0 ? (
        <label className="choice">
          <input
            type="checkbox"
            checked={redeemPoints > 0}
            onChange={(event) => onRedeem(event.target.checked ? Math.max(max ?? balance, 1) : 0)}
            disabled={disabled}
          />
          <span className="choice__body">
            <span className="choice__label">
              Use my points — you have {balance}
              {pointValue ? ` (worth ${formatPaise(balance * pointValue)})` : ''}
            </span>
            <span className="choice__detail">
              {max !== null && redeemPoints > 0
                ? `Using ${redeemPoints} points on this order (at most ${max}).`
                : program.summary ?? 'Points can pay for part of an order.'}
            </span>
          </span>
        </label>
      ) : program ? (
        <p className="muted">You earn points here: {program.summary}</p>
      ) : null}
    </div>
  );
}

/** How close a delivery order is to free delivery. */
export function FreeDeliveryProgress({ freeDelivery }) {
  if (!freeDelivery) return null;
  return freeDelivery.isUnlocked ? (
    <p className="notice notice--success">Free delivery unlocked.</p>
  ) : (
    <p className="notice notice--info">
      Add <strong className="numeric">{formatPaise(freeDelivery.remainingPaise)}</strong> more for free delivery
      (on orders of {formatPaise(freeDelivery.thresholdPaise)} or more).
    </p>
  );
}

/** What to do if an item is out of stock — asked before the order, not after. */
export function SubstitutionChoice({ value, onChange, options, disabled }) {
  return (
    <div className="choices" role="radiogroup" aria-label="If something is out of stock">
      {Object.entries(options).map(([code, label]) => (
        <label key={code} className={`choice${value === code ? ' choice--selected' : ''}`}>
          <input type="radio" name="substitutionPreference" value={code} checked={value === code} onChange={() => onChange(code)} disabled={disabled} />
          <span className="choice__body">
            <span className="choice__label">{label}</span>
          </span>
        </label>
      ))}
    </div>
  );
}
