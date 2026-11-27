import { useCallback, useEffect, useMemo, useState } from 'react';
import { getStorage } from '../platform/storage';
import { useAuthStore } from '../stores/authStore';
import { useCrewStore } from '../stores/crewStore';
import { useFestivalDataStore } from '../stores/festivalDataStore';
import { useNotificationPrefsStore } from '../stores/notificationPrefsStore';
import { useOfflineReadinessStore, type SectionReadiness } from '../stores/offlineReadinessStore';
import {
  countOpenInterests,
  formatReadyProgress,
  getFestivalReadyChecklist,
  isFestivalDownloaded,
  type FestivalReadyItem,
} from '../utils/festivalReady';
import { festivalPhase } from '../utils/festivalTime';
import { setTimesPending } from '../utils/scheduleFilters';

const hiddenKey = (festivalId: string) => `festie_ready_hidden:${festivalId}`;

/**
 * The hidden flag when the storage adapter answers synchronously (web localStorage), else null.
 * Reading it during render lets the card appear in the same paint as the content around it instead of one frame later.
 */
function peekHidden(festivalId: string): boolean | null {
  try {
    const raw = getStorage().getItem(hiddenKey(festivalId));
    if (raw instanceof Promise) {
      // The effect below does the real read and handles its error; this one is thrown away.
      raw.catch(() => {});
      return null;
    }
    return raw === '1';
  } catch {
    return null;
  }
}

/** Drives the "Festival ready" checklist card. Visible only before the festival, to signed-in users. */
export function useFestivalReady(
  notificationsAllowed: boolean,
  now?: Date,
  /** The offline map step, or null/omitted when the festival has none. */
  offlineMap: SectionReadiness | null = null,
): {
  visible: boolean;
  items: FestivalReadyItem[];
  doneCount: number;
  total: number;
  progressLabel: string;
  hide: () => void;
} {
  const user = useAuthStore((s) => s.user);
  const currentFestival = useFestivalDataStore((s) => s.currentFestival);
  const currentProfile = useFestivalDataStore((s) => s.currentProfile);
  const days = useFestivalDataStore((s) => s.days);
  const sets = useFestivalDataStore((s) => s.sets);
  const crews = useCrewStore((s) => s.crews);
  const prefs = useNotificationPrefsStore((s) => s.prefs);
  const loaded = useNotificationPrefsStore((s) => s.loaded);
  const loadPrefs = useNotificationPrefsStore((s) => s.loadPrefs);
  const readiness = useOfflineReadinessStore((s) => (currentFestival ? s.byFestival[currentFestival.id] : undefined));

  const festivalId = currentFestival?.id ?? null;
  const [hidden, setHidden] = useState<boolean | null>(null);

  const signedIn = !!user;
  useEffect(() => {
    if (signedIn && !loaded) {
      // The store already holds the error, and the default prefs stay.
      loadPrefs().catch(() => {});
    }
  }, [signedIn, loaded, loadPrefs]);

  useEffect(() => {
    setHidden(null);
    if (!festivalId) return;
    let cancelled = false;
    Promise.resolve()
      .then(() => getStorage().getItem(hiddenKey(festivalId)))
      .then(
        (v) => {
          if (!cancelled) setHidden(v === '1');
        },
        () => {
          if (!cancelled) setHidden(false);
        },
      );
    return () => {
      cancelled = true;
    };
  }, [festivalId]);

  const hide = useCallback(() => {
    if (!festivalId) return;
    setHidden(true);
    // A write error leaves the card hidden for this session only.
    Promise.resolve()
      .then(() => getStorage().setItem(hiddenKey(festivalId), '1'))
      .catch(() => {});
  }, [festivalId]);

  const { items, doneCount, total } = getFestivalReadyChecklist({
    pickCount: Object.keys(currentProfile?.picks ?? {}).length,
    interestCount: countOpenInterests(currentProfile?.interests, currentFestival?.lineup),
    hasLineup: (currentFestival?.lineup?.length ?? 0) > 0,
    hasCrew: !!currentFestival && crews.some((c) => !c.festivalId || c.festivalId === currentFestival.id),
    remindersOn: notificationsAllowed && prefs.setReminders,
    offlineReady: isFestivalDownloaded(readiness, offlineMap),
    timesPending: setTimesPending(sets),
  });

  // Once per festival, so an async adapter (mobile) does not start a new read on every render.
  const peekedHidden = useMemo(() => (festivalId ? peekHidden(festivalId) : null), [festivalId]);
  const resolvedHidden = hidden ?? peekedHidden;
  const visible =
    !!user &&
    !!currentFestival &&
    festivalPhase(currentFestival, days, now) === 'pre' &&
    resolvedHidden === false &&
    doneCount < total;

  return { visible, items, doneCount, total, progressLabel: formatReadyProgress(doneCount, total), hide };
}
