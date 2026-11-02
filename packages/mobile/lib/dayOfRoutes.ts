import { meetingPointPrefill, type ActiveMeet, type Coord, type MapPlace } from '@festie/shared/utils';
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

/** The Map tab, with the stage's place card open and the camera flown to it. */
export function stageMapHref(stageId: string): Href {
  return { pathname: '/(tabs)/map', params: { focusStage: stageId } };
}

/** The compass, pointed at a fixed coordinate. */
export function compassHref(label: string, c: Coord): Href {
  return { pathname: '/compass', params: { label, latitude: String(c.latitude), longitude: String(c.longitude) } };
}

/** The meeting-point create sheet, prefilled from a tapped map place. */
export function meetingPointPrefillHref(place: MapPlace): Href {
  return {
    pathname: '/meeting-point-new',
    params: {
      lat: String(place.coord.latitude),
      lng: String(place.coord.longitude),
      ...meetingPointPrefill(place),
    },
  };
}

/** The crew id of an SOS push (type `crew_sos`, or a legacy deepLink at `/sos`), else null. */
export function sosPushCrewId(data: Record<string, unknown> | undefined): string | null {
  const { crewId, deepLink, type } = data ?? {};
  if (typeof crewId !== 'string' || crewId === '') return null;
  return type === 'crew_sos' || (typeof deepLink === 'string' && deepLink.includes('/sos')) ? crewId : null;
}
