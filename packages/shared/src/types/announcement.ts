export type AnnouncementSeverity = 'info' | 'urgent';
export type AnnouncementScreen = 'home' | 'map' | 'timeline' | 'picks' | 'festival-mode' | 'crew';

export interface FestivalAnnouncement {
  id: string;
  festivalId: string;
  severity: AnnouncementSeverity;
  title: string;
  body: string;
  screen: AnnouncementScreen;
  sentAt: string;
}

export interface AdminAnnouncement extends Omit<FestivalAnnouncement, 'sentAt'> {
  sendAt: string;
  sentAt: string | null;
  cancelledAt: string | null;
  recipientCount: number | null;
  createdBy: string | null;
  createdAt: string;
}

export type AnnouncementStatus = 'scheduled' | 'sent' | 'cancelled' | 'expired';
