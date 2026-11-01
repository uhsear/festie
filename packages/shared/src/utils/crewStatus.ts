import type { CrewMeetingPoint, CrewMemberStatus, CrewStatusKey } from '../types/domain';
import type { NowNextSelection } from './dayOf';
import { haversineMeters } from './geo';

/** A status is shown for this long after `updated_at`; the server keeps the row. */
export const STATUS_TTL_MS = 4 * 60 * 60_000;
/** Within this distance of the pinned meeting point, "On my way" becomes "I'm here". */
export const ARRIVE_RADIUS_M = 50;

const LIST_LABEL: Record<CrewStatusKey, string> = {
  'on-my-way': 'On my way',
  here: "I'm here",
  delayed: 'Running late',
  'at-camp': 'At camp',
  'at-stage': 'At a stage',
  break: 'Taking a break',
  lost: 'Lost — come find me',
};

/** One-tap presets in display order. `at-stage` shows only when a stage is known. */
export const CREW_STATUS_PRESETS: ReadonlyArray<{ key: CrewStatusKey; label: string }> = [
  { key: 'at-stage', label: 'At a stage' },
  { key: 'at-camp', label: 'At camp' },
  { key: 'break', label: 'Taking a break' },
  { key: 'lost', label: 'Lost — come find me' },
  { key: 'here', label: "I'm here" },
  { key: 'delayed', label: 'Running late' },
  { key: 'on-my-way', label: 'On my way…' },
];

type StatusLike = { status: string | null; note?: string | null };

export function crewStatusLabel(st: StatusLike): string | null {
  if (!st.status || !Object.hasOwn(LIST_LABEL, st.status)) return null;
  if (st.status === 'at-stage') return st.note ? `At ${st.note}` : LIST_LABEL['at-stage'];
  return LIST_LABEL[st.status as CrewStatusKey];
}

/** The free note under a status. `at-stage` keeps its stage in the label, so no note line. */
export function statusNoteLine(st: StatusLike): string | null {
  return st.status === 'at-stage' ? null : st.note || null;
}

export function isStatusFresh(
  st: { status: string | null; updated_at: string } | null | undefined,
  nowMs: number,
): boolean {
  if (!st?.status) return false;
  const at = Date.parse(st.updated_at);
  return Number.isFinite(at) && nowMs - at < STATUS_TTL_MS;
}

/** Stage of the set playing now, else of one starting within the hour. */
export function presetStageName(
  selection: NowNextSelection,
  nowMs: number,
  getStageName: (id: string) => string | undefined,
): string | null {
  const next = selection.upcoming[0];
  const target = selection.current[0] ?? (next && next.start - nowMs <= 60 * 60_000 ? next : undefined);
  return target ? getStageName(target.set.stageId) || null : null;
}

/** The pinned meeting point I am within `ARRIVE_RADIUS_M` of while "On my way", else null. */
export function arrivalTarget<T extends CrewMeetingPoint>(
  mine: CrewMemberStatus | undefined,
  points: ReadonlyArray<T>,
  coord: { lat: number; lng: number } | null,
  nowMs: number,
): T | null {
  if (!mine || mine.status !== 'on-my-way' || !isStatusFresh(mine, nowMs)) return null;
  if (!mine.target_meeting_point_id || !coord) return null;
  const point = points.find((p) => p.id === mine.target_meeting_point_id);
  const { latitude, longitude } = point ?? {};
  if (typeof latitude !== 'number' || typeof longitude !== 'number') return null;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !point) return null;
  const meters = haversineMeters({ latitude: coord.lat, longitude: coord.lng }, { latitude, longitude });
  return meters <= ARRIVE_RADIUS_M ? point : null;
}

export function noStatusLine(memberCount: number): string {
  return `No one has shared a status yet · ${memberCount} ${memberCount === 1 ? 'member' : 'members'}`;
}

export function arrivedMessage(label: string): string {
  return `You're at ${label}. Your crew can see you're here.`;
}
