/** Turns "18:00", "6:00 PM", "6 pm" or "6pm" into "HH:MM". Returns null when unreadable. */
export function parseHomeBaseTime(text: string): string | null {
  const m = /^(\d{1,2})(?::(\d{2}))?\s*([ap]m)?$/i.exec(text.trim());
  if (!m) return null;
  let hours = Number(m[1]);
  const minutes = Number(m[2] ?? '0');
  const meridiem = m[3]?.toLowerCase();
  if (minutes > 59) return null;
  if (meridiem) {
    if (hours < 1 || hours > 12) return null;
    hours = (hours % 12) + (meridiem === 'pm' ? 12 : 0);
  } else if (hours > 23) {
    return null;
  }
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}
