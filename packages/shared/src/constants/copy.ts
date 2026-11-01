import type { FestivalStatus } from '../utils/festivalTime';

/** Neutral icon keys for named concepts; web maps them to Lucide, mobile to Ionicons. */
export type ConceptIconKey =
  | 'nowNext' | 'jumpToNow' | 'picks' | 'wrap' | 'find' | 'homeBase' | 'meetUp' | 'emergencySpot';

/** One name per concept, shared by web and mobile. See docs/design/copy-voice.md. */
export const COPY = {
  nowNext: { name: 'Now & Next', open: 'Open Now & Next', icon: 'nowNext' },
  jumpToNow: { label: 'Jump to now', a11y: 'Scroll to the current time', icon: 'jumpToNow' },
  picks: {
    tab: 'Picks', title: 'My picks', filterA11y: 'Show only my picks',
    share: 'Share picks', shareByQr: 'Share by QR', shareOffline: 'Share offline', icon: 'picks',
  },
  wrap: {
    tab: 'Wrap', name: 'Festival Wrap', crewName: 'Crew Wrap', open: 'See your Festival Wrap',
    ready: 'Festival Wrap ready', readyHint: 'Your Festival Wrap is ready to view', icon: 'wrap',
  },
  find: { name: 'Find', action: 'Find your crew', icon: 'find' },
  homeBase: {
    name: 'Home Base', set: 'Set Home Base', empty: "Tap to set your crew's Home Base",
    hint: "Your crew's main meeting spot. Only the crew owner can change it.", icon: 'homeBase',
  },
  meetingPoint: { one: 'Meeting point', many: 'Meeting points', add: 'New meeting point', edit: 'Edit meeting point' },
  auth: {
    signIn: 'Sign in', signingIn: 'Signing in…', createAccount: 'Create account',
    creatingAccount: 'Creating account…', signOut: 'Sign out',
    signOutConfirm: 'Are you sure you want to sign out?', signInRequired: 'Sign in required',
  },
  clash: {
    one: 'Schedule clash', badge: 'Clash', filter: 'Clashes', none: 'No clashes',
    gridHint: 'Clashes with another of your picks',
    tight: 'Tight change', suggested: 'Suggested', split: 'Split',
    splitPlanned: 'Split planned', clearPlan: 'Clear plan', undo: 'Undo',
    failed: "Couldn't update your picks. Try again.",
  },
  myDay: {
    name: 'My day', byPriority: 'By priority', unscheduled: 'Time not announced',
    free: (min: string) => `${min} free`,
    walk: (min: number, stage: string) => `${min} min walk from ${stage}`,
    meet: (label: string) => `Meet: ${label}`,
  },
  planLists: {
    reminders: 'Reminders', notes: 'Notes',
    remindersEmptyTitle: 'No reminders yet', remindersEmptyBody: 'Open a set and use Remind me before it starts.',
    notesEmptyTitle: 'No notes yet', notesEmptyBody: 'Open a set and add a note. It shows here.',
  },
  grid: {
    zoomIn: 'Zoom in', zoomInHint: 'Show less of the day, larger',
    zoomOut: 'Zoom out', zoomOutHint: 'Show more of the day',
    holdToPick: 'Hold a set to pick', swipeAndHold: 'Swipe for stages · Hold a set to pick',
    holdHint: 'Hold to change your pick', clearPick: 'Clear pick',
    tbaTitle: "Set times aren't out yet",
    tbaBody: "Here's who plays each stage. Pick sets now. They move onto the grid when times are published.",
    stageUnknown: 'Stage not set',
    regionLabel: 'Schedule grid',
    gridLabel: 'Festival schedule grid: stages as columns, time as rows',
  },
  status: { playing: 'Playing', playingA11y: 'Playing now', liveLocation: 'Live' },
} as const;

export const FESTIVAL_STATUS_LABEL: Record<FestivalStatus, string> = {
  upcoming: 'Upcoming', ongoing: 'Happening now', past: 'Past',
};

export const signInTo = (what: string): string => `Sign in to ${what}.`;
export const clashCount = (n: number): string => (n === 1 ? COPY.clash.one : `${n} schedule clashes`);
export const clashChip = (n: number): string => (n === 1 ? '1 clash' : `${n} clashes`);
export const clashChipA11y = (n: number): string =>
  n === 1 ? 'You have 1 schedule clash. Show it.' : `You have ${n} schedule clashes. Show the first one.`;
export const clashesWith = (names: string[]): string => `Clashes with ${names.join(', ')}`;

/** Inline clash prompt copy, shared by web and mobile ClashPrompt. */
export function clashPromptCopy(o: { hard: boolean; at: string | null; currentName: string; otherName: string }) {
  const when = o.at ? ` at ${o.at}` : '';
  return o.hard
    ? { title: `You have a clash${when}: keep one`,
        body: `Both ${o.currentName} and ${o.otherName} are Must See but overlap. Keep one and we'll clear the other.` }
    : { title: `2 sets${when}: keep one`,
        body: `${o.currentName} and ${o.otherName} overlap. Keep one and we'll clear the other.` };
}

/** The two meeting-point kinds users choose from. Stored in the existing server enum. */
export const MEETING_POINT_KINDS = [
  { type: 'during', label: 'Meet-up', icon: 'meetUp' },
  { type: 'emergency', label: 'Emergency spot', icon: 'emergencySpot' },
] as const satisfies readonly { type: string; label: string; icon: ConceptIconKey }[];

/** Legacy types (pre-show, post-show, post-event, general) read as Meet-up. */
export function meetingPointKind(type: string) {
  return type === 'emergency' ? MEETING_POINT_KINDS[1] : MEETING_POINT_KINDS[0];
}
