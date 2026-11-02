/** User-facing copy for Account > Privacy, Account > Your data and the notification inbox. */

export const PRIVACY_COPY = {
  sectionLabel: 'Privacy',
  title: 'Who can see what',
  publicPage: {
    label: 'Public schedule page',
    on: 'On. Anyone with the link can see your picks.',
    off: 'Off. Only you and your crews see your picks.',
  },
  picksLinks: {
    label: 'Picks links you sent',
    value: "Anyone with one can see that festival's picks. Reset them under Sharing.",
  },
  paymentHandles: {
    label: 'Payment handles',
    some: (list: string) => `Your crews see ${list}.`,
    none: 'None added.',
  },
  liveLocation: {
    label: 'Live location',
    on: (crew: string, clock: string) => `Sharing with ${crew} until ${clock}.`,
    paused: (crew: string, clock: string) => `Paused for ${crew} until ${clock}.`,
    off: 'Off. You turn it on for one crew at a time.',
  },
  statusLocation: {
    label: 'Location in your status',
    on: (crew: string, clock: string) => `${crew} sees where you were at ${clock}.`,
    off: 'None. A status you post while offline can include where you were.',
  },
  profile: {
    label: 'Name and photo',
    value: 'Your crews see them. Your public page shows them when it is on.',
  },
  stopButton: 'Stop all sharing',
  stopHintNone: 'Nothing is shared right now.',
  confirmTitle: 'Stop all sharing?',
  confirmBody:
    'This turns off your public schedule page and removes the location from your crew statuses. Payment handles and picks links stay; change them in their own sections.',
  confirmButton: 'Stop sharing',
  cancel: 'Cancel',
  done: 'Sharing stopped.',
  error: "Couldn't stop sharing. Check your connection and try again.",
  policyLink: 'Read the privacy policy',
} as const;

export const DATA_COPY = {
  sectionLabel: 'Your data',
  title: 'Download my data',
  hint: 'A JSON file with your account, picks, crews, ratings, expenses, votes, packing and rides. You can download it once a day.',
  button: 'Download my data',
  busy: 'Preparing your file…',
  done: 'Your data is downloaded.',
  shareTitle: 'Save your Festie data',
  limit: (day: 'today' | 'tomorrow', clock: string) =>
    `You can download your data once a day. Try again ${day} at ${clock}.`,
  limitNoTime: 'You can download your data once a day. Try again tomorrow.',
  failed: "Couldn't download your data. Try again.",
  downloadFirst: 'Download my data first',
} as const;

export const INBOX_COPY = {
  title: 'Notifications',
  empty: 'No notifications yet. Set reminders, crew news and schedule changes show up here.',
  error: "Couldn't load your notifications.",
  retry: 'Try again',
  footnote: 'Shows the last 50 notifications we sent you.',
  rowHintNew: (n: number) => `${n} new`,
  rowHintNone: 'See what we sent you',
  bellLabel: 'Notifications',
  bellLabelUnread: (n: number) => `Notifications, ${n} unread`,
  unreadA11y: 'Unread',
} as const;
