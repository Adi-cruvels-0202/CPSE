/**
 * Open/closed resolution from a store's opening hours. Checklist 3.2.
 *
 * `opening_hours` is stored as local wall-clock times per weekday:
 *
 *   { "mon": [{ "open": "09:00", "close": "13:00" },
 *              { "open": "17:00", "close": "21:00" }], ... }
 *
 * A missing key or an empty array means closed that day. A window whose close
 * is at or before its open (`22:00`–`02:00`) runs past midnight into the next
 * day, which late-night stores need.
 *
 * Everything here is pure: the caller passes `now`, so the result is testable
 * without freezing the clock.
 */

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** Minutes since midnight, or null if the value is not a valid HH:MM. */
export function toMinutes(time) {
  if (typeof time !== 'string') return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

const pad = (value) => String(value).padStart(2, '0');
export const fromMinutes = (total) => `${pad(Math.floor((total % 1440) / 60))}:${pad(total % 60)}`;

/**
 * The store's local weekday and minute-of-day. Uses Intl rather than a date
 * library so there is no dependency and no DST table to keep current.
 * An unknown zone falls back to UTC instead of throwing — a store page must
 * still render if someone seeds a bad timezone.
 */
export function localNow(timezone, now = new Date()) {
  let parts;
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone || 'UTC',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(now);
  } catch {
    return { ...localNow('UTC', now), timezoneValid: false };
  }

  const read = (type) => parts.find((part) => part.type === type)?.value ?? '';
  // Intl renders midnight as '24' in some ICU versions.
  const hour = Number(read('hour')) % 24;

  return {
    day: read('weekday').toLowerCase().slice(0, 3),
    minutes: hour * 60 + Number(read('minute')),
    timezoneValid: true,
  };
}

/** Normalises one day's windows, dropping anything malformed. */
function windowsFor(openingHours, day) {
  const raw = openingHours?.[day];
  if (!Array.isArray(raw)) return [];

  return raw
    .map((window) => ({ open: toMinutes(window?.open), close: toMinutes(window?.close) }))
    .filter((window) => window.open !== null && window.close !== null);
}

const dayBefore = (day) => DAYS[(DAYS.indexOf(day) + 6) % 7];
const dayAfter = (day) => DAYS[(DAYS.indexOf(day) + 1) % 7];

/**
 * @returns {{
 *   isOpen: boolean,
 *   localTime: string,
 *   localDay: string,
 *   closesAt: string | null,
 *   opensAt: string | null,
 *   opensOn: string | null
 * }}
 * `closesAt` is set while open; `opensAt`/`opensOn` describe the next opening
 * while closed. Both are null for a store that never lists any hours.
 */
export function resolveOpenState(openingHours, timezone, now = new Date()) {
  const { day, minutes } = localNow(timezone, now);
  const base = { localTime: fromMinutes(minutes), localDay: day };

  // Today's windows, plus yesterday's overnight window still running.
  for (const window of windowsFor(openingHours, day)) {
    if (window.close > window.open && minutes >= window.open && minutes < window.close) {
      return { ...base, isOpen: true, closesAt: fromMinutes(window.close), opensAt: null, opensOn: null };
    }
    // Overnight window, evening half.
    if (window.close <= window.open && minutes >= window.open) {
      return { ...base, isOpen: true, closesAt: fromMinutes(window.close), opensAt: null, opensOn: null };
    }
  }

  for (const window of windowsFor(openingHours, dayBefore(day))) {
    if (window.close <= window.open && minutes < window.close) {
      return { ...base, isOpen: true, closesAt: fromMinutes(window.close), opensAt: null, opensOn: null };
    }
  }

  // Closed. Find the next opening, looking at most a week ahead.
  let cursor = day;
  for (let offset = 0; offset < 8; offset += 1) {
    const candidates = windowsFor(openingHours, cursor)
      .filter((window) => offset > 0 || window.open > minutes)
      .sort((a, b) => a.open - b.open);

    if (candidates.length > 0) {
      return {
        ...base,
        isOpen: false,
        closesAt: null,
        opensAt: fromMinutes(candidates[0].open),
        opensOn: cursor,
      };
    }
    cursor = dayAfter(cursor);
  }

  return { ...base, isOpen: false, closesAt: null, opensAt: null, opensOn: null };
}
