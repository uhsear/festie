import { Priority } from '../types/domain';

export const API_BASE = '/api/v1';

// ── Pick priority — shared data, no icon refs ──────────────────────────────

/**
 * Short display label for each pick priority (used in badges, pills, and
 * compact UI). Full-length labels ("Must See" / "Want to See") live in
 * PRIORITY_LABELS below. Both web and mobile import from here.
 */
export const PRIORITY_LABEL: Record<Priority, string> = {
  must: 'Must',
  'want-to-see': 'Want',
  maybe: 'Maybe',
};

/**
 * Ordered pick-priority option config. Icon refs are intentionally absent —
 * web uses Lucide components, mobile uses Ionicons names; keep those per-
 * platform. `sort` is the canonical display order (descending importance).
 *
 * Consumers:
 *   web  — PickBulkActions priority selector
 *   mobile — SetCardMobile PRIORITIES array (add `icon` per-platform)
 */
export const PRIORITY_OPTIONS: readonly {
  value: Priority;
  label: string;
  /** Short label — same as PRIORITY_LABEL[value]. */
  short: string;
  /** Display sort order: lower number renders first (must=0, want=1, maybe=2). */
  sort: number;
}[] = [
  { value: 'must', label: 'Must See', short: 'Must', sort: 0 },
  { value: 'want-to-see', label: 'Want to See', short: 'Want', sort: 1 },
  { value: 'maybe', label: 'Maybe', short: 'Maybe', sort: 2 },
] as const;

/** Neutral icon keys for pick priority; web maps to Lucide, mobile to Ionicons. */
export type PrioritySymbolKey = 'star' | 'heart' | 'circle';

/**
 * The one priority symbol set: every surface that shows a pick priority renders
 * this icon + label in this colour token. Never colour alone (DESIGN.md).
 */
export const PRIORITY_SYMBOLS: Record<
  Priority,
  { icon: PrioritySymbolKey; label: string; short: string; colorToken: 'priority-must' | 'priority-want' | 'priority-maybe' }
> = {
  must: { icon: 'star', label: 'Must See', short: 'Must', colorToken: 'priority-must' },
  'want-to-see': { icon: 'heart', label: 'Want to See', short: 'Want', colorToken: 'priority-want' },
  maybe: { icon: 'circle', label: 'Maybe', short: 'Maybe', colorToken: 'priority-maybe' },
};

// ── Crew activity feed ─────────────────────────────────────────────────────

/**
 * Human-readable verb labels for crew activity event types. Keyed by the
 * `type` column emitted by the server (crew_activity table). Missing keys
 * degrade gracefully: callers replace hyphens with spaces as a fallback.
 *
 * Single source for web ActivityTab + mobile CrewActivity.
 */
export const CREW_ACTIVITY_LABELS: Record<string, string> = {
  'member-joined': 'joined the crew',
  'member-left': 'left the crew',
  'member-kicked': 'was removed from the crew',
  'owner-changed': 'changed the crew owner',
  'poll-closed': 'ended a poll',
  'meeting-point-updated': 'changed a meeting point',
  'packing-created': 'added to the packing list',
  'ride-created': 'offered a ride',
  'photo-album-updated': 'updated the shared photo album',
  'poll-created': 'created a poll',
  'poll-voted': 'voted on a poll',
  'expense-added': 'added an expense',
  'expense-deleted': 'removed an expense',
  'expense-settled': 'settled up',
  expense_settled: 'settled up',
  'expense-edited': 'edited an expense',
  'payment-confirmed': 'confirmed a payment',
  'payment-disputed': 'said a payment has not arrived',
  'currency-changed': 'changed the crew currency',
  'settlement-undone': 'undid a payment',
  'home-base-updated': 'updated Home Base',
  'meeting-point-added': 'dropped a meeting point',
  'meeting-point-removed': 'removed a meeting point',
  'crew-updated': 'updated the crew',
  sos_raised: 'raised an SOS',
  sos_cleared: 'cleared an SOS',
  'checkin-started': 'started a check-in timer',
  'checkin-done': 'checked in safe',
};

// ── Crew money and packing ─────────────────────────────────────────────────

/**
 * Currencies a crew can use. All have 2 decimal places, so integer-cent math
 * stays valid. Keep in sync with CREW_CURRENCIES in lib/schemas.ts (the backend
 * cannot import shared).
 */
export const CREW_CURRENCIES = [
  'USD',
  'EUR',
  'GBP',
  'CAD',
  'AUD',
  'NZD',
  'MXN',
  'CHF',
  'SEK',
  'NOK',
  'DKK',
  'PLN',
  'CZK',
  'BRL',
] as const;

/** Starter packing lists offered on an empty crew packing tab. */
export const PACKING_TEMPLATES: readonly { id: 'camping' | 'day-trip'; label: string; items: readonly string[] }[] = [
  {
    id: 'camping',
    label: 'Camping list',
    items: [
      'Tent',
      'Sleeping bags',
      'Camping chairs',
      'Cooler',
      'Headlamps',
      'Sunscreen',
      'Water jugs',
      'Portable charger',
      'Earplugs',
      'Rain ponchos',
      'First aid kit',
      'Trash bags',
    ],
  },
  {
    id: 'day-trip',
    label: 'Day trip list',
    items: [
      'Tickets',
      'Portable charger',
      'Sunscreen',
      'Refillable water bottle',
      'Earplugs',
      'Small bag',
      'Rain poncho',
      'Cash and card',
    ],
  },
];

// ── Expense categories ─────────────────────────────────────────────────────

/** Neutral icon keys for expense categories; each platform maps them to its own icon set. */
export type ExpenseIconKey = 'utensils' | 'beer' | 'car' | 'bed' | 'ticket' | 'wallet';

/**
 * Ordered expense category catalog. Each entry carries an `id` (server enum
 * value), an `icon` key (rendered per platform, never as emoji), and `label`.
 * The last entry (`other`) is the default/fallback.
 *
 * Single source for web ExpensesTab + mobile CrewExpenses.
 */
export const EXPENSE_CATEGORIES: readonly {
  id: string;
  icon: ExpenseIconKey;
  label: string;
}[] = [
  { id: 'food', icon: 'utensils', label: 'Food' },
  { id: 'drinks', icon: 'beer', label: 'Drinks' },
  { id: 'transport', icon: 'car', label: 'Ride' },
  { id: 'hotel', icon: 'bed', label: 'Hotel' },
  { id: 'tickets', icon: 'ticket', label: 'Tickets' },
  { id: 'other', icon: 'wallet', label: 'Other' },
] as const;

/**
 * Look up a category by id, falling back to the last entry (`other`).
 * Shared helper so both platforms use the same fallback logic.
 */
export function expenseCategoryFor(id: string): (typeof EXPENSE_CATEGORIES)[number] {
  return EXPENSE_CATEGORIES.find((c) => c.id === id) ?? EXPENSE_CATEGORIES[EXPENSE_CATEGORIES.length - 1]!;
}

// ── 5-tier rating scale ────────────────────────────────────────────────────

/**
 * 5-tier set-rating scale data. Icon refs are intentionally absent —
 * web uses Lucide (Flame, Smile, ThumbsUp, Meh, ThumbsDown) and mobile uses
 * Ionicons (flame, happy, thumbs-up, remove, thumbs-down); keep those per-
 * platform. `order` is highest-first so [0] is the best rating.
 *
 * Single source for web ratingIcon + mobile RatingButtons.
 */
export const RATING_SCALE_DATA: readonly {
  value: number;
  label: string;
  /** Display order, 0-indexed highest-first (value 5 → order 0). */
  order: number;
}[] = [
  { value: 5, label: 'Fire', order: 0 },
  { value: 4, label: 'Good', order: 1 },
  { value: 3, label: 'Okay', order: 2 },
  { value: 2, label: 'Meh', order: 3 },
  { value: 1, label: 'Skip', order: 4 },
] as const;

/** High → low numeric rating values, for rendering order. */
export const RATING_SCALE = RATING_SCALE_DATA.map((r) => r.value) as readonly number[];

/** Quick label lookup by numeric rating value. */
export const RATING_LABEL: Record<number, string> = Object.fromEntries(
  RATING_SCALE_DATA.map((r) => [r.value, r.label]),
);

/** Caption under the rating row; identical on web and mobile. */
export function ratingCaption(value: number | null): string {
  if (value == null || !RATING_LABEL[value]) return 'Tap to rate this set';
  return `You rated this: ${RATING_LABEL[value]} (${value} of 5)`;
}

export const PRIORITY_MAP: Record<string, string> = {
  must: 'must',
  'want-to-see': 'want',
  maybe: 'maybe',
};

export const PRIORITY_COLORS: Record<Priority, string> = {
  must: 'var(--priority-must)',
  'want-to-see': 'var(--priority-want)',
  maybe: 'var(--priority-maybe)',
};

export const PRIORITY_LABELS: Record<Priority, string> = {
  must: 'Must See',
  'want-to-see': 'Want to See',
  maybe: 'Maybe',
};

export const TRUSTED_MUTATION_HEADER = 'X-Festie-Request';

export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

export const ALLOWED_AVATAR_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

export const OFFLINE_SNAPSHOT_KEY = 'festivalPlannerOfflineSnapshotV2';

export const LEGACY_OFFLINE_KEYS = ['festivalPlannerOfflineSnapshotV1'];

export const OFFLINE_SYNC_KEY = 'festivalPlannerPendingProfileSyncV1';

export const MAX_IMPORT_TEXT_LENGTH = 200000;

/**
 * Live Location tuning shared by web + mobile publishers. OFF by default; these
 * only apply once a user opts in per-session. Conservative on purpose: festival
 * phones have poor signal + limited battery.
 *   UPDATE_INTERVAL_MS — min time between published fixes (~10s).
 *   MIN_MOVE_METERS    — publish early if moved more than this since last send.
 *   FRESH_MS           — a peer newer than this reads as "live" (pulsing avatar);
 *                        between FRESH_MS and STALE_MS the marker desaturates and
 *                        shows a "last seen N ago" chip before it's swept.
 *   STALE_MS           — a peer older than this is swept from the map (matches
 *                        the server's 120s TTL; client sweep is defense in depth).
 *   MAX_SESSION_MS     — default hard cap (60 min): forgotten sharing auto-stops
 *                        when no explicit duration was chosen (e.g. web).
 */
export const LIVE_LOCATION = {
  UPDATE_INTERVAL_MS: 10_000,
  MIN_MOVE_METERS: 15,
  FRESH_MS: 30_000,
  STALE_MS: 120_000,
  MAX_SESSION_MS: 3_600_000,
} as const;

/**
 * Time-boxed live-location sharing (the opt-in sheet on both apps). The user
 * picks an explicit bound up-front (default ~2h, Find My-style) after which the
 * publisher auto-expires — no silent indefinite sharing. There is no "until the
 * festival ends" preset: sharing is foreground-only on mobile, so it cannot
 * honestly promise that. "Rest of today" is built per call by liveShareOptions.
 * LIVE_SHARE_MAX_MS caps any session.
 */
export const LIVE_SHARE_MAX_MS = 12 * 3_600_000;

export interface LiveShareDuration {
  id: string;
  label: string;
  /** Bound in ms (clamped to LIVE_SHARE_MAX_MS). */
  ms: number;
}

export const LIVE_SHARE_DURATIONS: readonly LiveShareDuration[] = [
  { id: '1h', label: '1 hour', ms: 3_600_000 },
  { id: '2h', label: '2 hours', ms: 7_200_000 },
  { id: '4h', label: '4 hours', ms: 14_400_000 },
];

export const LIVE_SHARE_DEFAULT_DURATION_ID = '2h';

/** Resolve a preset's effective bound in ms. */
export function resolveLiveShareMs(d: LiveShareDuration): number {
  return Math.min(d.ms, LIVE_SHARE_MAX_MS);
}

/** Live-sharing copy single-sourced for web + mobile. The stop rule differs because the behaviour does. */
export const LIVE_SHARE_COPY = {
  title: 'Share my live location',
  switchA11y: 'Share my live location with this crew',
  ruleNative: 'Only this crew sees it. It stops at the time you pick, or when you lock your phone or leave the app.',
  ruleWeb: 'Only this crew sees it. It stops at the time you pick, or when you close this tab.',
  chooserTitle: 'Share your location for…',
  restOfToday: (clock: string) => `Rest of today (until ${clock})`,
  battery: 'Show my battery level',
  batteryHint: 'Helps your crew see why your dot went quiet.',
  cancel: 'Not now',
  sharingTitle: "You're sharing your live location",
  sharingSub: (countdown: string, clock: string) => `Ends in ${countdown} · ${clock}`,
  pausedTitle: 'Sharing paused',
  pausedSub: (countdown: string, clock: string) => `Your crew can't see you. Ends in ${countdown} · ${clock}`,
  pause: 'Pause',
  pauseA11y: 'Pause sharing. Your crew stops seeing you.',
  resume: 'Resume',
  resumeA11y: 'Resume sharing my live location',
  stop: 'Stop',
  stopA11y: 'Stop sharing my live location',
  // One-time explainer before the first share on a device.
  explainerTitle: 'Before you share your location',
  explainerPoints: [
    'Only this crew sees where you are.',
    'Festie keeps no location history. It holds only your latest position, for 2 minutes at most.',
    'It runs only while Festie is open.',
    'It stops at the time you pick. You can pause or stop it at any time.',
  ],
  explainerOk: 'Got it',
} as const;

export const LOW_POWER_COPY = {
  name: 'Low-power mode',
  hint: 'Saves battery: pauses live location and background refresh, and uses less GPS on the map. Reminders and your crew plan keep working.',
  livePaused: 'Live location is off while low-power mode is on.',
  turnOff: 'Turn off low-power mode',
} as const;

/** The T10 crew-status sentence, shared by both apps. */
export const CREW_STATUS_HONESTY = 'Not live: each status shows when that crewmate last had signal.';

export const CHECKIN_DURATIONS = [
  { minutes: 15, label: '15 min' },
  { minutes: 30, label: '30 min' },
  { minutes: 60, label: '1 hour' },
  { minutes: 120, label: '2 hours' },
] as const;

export const CHECKIN_COPY = {
  title: 'Check-in timer',
  idleBody:
    "Walking somewhere alone? Start a timer. If you don't check in on time, your crew gets an SOS with your last location.",
  activeTitle: (clock: string) => `Check in by ${clock}`,
  activeBody: (countdown: string) => `${countdown} left. Tap I'm OK when you get there, or your crew gets an SOS.`,
  ok: "I'm OK",
  okA11y: "I'm OK. Stop the check-in timer.",
  started: (clock: string) => `Check-in timer set for ${clock}.`,
  done: 'Checked in. Timer stopped.',
  ended: "Your timer had already ended, so your crew got an SOS. Clear it if you're OK.",
} as const;

export const BEACON_COPY = {
  button: 'Beacon',
  buttonHint:
    'Turn your screen into a bright flashing signal so friends can spot you in a crowd. No GPS or signal needed.',
  prompt: 'Hold your phone up high',
  footer: 'Turn your screen brightness all the way up.',
  done: 'Done',
  a11y: 'Beacon is on. Your screen is flashing so friends can spot you. Tap Done to stop.',
} as const;

/** Intro slides, single-sourced for web and mobile (design-system-23). Slide 1 names the three priorities. */
export const ONBOARDING_SLIDES_SHARED = [
  {
    key: 'plan',
    title: 'Plan your weekend',
    description: 'Tap Must See, Want to See or Maybe on any set. Your plan fills in across every stage.',
  },
  {
    key: 'crew',
    title: 'Keep your crew together',
    description: 'Compare plans, set meeting points and find each other when the signal drops.',
  },
  {
    key: 'reminders',
    title: 'Reminders before your sets',
    description: 'Get a reminder before each set you picked.',
  },
] as const;

export const ONBOARDING_COPY = {
  dialogLabel: 'Welcome to Festie',
  next: 'Next',
  skip: 'Skip',
  skipA11y: 'Skip intro',
  festival: {
    title: 'Which festival?',
    description: 'Pick the one you are going to. You can switch later.',
  },
  going: {
    title: 'Going with friends?',
    description: 'A crew shares plans, meeting points and where everyone is.',
    start: 'Start a crew',
    join: 'I have an invite code',
    solo: 'Just me',
  },
  signInPrompt: 'Already have an account?',
  signIn: 'Sign in',
} as const;

export const INTRO_REPLAY_COPY = {
  title: 'How Festie works',
  hint: 'Replay the intro',
  a11y: 'Replay the Festie intro',
} as const;

export const FESTIVAL_READY_COPY = {
  title: 'Festival ready',
  hide: 'Hide',
  hideA11y: 'Hide the Festival ready checklist',
  items: {
    picks: { label: 'Pick your first sets', hint: 'Tap Must See, Want to See or Maybe on any set below.' },
    crew: { label: 'Start or join a crew', hint: 'Share plans and find each other on the day.' },
    reminders: { label: 'Turn on set reminders', hint: 'Get a reminder before each set you picked.' },
    offline: { label: 'Download for offline', hint: 'Keep your schedule and picks when the signal drops.' },
  },
} as const;

/** Guest sign-in prompts, single-sourced so web and mobile teasers match. */
export const GUEST_PROMPT_COPY = {
  createAccount: 'Create account',
  signIn: 'Sign in',
  setSheet: 'Create a free account to keep private notes, set reminders and compare crew overlap.',
  follow: {
    title: (festivalName: string): string => `Follow ${festivalName}`,
    message: 'Create a free account to hear when the lineup and set times are out.',
  },
  guestPicks: {
    title: 'Your picks are saved on this device',
    body: 'Create a free account to keep them on every device and plan with your crew.',
    cta: 'Create free account',
    signIn: 'I have an account',
  },
  teasers: {
    picks: {
      title: 'Save your festival picks',
      message: 'Create a free account to mark sets Must See, Want to See or Maybe, and share them with your crew.',
    },
    crew: {
      title: 'Plan with your crew',
      message: 'Create a free account to invite friends, compare picks and find the sets you all want to see.',
    },
    wrap: {
      title: 'See your festival recap',
      message: 'Create a free account to rate sets and get a recap of your festival to share.',
    },
  },
} as const;

export const SOCKET_RECONNECTION_CONFIG = {
  reconnection: true,
  reconnectionDelay: 1000,
  randomizationFactor: 0.5,
  reconnectionDelayMax: 5000,
  reconnectionAttempts: Infinity,
};

// ── Crew limits ────────────────────────────────────────────────────────────
// `lib/constants.ts` is the source. `tests/constants-parity.test.ts` guards this copy.
export const MAX_CREWS_PER_FESTIVAL = 3;
export const MAX_OPEN_POLLS_PER_CREW = 3;
export const DEFAULT_CREW_MAX_MEMBERS = 30;
