// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import { TRUSTED_MUTATION_HEADER } from '../constants/config';
import { api, ApiClientError, getApiBase, getAuthToken } from './api';

export type SetEngagementMap = Record<string, { picks: number; reminders: number }>;

export interface SpotifyBackfillResult {
  updated: number;
  skipped: number;
  total: number;
  unmatched: string[];
  message?: string;
}

const enc = encodeURIComponent;

export function getSetEngagement(festivalId: string): Promise<SetEngagementMap> {
  return api.get<SetEngagementMap>(`/admin/festivals/${enc(festivalId)}/set-engagement`);
}

export function saveSetLink(
  festivalId: string,
  setId: string,
  linkUrl: string | null,
  artistIndex: number,
): Promise<{ setId: string; artistIndex: number; linkUrl: string | null }> {
  return api.put(`/admin/festivals/${enc(festivalId)}/sets/${enc(setId)}/link`, { linkUrl, artistIndex });
}

/** A whole-festival Spotify search can outlast the 15 s default timeout. */
export function runSpotifyBackfill(
  festivalId: string,
  opts?: { setIds?: string[]; force?: boolean },
): Promise<SpotifyBackfillResult> {
  return api.post<SpotifyBackfillResult>(`/admin/festivals/${enc(festivalId)}/backfill-spotify`, opts ?? {}, {
    timeoutMs: 120_000,
  });
}

/** Raw fetch (multipart), headers built as the avatar upload does. */
export async function uploadSiteplanImage(
  festivalId: string,
  file: Blob,
  fileName = 'siteplan.jpg',
): Promise<{ imageUrl: string }> {
  const formData = new FormData();
  formData.append('image', file, fileName);
  const headers: Record<string, string> = { [TRUSTED_MUTATION_HEADER]: '1' };
  const bearer = getAuthToken();
  if (bearer) {
    headers['Authorization'] = `Bearer ${bearer}`;
    headers['X-Festie-Client'] = 'native';
  }
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await fetch(`${getApiBase()}/admin/festivals/${enc(festivalId)}/siteplan-image`, {
      method: 'POST',
      credentials: bearer ? 'omit' : 'same-origin',
      headers,
      body: formData,
      signal: controller.signal,
    });
    if (!response.ok) {
      const errBody = await response.json().catch(() => null);
      const info = (errBody?.error ?? {}) as { message?: string; code?: string };
      throw new ApiClientError(info.message || 'Upload failed', response.status, info.code);
    }
    const body = await response.json();
    return (body && typeof body === 'object' && 'data' in body ? body.data : body) as { imageUrl: string };
  } catch (err) {
    if (err instanceof ApiClientError) throw err;
    const isAbort = err instanceof Error && err.name === 'AbortError';
    throw new ApiClientError(
      isAbort ? 'Upload timed out' : err instanceof Error ? err.message : 'Upload failed',
      0,
      undefined,
      undefined,
      true,
    );
  } finally {
    clearTimeout(timeoutId);
  }
}
