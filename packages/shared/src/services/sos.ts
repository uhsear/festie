import { api } from './api';
import { isApiClientError, mapErrorToUserMessage } from './errors';
import { useLiveLocationStore } from '../stores/liveLocationStore';
import type { SosEntry } from '../types';

export type SosPosition = NonNullable<SosEntry['position']>;

/** Raise an SOS for the crew. Online-only: never queued offline. */
export function raiseSos(crewId: string, body: { message?: string; position?: SosPosition }): Promise<unknown> {
  return api.post(`/crews/${crewId}/sos`, body);
}

/** Clear one raiser's SOS for everyone. A 409 means it is already cleared, which is the goal. */
export async function clearCrewSos(crewId: string, raiserId: string): Promise<void> {
  try {
    await api.post(`/crews/${crewId}/sos/clear`, { raiserId });
  } catch (err) {
    if (!(isApiClientError(err) && err.status === 409)) throw err;
  }
  useLiveLocationStore.getState().clearSos(raiserId);
}

export function sosErrorMessage(err: unknown, action: 'send' | 'clear'): string {
  const send = action === 'send';
  if (isApiClientError(err)) {
    if (err.isNetworkError || err.status === 0) {
      return send
        ? 'No signal — your SOS was NOT sent. Use your phone or radio to reach your crew directly.'
        : 'No signal — the SOS is still showing. Try again when you have signal.';
    }
    if (send && err.status === 429) return 'Your SOS is already active. Your crew can see it.';
    if (err.status === 503) {
      return send ? 'SOS is turned off right now. Call or message your crew directly.' : 'SOS is turned off right now.';
    }
    if (err.status === 403) {
      return send ? "You're not in this crew any more, so your SOS was not sent." : "You're not in this crew any more.";
    }
  }
  return mapErrorToUserMessage(err, send ? 'Could not send your SOS. Try again.' : 'Could not clear the SOS. Try again.');
}
