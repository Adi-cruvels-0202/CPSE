import { describe, it, expect } from 'vitest';
import { toMinutes, fromMinutes, localNow, resolveOpenState } from '../src/lib/openingHours.js';

/**
 * Pure logic, so every case pins an explicit `now` rather than mocking time.
 * All fixtures use Asia/Kolkata (UTC+5:30) — a half-hour offset, which catches
 * the naive "just add whole hours" mistake.
 */
const IST = 'Asia/Kolkata';

/** 2026-09-16 is a Wednesday. Times given in IST. */
const ist = (time) => new Date(`2026-09-16T${time}:00+05:30`);

const nineToNine = {
  mon: [{ open: '09:00', close: '21:00' }],
  tue: [{ open: '09:00', close: '21:00' }],
  wed: [{ open: '09:00', close: '21:00' }],
  thu: [{ open: '09:00', close: '21:00' }],
  fri: [{ open: '09:00', close: '21:00' }],
  sat: [{ open: '09:00', close: '21:00' }],
  sun: [],
};

describe('toMinutes / fromMinutes', () => {
  it.each([
    ['00:00', 0],
    ['09:30', 570],
    ['23:59', 1439],
    ['9:05', 545],
  ])('parses %s', (input, expected) => {
    expect(toMinutes(input)).toBe(expected);
  });

  it.each([['24:00'], ['09:60'], ['nine'], [''], [null], [930]])('rejects %s', (input) => {
    expect(toMinutes(input)).toBeNull();
  });

  it('round-trips', () => {
    expect(fromMinutes(toMinutes('17:45'))).toBe('17:45');
  });
});

describe('localNow', () => {
  it('resolves the store-local day and time, not the server-local one', () => {
    // 21:00 UTC on Wednesday is already 02:30 Thursday in Kolkata.
    const result = localNow(IST, new Date('2026-09-16T21:00:00Z'));
    expect(result).toMatchObject({ day: 'thu', minutes: 2 * 60 + 30 });
  });

  it('handles midnight without rolling over to 24:00', () => {
    expect(localNow(IST, new Date('2026-09-16T18:30:00Z'))).toMatchObject({ day: 'thu', minutes: 0 });
  });

  it('falls back to UTC for an unknown timezone instead of throwing', () => {
    const result = localNow('Asia/Kolkatta', new Date('2026-09-16T10:00:00Z'));
    expect(result.timezoneValid).toBe(false);
    expect(result.minutes).toBe(600);
  });
});

describe('resolveOpenState — simple hours', () => {
  it('is open inside the window and says when it closes', () => {
    expect(resolveOpenState(nineToNine, IST, ist('14:00'))).toMatchObject({
      isOpen: true,
      closesAt: '21:00',
      opensAt: null,
      localDay: 'wed',
      localTime: '14:00',
    });
  });

  it('is open on the opening minute and closed on the closing minute', () => {
    expect(resolveOpenState(nineToNine, IST, ist('09:00')).isOpen).toBe(true);
    // 21:00 is when the shutters come down, so the store is not open at 21:00.
    expect(resolveOpenState(nineToNine, IST, ist('21:00')).isOpen).toBe(false);
    expect(resolveOpenState(nineToNine, IST, ist('20:59')).isOpen).toBe(true);
  });

  it('reports the same day when it is still before opening', () => {
    expect(resolveOpenState(nineToNine, IST, ist('07:30'))).toMatchObject({
      isOpen: false,
      opensAt: '09:00',
      opensOn: 'wed',
    });
  });

  it('rolls to tomorrow after closing', () => {
    expect(resolveOpenState(nineToNine, IST, ist('22:00'))).toMatchObject({
      isOpen: false,
      opensAt: '09:00',
      opensOn: 'thu',
    });
  });

  it('skips a closed day when looking ahead', () => {
    // Saturday night: Sunday is closed, so the next opening is Monday.
    const saturdayNight = new Date('2026-09-19T22:00:00+05:30');
    expect(resolveOpenState(nineToNine, IST, saturdayNight)).toMatchObject({
      isOpen: false,
      opensOn: 'mon',
      opensAt: '09:00',
    });
  });
});

describe('resolveOpenState — split and overnight hours', () => {
  const splitDay = { wed: [{ open: '09:00', close: '13:00' }, { open: '17:00', close: '21:00' }] };

  it('is closed during the afternoon break and points at the second window', () => {
    expect(resolveOpenState(splitDay, IST, ist('15:00'))).toMatchObject({
      isOpen: false,
      opensAt: '17:00',
      opensOn: 'wed',
    });
  });

  it('is open in both windows', () => {
    expect(resolveOpenState(splitDay, IST, ist('10:00'))).toMatchObject({ isOpen: true, closesAt: '13:00' });
    expect(resolveOpenState(splitDay, IST, ist('18:00'))).toMatchObject({ isOpen: true, closesAt: '21:00' });
  });

  const lateNight = { wed: [{ open: '22:00', close: '02:00' }], thu: [] };

  it('is open before midnight on an overnight window', () => {
    expect(resolveOpenState(lateNight, IST, ist('23:30'))).toMatchObject({ isOpen: true, closesAt: '02:00' });
  });

  it('is still open after midnight, on the following day', () => {
    // 01:00 Thursday — Thursday itself lists no hours, so this can only be
    // open because Wednesday's window ran past midnight.
    const afterMidnight = new Date('2026-09-17T01:00:00+05:30');
    expect(resolveOpenState(lateNight, IST, afterMidnight)).toMatchObject({
      isOpen: true,
      closesAt: '02:00',
      localDay: 'thu',
    });
  });

  it('closes when the overnight window ends', () => {
    const afterClose = new Date('2026-09-17T02:30:00+05:30');
    expect(resolveOpenState(lateNight, IST, afterClose).isOpen).toBe(false);
  });
});

describe('resolveOpenState — degenerate input', () => {
  it.each([
    ['no hours at all', {}],
    ['null', null],
    ['every day empty', { mon: [], tue: [], wed: [] }],
    ['a non-array day', { wed: 'all day' }],
  ])('treats %s as permanently closed with no next opening', (_label, hours) => {
    expect(resolveOpenState(hours, IST, ist('12:00'))).toMatchObject({
      isOpen: false,
      opensAt: null,
      opensOn: null,
    });
  });

  it('ignores malformed windows but keeps the valid ones', () => {
    const hours = { wed: [{ open: 'noon', close: '13:00' }, { open: '17:00', close: '21:00' }] };
    expect(resolveOpenState(hours, IST, ist('12:00'))).toMatchObject({ isOpen: false, opensAt: '17:00' });
    expect(resolveOpenState(hours, IST, ist('18:00')).isOpen).toBe(true);
  });

  it('never throws on a bad timezone', () => {
    expect(() => resolveOpenState(nineToNine, 'Mars/Olympus', ist('12:00'))).not.toThrow();
  });
});
