/**
 * Minimal RFC 4180 CSV — quoted fields, doubled quotes, CR/LF line ends — so
 * catalogue import/export needs no dependency. Pure functions.
 */

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const input = text.replace(/^﻿/, '');

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += char;
      continue;
    }
    if (char === '"' && field === '') quoted = true;
    else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && input[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += char;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ''));
}

/** Header row → objects keyed by lower-cased, trimmed header; `line` is the 1-based file line. */
export function csvToObjects(text) {
  const [header, ...body] = parseCsv(text);
  if (!header) return { headers: [], records: [] };
  const headers = header.map((cell) => cell.trim().toLowerCase());
  const records = body.map((cells, index) => ({
    line: index + 2,
    values: Object.fromEntries(headers.map((name, column) => [name, (cells[column] ?? '').trim()])),
  }));
  return { headers, records };
}

const escapeCell = (value) => {
  if (value === null || value === undefined) return '';
  const text = String(value);
  // A leading = + - @ would be run as a formula by a spreadsheet (CSV injection).
  const safe = /^[=+\-@\t\r]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export function toCsv(headers, rows) {
  return [headers.join(','), ...rows.map((row) => headers.map((name) => escapeCell(row[name])).join(','))].join('\r\n') + '\r\n';
}

/** "120", "120.5", "120.50" rupees → paise; anything else → NaN. */
export function rupeesToPaise(text) {
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(text)) return Number.NaN;
  const [whole, fraction = ''] = text.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

export const paiseToRupees = (paise) => (paise === null || paise === undefined ? '' : (paise / 100).toFixed(2));
