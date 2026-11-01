import { CREW_ACTIVITY_LABELS } from '../constants/config';
import { fmtZonedClock } from './dayOf';

/** One feed line: a verb phrase after the actor's name, plus an optional detail. */
export function describeCrewActivity(
  item: { type: string; detail: string | null; created_at: string },
  timeZone?: string,
): { verb: string; detail: string | null } {
  if (item.type === 'sos_raised') {
    // The server appends "@lat,lng" to the message; coordinates never show in the feed.
    const text = (item.detail ?? '').replace(/\s*@-?\d+(\.\d+)?,-?\d+(\.\d+)?\s*$/, '').trim();
    return { verb: 'raised an SOS', detail: text || null };
  }
  if (item.type === 'sos_cleared') {
    const clock = fmtZonedClock(Date.parse(item.created_at), timeZone);
    return item.detail
      ? { verb: `marked ${item.detail}'s SOS resolved at ${clock}`, detail: null }
      : { verb: `is safe — cleared their SOS at ${clock}`, detail: null };
  }
  return { verb: CREW_ACTIVITY_LABELS[item.type] ?? item.type.replace(/[-_]/g, ' '), detail: item.detail };
}
