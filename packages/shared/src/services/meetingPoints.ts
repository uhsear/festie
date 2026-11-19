import { api } from './api';
import type { CrewMeetingPoint } from '../types';

/** Timed points that expired in the last 12 hours (the "Past" group). */
export async function fetchPastMeetingPoints(crewId: string): Promise<CrewMeetingPoint[]> {
  const res = await api.get<{ meetingPoints: CrewMeetingPoint[] }>(
    `/crews/${encodeURIComponent(crewId)}/meeting-points/past`,
  );
  return res?.meetingPoints ?? [];
}

export interface MeetingPointPayload {
  label: string;
  location: string;
  type: string;
  meetAt?: string | null;
  stageReference?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  recursDaily?: boolean;
}

const meetingPointsPath = (crewId: string) => `/crews/${encodeURIComponent(crewId)}/meeting-points`;

export async function fetchMeetingPoints(crewId: string): Promise<CrewMeetingPoint[]> {
  const res = await api.get<CrewMeetingPoint[] | { meetingPoints: CrewMeetingPoint[] }>(meetingPointsPath(crewId));
  return Array.isArray(res) ? res : res?.meetingPoints || [];
}

export const createMeetingPoint = (crewId: string, payload: MeetingPointPayload) =>
  api.post(meetingPointsPath(crewId), payload);

export const updateMeetingPoint = (crewId: string, id: string, payload: Partial<MeetingPointPayload>) =>
  api.put(`${meetingPointsPath(crewId)}/${encodeURIComponent(id)}`, payload);

export const deleteMeetingPoint = (crewId: string, id: string) =>
  api.delete(`${meetingPointsPath(crewId)}/${encodeURIComponent(id)}`);
