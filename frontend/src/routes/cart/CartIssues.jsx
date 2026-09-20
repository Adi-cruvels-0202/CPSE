import { formatPaiseShort } from '../../lib/money.js';

/**
 * Surfacing what the server says is wrong with a cart — checklist 11.7.
 *
 * The codes come from the backend and mean specific things, so each one gets
 * wording a customer can act on rather than the raw message being dumped on
 * screen. Anything unrecognised falls back to the server's own sentence, which
 * is written for the customer anyway — so a new code degrades to merely generic,
 * not to silence.
 */

/** Severity decides the colour and whether it blocks checkout. */
const SEVERITY = {
  PRICE_CHANGED: 'warning',
  ITEM_UNAVAILABLE: 'danger',
  OUT_OF_STOCK: 'danger',
  QUANTITY_REDUCED: 'warning',
  MINIMUM_ORDER_NOT_MET: 'warning',
  STORE_CLOSED: 'warning',
};

function describe(issue) {
  switch (issue.code) {
    case 'PRICE_CHANGED':
      // The numbers matter more than the sentence: a customer wants to know
      // which way it moved and by how much.
      return issue.previousUnitPricePaise !== undefined
        ? `Price changed from ${formatPaiseShort(issue.previousUnitPricePaise)} to ${formatPaiseShort(
            issue.unitPricePaise,
          )}.`
        : issue.message;
    case 'ITEM_UNAVAILABLE':
    case 'OUT_OF_STOCK':
      return issue.message ?? 'This item is no longer available.';
    case 'QUANTITY_REDUCED':
      return issue.message ?? 'The shop does not have that many.';
    default:
      return issue.message ?? 'Something needs your attention.';
  }
}

export function LineIssues({ issues }) {
  if (!issues || issues.length === 0) return null;

  return (
    <ul className="cart-line__issues">
      {issues.map((issue, index) => (
        <li
          key={`${issue.code}-${index}`}
          className={`notice notice--${SEVERITY[issue.code] ?? 'warning'}`}
        >
          {describe(issue)}
        </li>
      ))}
    </ul>
  );
}

/**
 * Issues about the cart as a whole — a minimum not met, the shop shut.
 *
 * `role="status"` rather than `alert`: these appear as a consequence of what the
 * customer just did, and an assertive interruption on every quantity change would
 * be exhausting.
 */
export function CartIssues({ issues }) {
  if (!issues || issues.length === 0) return null;

  return (
    <ul className="cart__issues" role="status">
      {issues.map((issue, index) => (
        <li
          key={`${issue.code}-${index}`}
          className={`notice notice--${SEVERITY[issue.code] ?? 'warning'}`}
        >
          {describe(issue)}
        </li>
      ))}
    </ul>
  );
}
