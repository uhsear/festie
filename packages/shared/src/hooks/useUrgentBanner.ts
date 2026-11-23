import { useAnnouncementStore } from '../stores/announcementStore';
import { pickBannerAnnouncement } from '../utils/announcements';
import { useActiveSos } from './useDayOf';

/** True while an SOS or an urgent announcement banner is on screen; lower-priority banners step aside. */
export function useUrgentBannerShowing(): boolean {
  const sosActive = useActiveSos().length > 0;
  const urgentShowing = useAnnouncementStore(
    (s) => pickBannerAnnouncement(s.items, s.dismissed)?.severity === 'urgent',
  );
  return sosActive || urgentShowing;
}
