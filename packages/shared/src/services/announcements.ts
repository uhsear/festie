import { api } from './api';
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
  adminList: (festivalId: string) =>
    api.get<{ festivalName: string; recipients: number; announcements: AdminAnnouncement[] }>(
      `/admin/festivals/${enc(festivalId)}/announcements`,
    ),
  create: (festivalId: string, body: CreateAnnouncementBody) =>
    api.post<{ announcement: AdminAnnouncement; recipients: number }>(
      `/admin/festivals/${enc(festivalId)}/announcements`,
      body,
    ),
  cancel: (festivalId: string, id: string) =>
    api.delete<{ announcement: AdminAnnouncement }>(`/admin/festivals/${enc(festivalId)}/announcements/${enc(id)}`),
};
