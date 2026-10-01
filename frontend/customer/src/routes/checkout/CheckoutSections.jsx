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
            <span className="numeric">{formatPaise(line.lineTotalPaise)}</span>
          </li>
        ))}
      </ul>

      <dl className="checkout__totals">
        <Row label="Subtotal">{formatPaise(totals.subtotalPaise)}</Row>
        {totals.discountPaise > 0 ? (
          <Row label="Discount">−{formatPaise(totals.discountPaise)}</Row>
        ) : null}
        {fulfilmentMode === 'delivery' ? (
          <Row label="Delivery">
            {totals.deliveryFeePaise > 0 ? formatPaise(totals.deliveryFeePaise) : 'Free'}
          </Row>
        ) : null}
        {totals.taxPaise > 0 ? <Row label="Tax">{formatPaise(totals.taxPaise)}</Row> : null}
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
