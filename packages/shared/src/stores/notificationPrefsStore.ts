import { create } from 'zustand';
import { api } from '../services/api';
import { mapErrorToUserMessage } from '../services/errors';
import { isValidTimeZone } from '../utils/festivalTime';

/**
 * Per-user notification preferences, backed by GET/PUT /notifications/prefs.
 * (Named NotificationPreferences to avoid clashing with the legacy
 * domain.ts `NotificationPrefs` shape, which does not match this endpoint.)
 * The backend stores booleans as 0/1, so reads are normalized to booleans.
 * DND times are 'HH:MM' (24h) strings or null.
 */
export interface NotificationPreferences {
  crewUpdates: boolean;
  setReminders: boolean;
  scheduleChanges: boolean;
  /** M3 re-engagement: new lineup published for a festival you attended before. */
  lineupDrops: boolean;
  /** M3 re-engagement: a prior crew was reformed for a new festival (you were invited). */
  crewReformed: boolean;
  /** M3 re-engagement: your festival wrap-up recap is ready. */
  wrapReady: boolean;
  dndStart: string | null;
  dndEnd: string | null;
  /** IANA zone the quiet-hours window is read in; null = server clock. */
  dndTimeZone: string | null;
}

export const DEFAULT_NOTIFICATION_PREFS: NotificationPreferences = {
  crewUpdates: true,
  setReminders: true,
  scheduleChanges: true,
  lineupDrops: true,
  crewReformed: true,
  wrapReady: true,
  dndStart: null,
  dndEnd: null,
  dndTimeZone: null,
};

function toBool(v: unknown, dflt: boolean): boolean {
  if (v === undefined || v === null) return dflt;
  return v === true || v === 1 || v === '1';
}

function normalize(raw: Record<string, unknown> | null | undefined): NotificationPreferences {
  const r = raw || {};
  return {
    crewUpdates: toBool(r.crewUpdates, true),
    setReminders: toBool(r.setReminders, true),
    scheduleChanges: toBool(r.scheduleChanges, true),
    lineupDrops: toBool(r.lineupDrops, true),
    crewReformed: toBool(r.crewReformed, true),
    wrapReady: toBool(r.wrapReady, true),
    dndStart: (r.dndStart as string) ?? null,
    dndEnd: (r.dndEnd as string) ?? null,
    dndTimeZone: (r.dndTimeZone as string) ?? null,
  };
}

function deviceTimeZone(): string | null {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return isValidTimeZone(tz) ? tz : null;
  } catch {
    return null;
  }
}

interface NotificationPrefsState {
  prefs: NotificationPreferences;
  loaded: boolean;
  isLoading: boolean;
  error: string | null;
  loadPrefs: () => Promise<void>;
  updatePrefs: (patch: Partial<NotificationPreferences>) => Promise<void>;
}

export const useNotificationPrefsStore = create<NotificationPrefsState>((set, get) => ({
  prefs: DEFAULT_NOTIFICATION_PREFS,
  loaded: false,
  isLoading: false,
  error: null,

  loadPrefs: async () => {
    set({ isLoading: true, error: null });
    try {
      const raw = await api.get<Record<string, unknown>>('/notifications/prefs');
      const prefs = normalize(raw);
      set({ prefs, loaded: true, isLoading: false });
      // Quiet hours follow the phone when the user travels.
      // shortcut: the zone updates only when the user opens Account; upgrade to a sync on app foreground.
      const device = deviceTimeZone();
      if (prefs.dndStart && device && device !== prefs.dndTimeZone) {
        get()
          .updatePrefs({ dndTimeZone: device })
          .catch(() => {});
      }
    } catch (err) {
      set({ error: mapErrorToUserMessage(err, 'Failed to load notification settings'), isLoading: false });
      throw err;
    }
  },

  updatePrefs: async (patch: Partial<NotificationPreferences>) => {
    const prev = get().prefs;
    // Setting a quiet-hours window pins it to the zone the user is in right now.
    if (typeof patch.dndStart === 'string') patch = { ...patch, dndTimeZone: deviceTimeZone() };
    const next = { ...prev, ...patch };
    set({ prefs: next, error: null }); // optimistic
    try {
      // Server accepts the patch and merges; keep the optimistic value rather
      // than re-deriving from the response (its shape isn't guaranteed full).
      await api.put('/notifications/prefs', patch);
    } catch (err) {
      set({ prefs: prev, error: mapErrorToUserMessage(err, 'Failed to save notification settings') });
      throw err;
    }
  },
}));
