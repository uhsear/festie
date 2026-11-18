import { api } from './api';
import type { TimeReleasePanelData, TimeReleaseSendBody, TimeReleaseSendResult } from '../utils/timeReleases';

const path = (festivalId: string) => `/admin/festivals/${encodeURIComponent(festivalId)}/time-releases`;

export const timeReleaseApi = {
  panel: (festivalId: string) => api.get<TimeReleasePanelData>(path(festivalId)),
  /** Claims each date, then queues the alert. A 409 names why: DRAFT, FESTIVAL_OVER, PARTIAL_RELEASE or ALREADY_RELEASED. */
  send: (festivalId: string, body: TimeReleaseSendBody) => api.post<TimeReleaseSendResult>(path(festivalId), body),
};
