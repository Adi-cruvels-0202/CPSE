/**
 * Presenting a store's opening hours. The *computing* is the server's job — it
 * resolves open/closed in the store's own timezone (backend D21), because a
 * client using its own clock would disagree with the shop and with other
 * clients. This file only turns that answer into words.
 */

const DAY_NAMES = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
};

const DAY_ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

/** "08:00" → "8:00 am". The store's local wall clock, not the visitor's. */
export function formatTime(value) {
  if (!value) return null;

  const [rawHours, minutes] = String(value).split(':');
  const hours = Number(rawHours);
  if (Number.isNaN(hours)) return value;

  const suffix = hours < 12 ? 'am' : 'pm';
  const display = hours % 12 === 0 ? 12 : hours % 12;
  return `${display}:${minutes ?? '00'} ${suffix}`;
}

export const dayName = (key) => DAY_NAMES[key] ?? key;

/**
 * The one line a store page leads with.
 *
 * "Closed" on its own is a dead end; a customer's next question is always when
 * it opens, and the server has already told us.
 */
export function describeStatus(hours) {
  if (!hours) return { label: 'Hours unknown', detail: null, isOpen: false };

  if (hours.isOpen) {
    return {
      label: 'Open now',
      detail: hours.closesAt ? `Closes at ${formatTime(hours.closesAt)}` : null,
      isOpen: true,
    };
  }

  if (hours.opensAt) {
    const when =
      hours.opensOn && hours.opensOn !== hours.localDay
        ? `${dayName(hours.opensOn)} at ${formatTime(hours.opensAt)}`
        : formatTime(hours.opensAt);
    return { label: 'Closed', detail: `Opens ${when}`, isOpen: false };
  }

  return { label: 'Closed', detail: null, isOpen: false };
}

/**
 * The week, in order, with each day's windows as text. Days the store is shut
 * are included and said so — a gap in a list reads as missing data.
 */
export function weekSchedule(hours) {
  const openingHours = hours?.openingHours ?? {};

  return DAY_ORDER.map((key) => {
    const windows = openingHours[key];
    const hasWindows = Array.isArray(windows) && windows.length > 0;

    return {
      key,
      name: dayName(key),
      isToday: key === hours?.localDay,
      text: hasWindows
        ? windows
            .map((window) => `${formatTime(window.open)} – ${formatTime(window.close)}`)
            .join(', ')
        : 'Closed',
    };
  });
}
