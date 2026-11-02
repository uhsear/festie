import { api } from './api';
import { mapErrorToUserMessage, parseRetryAfterMs, isApiClientError } from './errors';
import { DATA_COPY } from '../constants/privacyCopy';
import { useAuthStore } from '../stores/authStore';
import { useCrewStore } from '../stores/crewStore';
import type { User } from '../types';

export async function fetchAccountExport(): Promise<Record<string, unknown>> {
  return api.get<Record<string, unknown>>('/account/export');
}

export function exportErrorMessage(err: unknown, nowMs: number = Date.now()): string {
  if (isApiClientError(err) && err.status === 429) {
    const ms = parseRetryAfterMs(err.retryAfter);
    if (ms == null) return DATA_COPY.limitNoTime;
    const retryAt = new Date(nowMs + ms);
    const day = retryAt.toDateString() === new Date(nowMs).toDateString() ? 'today' : 'tomorrow';
    const clock = retryAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    return DATA_COPY.limit(day, clock);
  }
  return mapErrorToUserMessage(err, DATA_COPY.failed);
}

/**
 * The server turns off the public page and clears status locations. The local
 * status rows are cleared too, because not every client listens for the
 * crew:status-updated echo. Errors propagate: callers show PRIVACY_COPY.error.
 */
export async function stopAllSharing(): Promise<void> {
  const res = await api.post<{ user: User; clearedStatusLocations: number }>('/account/stop-sharing', {});
  const current = useAuthStore.getState().user;
  if (current) useAuthStore.getState().setUser({ ...current, ...res.user });
  const myId = res.user?.id ?? current?.id;
  useCrewStore.setState((state) => ({
    crewStatuses: state.crewStatuses.map((s) =>
      s.user_id === myId ? { ...s, latitude: null, longitude: null, location_captured_at: null } : s,
    ),
  }));
  // T28 not merged: endShare('user') for live location is deferred (addendum 2026-11-02).
}
