import type { AnnouncementScreen, AnnouncementSeverity, AnnouncementStatus } from '../types/announcement';

const people = (n: number) => (n === 1 ? '1 person' : `${n} people`);

export const ANNOUNCEMENT_COPY = {
  heading: 'Announcements',
  intro: (festivalName: string) =>
    `Send a short notice to everyone who joined ${festivalName}. It arrives as a push and shows as a banner in the app for 24 hours. People see it as from Festie, not from the organiser.`,
  audience: (n: number) => `${people(n)} joined this festival.`,
  fields: {
    title: 'Title',
    message: 'Message',
    importance: 'Importance',
    opens: 'Opens',
    when: 'When',
    counter: (used: number, max: number) => `${used}/${max}`,
    sendAtLabel: (zone: string) => `Send at (your time, ${zone})`,
  },
  severityLabels: { info: 'Info', urgent: 'Urgent' } satisfies Record<AnnouncementSeverity, string>,
  screenLabels: {
    home: 'Festival home',
    map: 'Map',
    timeline: 'Timeline',
    picks: 'My picks',
    'festival-mode': 'Now & Next',
    crew: 'Crew',
  } satisfies Record<AnnouncementScreen, string>,
  whenNow: 'Send now',
  whenLater: 'Send at a set time',
  submitNow: (n: number) => `Send to ${people(n)}`,
  submitLater: 'Schedule',
  confirmSend: {
    title: 'Send this announcement?',
    text: (n: number) =>
      `${people(n)} get a push now. People who turned off schedule alerts get no push. People in quiet hours, or who already had 6 alerts this hour, find it in their inbox instead. You can't unsend a push.`,
    cancel: 'Cancel',
    confirm: 'Send',
  },
  confirmTakeDown: {
    title: 'Take down this banner?',
    text: "The banner goes away for everyone. The push already sent stays on people's phones.",
    cancel: 'Keep',
    confirm: 'Take down',
  },
  queued: (n: number) => `Announcement queued for ${people(n)}.`,
  scheduled: (when: string) => `Announcement scheduled for ${when}.`,
  cancelledToast: 'Announcement cancelled',
  takenDownToast: 'Banner taken down',
  listEmpty: 'No announcements yet.',
  urgentTag: 'Urgent',
  statusLine: (status: AnnouncementStatus, when: string, n: number | null): string => {
    switch (status) {
      case 'scheduled':
        return `Scheduled for ${when}`;
      case 'sent':
        return `Sent ${when} to ${people(n ?? 0)}`;
      case 'cancelled':
        return 'Cancelled';
      case 'expired':
        return 'Not sent: more than 30 minutes late';
    }
  },
  rowCancel: 'Cancel',
  rowTakeDown: 'Take down banner',
  banner: {
    kicker: (severity: AnnouncementSeverity) => (severity === 'urgent' ? 'Urgent · From Festie' : 'From Festie'),
    open: 'Open',
    dismiss: 'Dismiss announcement',
    label: (kicker: string, title: string, body: string) => `${kicker}: ${title}. ${body}`,
  },
} as const;
