import { api } from './api';
import type { FestivalScope } from './festivalAdmin';
import type {
  AdminAnnouncement,
  AnnouncementScreen,
  AnnouncementSeverity,
  FestivalAnnouncement,
} from '../types/announcement';

const enc = encodeURIComponent;

export interface CreateAnnouncementBody {
  severity: AnnouncementSeverity;
  title: string;
  body: string;
  screen: AnnouncementScreen;
  sendAt?: string;
}

export const announcementsApi = {
  list: (festivalId: string) => api.get<FestivalAnnouncement[]>(`/festivals/${enc(festivalId)}/announcements`),
  // `manage` is an organization owner's own festival (routes/manage.ts); the default is the admin path.
  adminList: (festivalId: string, scope: FestivalScope = 'admin') =>
    api.get<{ festivalName: string; recipients: number; announcements: AdminAnnouncement[] }>(
      `/${scope}/festivals/${enc(festivalId)}/announcements`,
    ),
  create: (festivalId: string, body: CreateAnnouncementBody, scope: FestivalScope = 'admin') =>
    api.post<{ announcement: AdminAnnouncement; recipients: number }>(
      `/${scope}/festivals/${enc(festivalId)}/announcements`,
      body,
    ),
  cancel: (festivalId: string, id: string, scope: FestivalScope = 'admin') =>
    api.delete<{ announcement: AdminAnnouncement }>(`/${scope}/festivals/${enc(festivalId)}/announcements/${enc(id)}`),
};
