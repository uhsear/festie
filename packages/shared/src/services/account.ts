import { api } from './api';
import { mapErrorToUserMessage, parseRetryAfterMs, isApiClientError } from './errors';
import { DATA_COPY } from '../constants/privacyCopy';

export async function fetchAccountExport(): Promise<Record<string, unknown>> {
  return api.get<Record<string, unknown>>('/account/export', { timeoutMs: 60000 });
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
