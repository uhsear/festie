import type { ActiveMeet } from '@festie/shared/utils';
import type { CrewMeetingPoint } from '@festie/shared/types';

type Href = string | { pathname: string; params: Record<string, string> };

/** The crew tab's Find sub-tab: SOS, status, live location, meeting points. */
export const CREW_MEET_HREF: Href = { pathname: '/(tabs)/crew', params: { tab: 'find' } };

/** The schedule tab (the Browse-lineup target; there is no `/schedule` route). */
export const SCHEDULE_HREF = '/(tabs)';

/**
 * Where tapping the Now surface's meeting point goes: the compass when the
 * point has coordinates, else the crew Find tab (Home Base included).
 */
export function meetHref(
  meet: Pick<ActiveMeet, 'kind' | 'id'> | null,
  meetingPoints: readonly Pick<CrewMeetingPoint, 'id' | 'latitude' | 'longitude'>[],
): Href {
  if (meet?.kind !== 'meeting-point' || !meet.id) return CREW_MEET_HREF;
  const mp = meetingPoints.find((p) => p.id === meet.id);
  const navigable = Number.isFinite(mp?.latitude ?? NaN) && Number.isFinite(mp?.longitude ?? NaN);
  return navigable ? { pathname: '/compass', params: { mpId: meet.id } } : CREW_MEET_HREF;
}

/** The crew id of an SOS push (type `crew_sos`, or a legacy deepLink at `/sos`), else null. */
export function sosPushCrewId(data: Record<string, unknown> | undefined): string | null {
  const { crewId, deepLink, type } = data ?? {};
  if (typeof crewId !== 'string' || crewId === '') return null;
  return type === 'crew_sos' || (typeof deepLink === 'string' && deepLink.includes('/sos')) ? crewId : null;
}
