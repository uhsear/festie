import { api } from './api';
import type { CrewMeetingPoint } from '../types';

/** Timed points that expired in the last 12 hours (the "Past" group). */
export async function fetchPastMeetingPoints(crewId: string): Promise<CrewMeetingPoint[]> {
  const res = await api.get<{ meetingPoints: CrewMeetingPoint[] }>(
    `/crews/${encodeURIComponent(crewId)}/meeting-points/past`,
  );
  return res?.meetingPoints ?? [];
}
