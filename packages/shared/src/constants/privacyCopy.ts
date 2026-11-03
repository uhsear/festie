/** User-facing copy for Account > Privacy and sharing and Account > Download my data. */

export const PRIVACY_COPY = {
  title: 'Who can see what',
  publicPage: {
    label: 'Public schedule page',
    on: 'On. Anyone with the link can see your picks.',
    off: 'Off. Only you and your crews see your picks.',
  },
  picksLinks: {
    label: 'Links you sent from Share picks',
    value: "Anyone with one can see that festival's picks. Reset them below.",
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
    off: 'Off on this device. You turn it on for one crew at a time.',
  },
  statusLocation: {
    label: 'Location in your status',
    on: (crew: string, clock: string) => `${crew} sees where you were at ${clock}.`,
    recent: (crew: string) => `${crew} sees where you were recently.`,
    many: (n: number) => `${n} crews see where you were last.`,
    off: 'None. A status you post while offline can include where you were.',
  },
  profile: {
    label: 'Name and photo',
    value: 'Your crews see them. Your public page shows them when it is on.',
  },
  noFriendGraph: 'Festie has no friends list and never suggests people to you. Only your crews see your crew data.',
  freeOffline: 'Festie is free, offline mode included.',
  stopButton: 'Stop all sharing',
  stopHintNone: 'Nothing is shared right now.',
  confirmTitle: 'Stop all sharing?',
  confirmBody:
    'This stops your live location on this device, turns off your public schedule page and removes the location from your crew statuses. Payment handles and links you sent stay; change them in their own sections.',
  confirmButton: 'Stop sharing',
  cancel: 'Cancel',
  done: 'Sharing stopped.',
  error: "Couldn't stop sharing. Check your connection and try again.",
  policyLink: 'Read the privacy policy',
} as const;

export const DATA_COPY = {
  title: 'Download my data',
  hint: 'A JSON file with everything Festie holds about you: account, picks, crews, ratings, expenses, votes, packing, rides and meet-ups. You can download it once a day.',
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
