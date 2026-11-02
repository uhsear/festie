import { api } from './api';
import { isApiClientError, mapErrorToUserMessage } from './errors';
import { FIND_FRIEND_COPY } from '../constants/config';

/** Online-only. The path matches no offline pattern; the bypass flag states it at the call site too. */
export function nudgeCrewMember(crewId: string, userId: string): Promise<{ nudged: true }> {
  return api.post<{ nudged: true }>(`/crews/${crewId}/members/${userId}/nudge`, {}, { _bypassOfflineQueue: true });
}

/** The line to show when "Looking for you" fails. `name` is the person it was meant for. */
export function nudgeErrorMessage(err: unknown, name: string): string {
  if (isApiClientError(err)) {
    if (err.isNetworkError || err.status === 0) return FIND_FRIEND_COPY.nudgeOffline;
    if (err.status === 429) return FIND_FRIEND_COPY.nudgeLimited(name);
    if (err.status === 403) return "You're not in this crew any more.";
    if (err.status === 404) return FIND_FRIEND_COPY.nudgeGone(name);
    if (err.status === 503) return FIND_FRIEND_COPY.nudgeUnavailable;
  }
  return mapErrorToUserMessage(err, FIND_FRIEND_COPY.nudgeFailed);
}
