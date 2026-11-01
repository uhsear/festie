import { api } from './api';
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
