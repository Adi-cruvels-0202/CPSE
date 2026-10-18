/**
 * Khata ageing — how much of a balance is outstanding, and how much of that is
 * overdue — derived from the ledger alone (roadmap §4 P2 "Khata statements",
 * "Due dates & reminders", P4 "Khata analytics").
 *
 * Credits settle the OLDEST charges first (first in, first out), which is how a
 * shopkeeper reads a khata: a payment clears the earliest bill. Whatever is left
 * of a charge after that is outstanding, and overdue once its due date has
 * passed. Pure: no database, no clock — `asOf` is a 'YYYY-MM-DD' date in the
 * store's timezone, chosen by the caller.
 *
 * `entries`: [{ type: 'debit'|'credit', amount_paise, due_date, occurred_at, created_at? }]
 */
export function khataAgeing(entries, asOf) {
  const byTime = (a, b) =>
    String(a.occurred_at).localeCompare(String(b.occurred_at)) ||
    String(a.created_at ?? '').localeCompare(String(b.created_at ?? ''));

  let credits = entries.filter((e) => e.type === 'credit').reduce((sum, e) => sum + e.amount_paise, 0);
  const charges = entries.filter((e) => e.type === 'debit').sort(byTime);

  let outstandingPaise = 0;
  let overduePaise = 0;
  let earliestDueDate = null;
  const openCharges = [];

  for (const charge of charges) {
    const settled = Math.min(credits, charge.amount_paise);
    credits -= settled;
    const left = charge.amount_paise - settled;
    if (left <= 0) continue;

    outstandingPaise += left;
    const due = charge.due_date ?? null;
    const isOverdue = due !== null && due < asOf;
    if (isOverdue) overduePaise += left;
    if (due !== null && (earliestDueDate === null || due < earliestDueDate)) earliestDueDate = due;
    openCharges.push({ id: charge.id ?? null, remainingPaise: left, dueDate: due, isOverdue });
  }

  return {
    outstandingPaise,
    overduePaise,
    // Credit the customer has with the store beyond everything they owe.
    advancePaise: credits,
    earliestDueDate,
    openCharges,
  };
}

/** Today's date in a timezone, as 'YYYY-MM-DD'. */
export function localDate(now, timeZone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** 'YYYY-MM-DD' plus whole days. */
export function addDays(isoDate, days) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}
