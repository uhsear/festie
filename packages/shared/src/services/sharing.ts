import { z } from 'zod';
import { api, ApiClientError, getApiBase } from './api';
import type { FestivalSet, Priority, Stage } from '../types/domain';
import { buildPicksShareUrl, buildCalendarLinks } from '../utils/links';

export interface SharingStatus {
  publicSchedule: boolean;
  publicFestival: { id: string; name: string } | null;
  linksResetAt: string | null;
}

/** Get (or create) the revocable picks-share token for a festival, with its public URL. */
export async function fetchShareLink(festivalId: string, origin?: string): Promise<{ token: string; url: string }> {
  const { token } = await api.post<{ token: string }>(`/account/share-link/${encodeURIComponent(festivalId)}`);
  return { token, url: buildPicksShareUrl(token, origin) };
}

/** Get (or create) the calendar subscription feed for a festival. */
export async function fetchCalendarLinks(festivalId: string) {
  const data = await api.post<{ url: string }>(`/calendar-sync/${encodeURIComponent(festivalId)}`);
  return buildCalendarLinks(data.url);
}

export function fetchSharingStatus(): Promise<SharingStatus> {
  return api.get<SharingStatus>('/account/sharing');
}

/** Stop every picks link and calendar feed the user has sent. */
export function resetShareLinks(): Promise<{ linksResetAt: string }> {
  return api.post<{ linksResetAt: string }>('/account/sharing/reset');
}

const lenientObject = z.object({ id: z.string() }).passthrough();
const sharedPicksPayloadSchema = z.object({
  username: z.string(),
  festivalName: z.string(),
  festivalId: z.string(),
  picks: z.record(z.string(), z.enum(['must', 'want-to-see', 'maybe'])),
  festival: z.object({
    stages: z.array(lenientObject),
    days: z.array(
      z.object({
        label: z.string().optional(),
        date: z.string().optional(),
        sets: z.array(lenientObject),
      }),
    ),
    b2bSeparator: z.string().nullable().optional(),
  }),
});

export interface SharedPicksPayload {
  username: string;
  festivalName: string;
  festivalId: string;
  picks: Record<string, Priority>;
  festival: {
    stages: Stage[];
    days: Array<{ label?: string; date?: string; sets: FestivalSet[] }>;
    b2bSeparator?: string | null;
  };
}

export function sharedPicksJsonUrl(ref: string, apiBase?: string): string {
  return `${(apiBase ?? getApiBase()).replace(/\/api\/v1\/?$/, '')}/s/${ref}/json`;
}

/** Public, unauthenticated read of a friend's shared picks. Validates the payload before returning it. */
export async function fetchSharedPicks(ref: string): Promise<SharedPicksPayload> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);
  try {
    let response: Response;
    try {
      response = await fetch(sharedPicksJsonUrl(ref), { signal: controller.signal, credentials: 'omit' });
    } catch (err) {
      const aborted = err instanceof Error && err.name === 'AbortError';
      throw new ApiClientError(
        aborted ? 'Request timed out' : err instanceof Error ? err.message : 'Network request failed',
        0,
        undefined,
        undefined,
        true,
      );
    }
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const info = body?.error ?? {};
      throw new ApiClientError(info.message || response.statusText || 'Request failed', response.status, info.code);
    }
    const parsed = sharedPicksPayloadSchema.safeParse(body?.data ?? body);
    if (!parsed.success) throw new ApiClientError("This link can't be read.", 0, 'INVALID_INPUT');
    return parsed.data as unknown as SharedPicksPayload;
  } finally {
    clearTimeout(timeoutId);
  }
}

/** The server's printable HTML export, as text. */
export function fetchPrintableSchedule(festivalId: string, profileId: string): Promise<string> {
  return api.get<string>(`/export/${festivalId}/${profileId}`, { asText: true });
}
