import { useCallback, useEffect, useState } from 'react';
import { getStorage } from '../platform/storage';
import { useAuthStore } from '../stores/authStore';
import { useCrewStore } from '../stores/crewStore';
import { useFestivalDataStore } from '../stores/festivalDataStore';
import { useNotificationPrefsStore } from '../stores/notificationPrefsStore';
import { useOfflineReadinessStore } from '../stores/offlineReadinessStore';
import {
  formatReadyProgress,
  getFestivalReadyChecklist,
  isFestivalDownloaded,
  type FestivalReadyItem,
} from '../utils/festivalReady';
import { festivalPhase } from '../utils/festivalTime';

const hiddenKey = (festivalId: string) => `festie_ready_hidden:${festivalId}`;

/** Drives the "Festival ready" checklist card. Visible only before the festival, to signed-in users. */
export function useFestivalReady(
  notificationsAllowed: boolean,
  now?: Date,
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
    hasCrew: !!currentFestival && crews.some((c) => !c.festivalId || c.festivalId === currentFestival.id),
    remindersOn: notificationsAllowed && prefs.setReminders,
    offlineReady: isFestivalDownloaded(readiness),
  });

  const visible =
    !!user &&
    !!currentFestival &&
    festivalPhase(currentFestival, days, now) === 'pre' &&
    hidden === false &&
    doneCount < total;

  return { visible, items, doneCount, total, progressLabel: formatReadyProgress(doneCount, total), hide };
}
