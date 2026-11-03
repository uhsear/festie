import { api } from './api';
import { isApiClientError } from './errors';

export interface LiveLocationFixBody {
  lat: number;
  lng: number;
  accuracy?: number;
  heading?: number;
  speed?: number;
  battery?: number;
  lowPower?: boolean;
  capturedAt: string;
  expiresAt: string;
}

const path = (crewId: string) => `/crews/${encodeURIComponent(crewId)}/live-location`;

/** Relay one background fix over HTTP. Never queued offline: a stale fix is worse than none. */
export function postLiveFix(crewId: string, body: LiveLocationFixBody): Promise<void> {
  return api.post<void>(path(crewId), body, { timeoutMs: 8000 });
}

export function stopLiveFix(crewId: string): Promise<void> {
  return api.delete<void>(path(crewId), { timeoutMs: 8000 });
}

/** True when retrying cannot help, so the background task should end the share. */
export function isTerminalLiveFixError(err: unknown): boolean {
  return isApiClientError(err) && [400, 401, 403, 404, 503].includes(err.status);
}
