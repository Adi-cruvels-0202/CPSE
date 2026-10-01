import './QuantityStepper.css';

/**
 * Minus / number / plus.
 *
 * Buttons rather than a number input: on a phone a numeric keyboard for "how
 * many packets of rice" is more work than two taps, and it lets someone type 500
 * only to be refused later. The bound here is the same one the backend enforces
 * — stock, and a hard cap of 999 — so the button disables instead of the order
 * failing at checkout.
 */
export function QuantityStepper({ value, onChange, max = 999, disabled = false, label = 'Quantity' }) {
  const canDecrease = !disabled && value > 1;
  const canIncrease = !disabled && value < max;

  return (
    <div className="stepper" role="group" aria-label={label}>
      <button
        type="button"
        className="stepper__button"
        onClick={() => onChange(value - 1)}
        disabled={!canDecrease}
        aria-label="One fewer"
      >
        <span aria-hidden="true">−</span>
      </button>

      {/* aria-live so a screen reader hears the new number after a tap, without
          moving focus off the button being tapped. */}
      <output className="stepper__value numeric" aria-live="polite">
        {value}
      </output>

      <button
        type="button"
        className="stepper__button"
        onClick={() => onChange(value + 1)}
        disabled={!canIncrease}
        aria-label="One more"
      >
        <span aria-hidden="true">+</span>
      </button>
    </div>
  );
}
