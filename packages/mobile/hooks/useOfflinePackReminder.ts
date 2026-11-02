import { useEffect, useMemo } from 'react';
import * as Notifications from 'expo-notifications';
import * as Sentry from '@sentry/react-native';
import { useFestivalDataStore, useNotificationPrefsStore } from '@festie/shared/stores';
import {
  OFFLINE_REMINDER_TEXT,
  offlineReminderAt,
  offlineReminderId,
  resolveFestivalTimeZone,
} from '@festie/shared/utils';

/**
 * Day-before local notification: 18:00 festival time on the eve of day 1, until
 * the offline pack is ready. The time math is in `@festie/shared` (offlineReminderAt).
 * The id is stable per festival and a past time is never rescheduled, so a
 * festival gets at most one reminder. Only reads notification permission; the
 * set sheet asks for it.
 */
export function useOfflinePackReminder(festivalId: string, packReady: boolean, enabled: boolean): void {
  const festival = useFestivalDataStore((s) => s.currentFestival);
  const days = useFestivalDataStore((s) => s.days);
  const dndStart = useNotificationPrefsStore((s) => s.prefs.dndStart);
  const dndEnd = useNotificationPrefsStore((s) => s.prefs.dndEnd);
  const dndTimeZone = useNotificationPrefsStore((s) => s.prefs.dndTimeZone);

  const timeZone = resolveFestivalTimeZone(festival);
  const sameFestival = festival?.id === festivalId;
  const at = useMemo(
    () =>
      sameFestival
        ? offlineReminderAt(days, { timeZone, packReady, quietHours: { dndStart, dndEnd, dndTimeZone } })
        : null,
    [sameFestival, days, timeZone, packReady, dndStart, dndEnd, dndTimeZone],
  );

  useEffect(() => {
    if (!enabled || !sameFestival) return;
    const id = offlineReminderId(festivalId);
    if (at === null) {
      Notifications.cancelScheduledNotificationAsync(id).catch((e) => Sentry.captureException(e));
      return;
    }
    if (at <= Date.now()) return;
    (async () => {
      const { status } = await Notifications.getPermissionsAsync();
      if (status !== 'granted') return;
      await Notifications.scheduleNotificationAsync({
        identifier: id,
        content: {
          title: 'Get ready for no signal',
          body: OFFLINE_REMINDER_TEXT,
          data: { kind: 'offline-pack-reminder', festivalId },
        },
        // Android-only channel (created by useMobilePush); ignored on iOS.
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(at), channelId: 'updates' },
      });
    })().catch((e) => Sentry.captureException(e));
  }, [enabled, sameFestival, festivalId, at]);
}
