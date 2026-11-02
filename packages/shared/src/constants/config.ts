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
  'settlement-undone': 'undid a payment',
  'home-base-updated': 'updated Home Base',
  'meeting-point-added': 'dropped a meeting point',
  'meeting-point-removed': 'removed a meeting point',
  'crew-updated': 'updated the crew',
  sos_raised: 'raised an SOS',
  sos_cleared: 'cleared an SOS',
};

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
 * Time-boxed live-location sharing (the mobile opt-in sheet). Sharing is already
 * foreground-only and auto-stops on background; on top of that the user picks an
 * explicit bound up-front (default ~2h, Find My-style) after which the publisher
 * auto-expires — no silent indefinite sharing. `ms: null` = "until the festival
 * ends", which is clamped to LIVE_SHARE_MAX_MS so a forgotten session can never
 * run unbounded even if the device stays foregrounded.
 */
export const LIVE_SHARE_MAX_MS = 12 * 3_600_000;

export interface LiveShareDuration {
  id: string;
  label: string;
  /** Bound in ms, or null for "until the festival ends" (clamped to LIVE_SHARE_MAX_MS). */
  ms: number | null;
}

export const LIVE_SHARE_DURATIONS: readonly LiveShareDuration[] = [
  { id: '1h', label: '1 hour', ms: 3_600_000 },
  { id: '2h', label: '2 hours', ms: 7_200_000 },
  { id: '4h', label: '4 hours', ms: 14_400_000 },
  { id: 'festival', label: 'Until the festival ends', ms: null },
];

export const LIVE_SHARE_DEFAULT_DURATION_ID = '2h';

/** Resolve a preset's effective bound in ms (null → the festival ceiling). */
export function resolveLiveShareMs(d: LiveShareDuration): number {
  return d.ms == null ? LIVE_SHARE_MAX_MS : Math.min(d.ms, LIVE_SHARE_MAX_MS);
}

/**
 * Onboarding slide copy single-sourced for web + mobile parity (DC29 Option B).
 * Mobile's third slide (local notifications) is platform-specific and lives only
 * in FirstRunIntro.tsx. These two shared slides cover the core product value props.
 * Web step-1 icon uses the Star icon (picks); web step-2 icon uses the Users icon.
 * Mobile slides 1 and 2 correspond to these entries.
 */
export const ONBOARDING_SLIDES_SHARED = [
  {
    title: 'Your festival, planned',
    description: "Pick the sets you can't miss across every stage and see your whole weekend at a glance.",
  },
  {
    title: 'Keep your crew together',
    description: 'Compare schedules, drop meeting points, and find each other when the signal drops.',
  },
] as const;

/** Guest sign-in prompts, single-sourced so web and mobile teasers match. */
export const GUEST_PROMPT_COPY = {
  createAccount: 'Create account',
  signIn: 'Sign in',
  setSheet: 'Sign in to save picks, keep private notes and compare crew overlap.',
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
