import { CREW_ACTIVITY_LABELS } from '../constants/config';
import type { CrewMember } from '../types/domain';
import { fmtZonedClock } from './dayOf';
import { crewMemberName } from './polls';

/** One feed line: a verb phrase after the actor's name, plus an optional detail. */
export function describeCrewActivity(
  item: { type: string; detail: string | null; created_at: string; user_id?: string },
  timeZone?: string,
  opts?: { members?: CrewMember[]; activeSosUserIds?: ReadonlySet<string> },
): { verb: string; detail: string | null; action: 'show-sos' | null } {
  if (item.type === 'sos_raised') {
    // The server appends "@lat,lng" to the message; coordinates never show in the feed.
    const text = (item.detail ?? '').replace(/\s*@-?\d+(\.\d+)?,-?\d+(\.\d+)?\s*$/, '').trim();
    const action = item.user_id && opts?.activeSosUserIds?.has(item.user_id) ? 'show-sos' : null;
    return { verb: 'raised an SOS', detail: text || null, action };
  }
  if (item.type === 'sos_cleared') {
    const clock = fmtZonedClock(Date.parse(item.created_at), timeZone);
    return item.detail
      ? { verb: `marked ${item.detail}'s SOS resolved at ${clock}`, detail: null, action: null }
      : { verb: `is safe — cleared their SOS at ${clock}`, detail: null, action: null };
  }
  if (item.type === 'owner-changed') {
    const verb = item.detail ? `made ${item.detail} the crew owner` : CREW_ACTIVITY_LABELS['owner-changed']!;
    return { verb, detail: null, action: null };
  }
  if (item.type === 'photo-album-updated') {
    return { verb: CREW_ACTIVITY_LABELS[item.type]!, detail: null, action: null };
  }
  if (item.type === 'expense-settled' || item.type === 'expense_settled') {
    // Old rows end with a raw user id ("$12.00 to <id>"); show the member's name instead.
    const detail = (item.detail ?? '').replace(/(\s)(\S+)$/, (whole, space: string, last: string) => {
      const member = opts?.members?.find((m) => m.userId === last);
      return member ? `${space}${crewMemberName(member)}` : whole;
    });
    return { verb: CREW_ACTIVITY_LABELS['expense-settled']!, detail: detail || null, action: null };
  }
  return { verb: CREW_ACTIVITY_LABELS[item.type] ?? item.type.replace(/[-_]/g, ' '), detail: item.detail, action: null };
}

/** The feed no longer lists every single vote. */
export function visibleCrewActivity<T extends { type: string }>(items: T[]): T[] {
  return items.filter((i) => i.type !== 'poll-voted');
}

export function crewNoticeText(kind: 'removed' | 'deleted', crewName: string | null): { title: string; message: string } {
  if (kind === 'removed') {
    return { title: 'Removed from crew', message: crewName ? `You were removed from ${crewName}.` : 'You were removed from a crew.' };
  }
  return { title: 'Crew deleted', message: crewName ? `${crewName} was deleted by its owner.` : 'Your crew was deleted by its owner.' };
}
