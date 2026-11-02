import { api } from './api';
import { isApiClientError, mapErrorToUserMessage } from './errors';
import { useLiveLocationStore } from '../stores/liveLocationStore';
import type { SosViewer } from '../types';
import type { SosPosition } from './sos';

export interface CheckinState {
  dueAt: string;
  minutes: number;
}

/** Start a check-in timer. Online-only: never queued offline. */
export function startCheckin(crewId: string, body: { minutes: number; position?: SosPosition }): Promise<CheckinState> {
  return api.post<CheckinState>(`/crews/${crewId}/checkin`, body);
}

/** Stop the timer ("I'm OK"). Online-only. */
export function finishCheckin(crewId: string): Promise<{ cleared: boolean }> {
  return api.post<{ cleared: boolean }>(`/crews/${crewId}/checkin/done`);
}

export async function getCheckin(crewId: string): Promise<CheckinState | null> {
  const res = await api.get<{ checkin: CheckinState | null }>(`/crews/${crewId}/checkin`);
  return res.checkin;
}

/** Tell the crew you have seen a raiser's SOS, then merge the returned viewer list into the store. */
export async function markSosSeen(crewId: string, raiserId: string): Promise<void> {
  const data = await api.post<{ seenBy: SosViewer[] }>(`/crews/${crewId}/sos/seen`, { raiserId });
  useLiveLocationStore.getState().applySosSeen(raiserId, data.seenBy);
}

export function checkinErrorMessage(err: unknown, action: 'start' | 'done'): string {
  const start = action === 'start';
  if (isApiClientError(err)) {
    if (err.isNetworkError || err.status === 0) {
      return start
        ? 'No signal — the timer did not start. Tell your crew where you are going another way.'
        : 'No signal — your timer is still running. Try again, or your crew gets an SOS when it ends.';
    }
    if (err.status === 503) {
      return start
        ? 'Check-in timers are not available right now. Tell your crew where you are going.'
        : 'Check-in timers are not available right now.';
    }
    if (err.status === 403) return "You're not in this crew any more.";
  }
  return mapErrorToUserMessage(err, start ? 'Could not start the timer. Try again.' : 'Could not stop the timer. Try again.');
}
