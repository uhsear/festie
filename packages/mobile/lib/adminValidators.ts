// adminValidators — mobile-LOCAL, framework-free validators for the admin edit
// surfaces. Lifted out of components/admin/AdminFields.tsx so the pure branches
// behind DateField / TimeField / HexColorField can be unit-tested in isolation
// without pulling react / react-native (and the token runtime) into a node
// vitest run. AdminFields.tsx re-exports these, so the component and any other
// importer are unchanged.
//
// No React, no react-native imports — keep this importable from a plain test.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** The accepted #RRGGBB hex-color pattern (6 hex digits, leading hash). */
export const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/** True when the value is a structurally-valid YYYY-MM-DD calendar date. */
export function isValidDate(value: string): boolean {
  const v = value.trim();
  if (!DATE_RE.test(v)) return false;
  const parts = v.split('-');
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** True when the value is a valid 24h HH:MM time. */
export function isValidTime(value: string): boolean {
  return TIME_RE.test(value.trim());
}

/** Case-insensitive substring filter on option labels; a blank query keeps all. */
export function filterOptions<T extends { label: string }>(options: readonly T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  return q ? options.filter((o) => o.label.toLowerCase().includes(q)) : [...options];
}

/**
 * Initial Date for the Android system picker. A valid date opens at local noon
 * (keeps the day stable across DST); a valid time opens today at that time.
 * Blank, "TBA" or invalid values open at `now` (dates) or today 12:00 (times).
 */
export function pickerDateFromValue(kind: 'date' | 'time', value: string, now: Date = new Date()): Date {
  const v = value.trim();
  if (kind === 'date') {
    if (!isValidDate(v)) return now;
    const [y = 0, m = 1, d = 1] = v.split('-').map(Number);
    return new Date(y, m - 1, d, 12, 0, 0, 0);
  }
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0, 0);
  if (!isValidTime(v)) return base;
  const [h = 12, min = 0] = v.split(':').map(Number);
  base.setHours(h, min, 0, 0);
  return base;
}

/** Local `YYYY-MM-DD` or 24h `HH:MM` (zero-padded) from a picker Date. */
export function valueFromPickerDate(kind: 'date' | 'time', d: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return kind === 'date'
    ? `${p(d.getFullYear(), 4)}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
    : `${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Empty or a literal "TBA" (case-insensitive) is the permitted fallback. */
export function isTbaFallback(value: string): boolean {
  const v = value.trim();
  return v === '' || v.toLowerCase() === 'tba';
}
