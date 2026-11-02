import type {
  AdminAnnouncement,
  AnnouncementScreen,
  AnnouncementStatus,
  FestivalAnnouncement,
} from '../types/announcement';
import type { PushTarget } from './pushTarget';

/** Order used by the admin "Opens" select. */
export const ANNOUNCEMENT_SCREENS: readonly AnnouncementScreen[] = [
  'home',
  'map',
  'timeline',
  'picks',
  'festival-mode',
  'crew',
];

export function announcementWebPath(screen: AnnouncementScreen): string {
  return screen === 'home' ? '/' : `/${screen}`;
}

export function announcementTarget(a: { screen: AnnouncementScreen; festivalId: string }): PushTarget {
  if (a.screen === 'home') return { kind: 'festival', festivalId: a.festivalId };
  if (a.screen === 'crew') return { kind: 'crew' };
  return { kind: 'screen', screen: a.screen };
}

/** Items are newest first. Urgent wins over newer info. */
export function pickBannerAnnouncement(
  items: FestivalAnnouncement[],
  dismissed: readonly string[],
): FestivalAnnouncement | null {
  const open = items.filter((i) => !dismissed.includes(i.id));
  return open.find((i) => i.severity === 'urgent') ?? open[0] ?? null;
}

const LATE_MS = 30 * 60 * 1000;

export function announcementStatus(a: AdminAnnouncement): AnnouncementStatus {
  if (a.cancelledAt) {
    const late = !a.sentAt && Date.parse(a.sendAt) < Date.parse(a.cancelledAt) - LATE_MS;
    return late ? 'expired' : 'cancelled';
  }
  return a.sentAt ? 'sent' : 'scheduled';
}
