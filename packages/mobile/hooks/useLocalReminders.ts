import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Sentry from '@sentry/react-native';
import { useFestivalDataStore, useNotificationPrefsStore } from '@festie/shared/stores';
import {
  artistDisplayName,
  buildReminderPlan,
  diffReminderPlan,
  effectiveReminders,
  MAX_LOCAL_REMINDERS,
  resolveFestivalTimeZone,
} from '@festie/shared/utils';
import type { ReminderPlanEntry } from '@festie/shared/utils';
import type { FestivalSet } from '@festie/shared/types';
import { reportLocalRemindersFestival } from './useMobilePush';

/**
 * M1 — Pre-computed LOCAL set reminders (on-device).
 *
 * Diffs the current profile's `reminders` map (`setId -> lead minutes`) into a
 * deterministic set of on-device notifications and reconciles them with what's
 * already scheduled. Each reminder uses the stable identifier
 * `festie-reminder-<setId>` and fires at the set's TZ-safe start (via the shared
 * `getSetTimeBounds`, incl. post-midnight rollover) minus the lead minutes.
 *
 * Local-first delivery: these fire even in airplane mode — the core value at a
 * festival with no signal. FCM (see `useMobilePush`) stays as the at-home
 * backstop. After each reconcile this hook reports the covered festival to the
 * server (`reportLocalRemindersFestival`), which then skips the push for it.
 *
 * Behavior:
 * - Reconciles on every change to picks/reminders/sets/days (and on app
 *   foreground, since the wall-clock advances and past reminders should drop).
 * - Caps to the next ≤64 upcoming reminders (iOS local-notification limit),
 *   prioritizing must > want-to-see > maybe (logic lives in `@festie/shared`).
 * - Cancels reminders for sets that were un-reminded, by deterministic id.
 * - Gated on the user's set-reminders preference (`notificationPrefs.setReminders`,
 *   the existing pref that controls schedule alerts). When off, all local
 *   reminders are cancelled.
 * - Only reads notification permission (the set sheet asks) — no permission just no-ops.
 *
 * The `expo-notifications` calls live here (mobile); the diff/cap/priority math
 * is in `@festie/shared/utils/reminderSchedule` so it stays testable and shared.
 */
export function useLocalReminders(): void {
  const reminders = useFestivalDataStore((s) => s.currentProfile?.reminders);
  const picks = useFestivalDataStore((s) => s.currentProfile?.picks);
  const sets = useFestivalDataStore((s) => s.sets) as FestivalSet[];
  const days = useFestivalDataStore((s) => s.days);
  const b2bSeparator = useFestivalDataStore((s) => s.currentFestival?.b2bSeparator);
  // Anchor fire times in the FESTIVAL's zone when known (falls back to
  // device-local). Recomputed on every reconcile, so a schedule change or a
  // device-zone change re-derives the correct fire instants.
  const festivalTimeZone = useFestivalDataStore((s) => resolveFestivalTimeZone(s.currentFestival));
  const festivalId = useFestivalDataStore((s) => s.currentFestival?.id);

  const setRemindersPref = useNotificationPrefsStore((s) => s.prefs.setReminders);
  const mustSeeReminderMinutes = useNotificationPrefsStore((s) => s.prefs.mustSeeReminderMinutes);
  const loadPrefs = useNotificationPrefsStore((s) => s.loadPrefs);

  // Whether permission was granted. The set sheet asks; this hook only reads it.
  const permissionRef = useRef<{ granted: boolean }>({ granted: false });

  // Pull the latest server prefs once so gating reflects the real value even if
  // the user never opened the account screen. Best-effort — defaults to enabled.
  useEffect(() => {
    loadPrefs().catch(() => {});
  }, [loadPrefs]);

  useEffect(() => {
    ensureReminderCategory().catch((e) => Sentry.captureException(e));
  }, []);

  /** Read notification permission (never asks: the set sheet does); returns whether granted. */
  // Defined before the reconcile effect that calls it (avoids a TDZ/forward ref).
  // Depends only on the stable permissionRef, so the identity is stable.
  const ensurePermission = useCallback(async (): Promise<boolean> => {
    if (permissionRef.current.granted) return true;
    try {
      const existing = await Notifications.getPermissionsAsync();
      const granted = existing.status === 'granted';
      permissionRef.current.granted = granted;
      return granted;
    } catch (e) {
      Sentry.captureException(e);
      return false;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function reconcile(): Promise<void> {
      // Gate: when set reminders are disabled, tear down any local reminders we
      // previously scheduled and stop. (Don't touch FCM — that's server-gated.)
      if (!setRemindersPref) {
        await cancelAllFestieReminders();
        return;
      }

      const merged = effectiveReminders(reminders, picks, mustSeeReminderMinutes);
      const plan = buildReminderPlan({ reminders: merged, picks, sets, days, timeZone: festivalTimeZone });

      // Nothing to schedule and (likely) nothing scheduled — still reconcile so
      // un-reminded sets get cancelled. But avoid prompting for permission when
      // there's no work and we've never been granted it.
      if (plan.length > 0 && !permissionRef.current.granted) {
        const granted = await ensurePermission();
        if (cancelled) return;
        if (!granted) return; // permission denied — no-op gracefully
      }

      let scheduled: Notifications.NotificationRequest[];
      try {
        scheduled = await Notifications.getAllScheduledNotificationsAsync();
      } catch (e) {
        Sentry.captureException(e);
        return;
      }
      if (cancelled) return;

      const scheduledIds = scheduled.map((n) => n.identifier);
      const { toSchedule, toCancel } = diffReminderPlan(plan, scheduledIds);

      // Cancel removed reminders by identifier.
      await Promise.all(
        toCancel.map((id) =>
          Notifications.cancelScheduledNotificationAsync(id).catch((e) => Sentry.captureException(e)),
        ),
      );
      if (cancelled) return;

      // (Re)schedule plan entries. Deterministic identifiers make this
      // idempotent — re-scheduling the same id replaces the prior one, so an
      // edited lead time gets the corrected fire date.
      const results = await Promise.all(
        toSchedule.map((entry) => scheduleReminder(entry, b2bSeparator, festivalTimeZone)),
      );
      if (cancelled) return;

      // Above the iOS slot cap, or after a failed schedule, some reminders are not on
      // the phone, so the server push must stay on.
      const fullyLocal = Object.keys(merged).length <= MAX_LOCAL_REMINDERS && results.every(Boolean);
      await reportLocalRemindersFestival(permissionRef.current.granted && fullyLocal && festivalId ? festivalId : null);
    }

    reconcile();

    // Re-run on foreground: the wall-clock has advanced, so already-fired or
    // now-past reminders should be dropped and the ≤64 window re-evaluated.
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') reconcile();
    });

    return () => {
      cancelled = true;
      sub.remove();
    };
    // permissionRef is a ref (stable); intentionally excluded.
  }, [reminders, picks, sets, days, b2bSeparator, setRemindersPref, mustSeeReminderMinutes, festivalTimeZone, festivalId, ensurePermission]);
}

const REMINDER_CATEGORY = 'set-reminder';
const SNOOZE_ACTION = 'snooze-5';
const SNOOZE_MS = 5 * 60_000;

/** Register the "Snooze 5 min" button for reminder notifications. */
export function ensureReminderCategory(): Promise<unknown> {
  // shortcut: snooze opens the app, because a background action needs expo-task-manager (a native build); upgrade with the tranche 41 native build.
  return Notifications.setNotificationCategoryAsync(REMINDER_CATEGORY, [
    { identifier: SNOOZE_ACTION, buttonTitle: 'Snooze 5 min', options: { opensAppToForeground: true } },
  ]);
}

/** Re-fire a tapped reminder five minutes later. The `festie-snooze-` id stays out of the reconcile cancel list. */
export async function snoozeReminder(content: Notifications.NotificationContent): Promise<void> {
  const data = (content.data ?? {}) as { setId?: unknown; startMs?: unknown; name?: unknown };
  if (typeof data.setId !== 'string') return;
  const fireAt = Date.now() + SNOOZE_MS;
  const name = typeof data.name === 'string' && data.name ? data.name : 'Your set';
  const minutes = typeof data.startMs === 'number' ? Math.round((data.startMs - fireAt) / 60000) : 0;
  try {
    await Notifications.scheduleNotificationAsync({
      identifier: `festie-snooze-${data.setId}`,
      content: {
        title: minutes > 0 ? `${name} starts in ${minutes} min` : `${name} is starting now`,
        body: content.body ?? '',
        sound: true,
        categoryIdentifier: REMINDER_CATEGORY,
        data: content.data,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: new Date(fireAt),
        channelId: 'set-reminders',
      },
    });
  } catch (e) {
    Sentry.captureException(e);
  }
}

/**
 * Schedule a single reminder. On Android we route to the 'set-reminders'
 * channel (HIGH importance, created by useMobilePush — DC7 split) so local
 * alarms land in the dedicated set-reminders channel that users can tune
 * independently from crew updates.
 */
/** Returns false when scheduling failed (already reported to Sentry). */
async function scheduleReminder(entry: ReminderPlanEntry, b2bSeparator?: string, timeZone?: string): Promise<boolean> {
  const name = artistDisplayName(entry.set, b2bSeparator) || 'Your set';
  // Format in the festival's time zone so the notification body shows the set's
  // local start time, not the device's TZ (which may differ for traveling users).
  const fmtOpts: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' };
  if (timeZone) fmtOpts.timeZone = timeZone;
  const startLabel = new Date(entry.startMs).toLocaleTimeString([], fmtOpts);
  const lead = entry.leadMinutes;
  // TODO(a11y/copy): this rounds e.g. 90m → "2h" instead of "1h 30m". The ideal
  // fix is to reuse a shared compact-countdown helper, but `fmtCountdown` is only
  // defined privately in shared/utils/ongoingNotification.ts (and again locally in
  // NowNextStrip) — it is NOT exported from @festie/shared/utils. Skipped per spec
  // until a shared helper is exported; do not duplicate it here.
  const leadText = lead >= 60 ? `${Math.round(lead / 60)}h` : `${lead}m`;

  try {
    await Notifications.scheduleNotificationAsync({
      identifier: entry.identifier,
      content: {
        title: `${name} in ${leadText}`,
        body: `Starts at ${startLabel}. Heads up from your Festie picks.`,
        sound: true,
        categoryIdentifier: REMINDER_CATEGORY,
        data: { kind: 'local-set-reminder', setId: entry.setId, startMs: entry.startMs, name },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: new Date(entry.fireAtMs),
        // Android-only; routes to the HIGH-importance 'set-reminders' channel
        // (DC7 split, created by useMobilePush). Ignored on iOS.
        channelId: 'set-reminders',
      },
    });
    return true;
  } catch (e) {
    Sentry.captureException(e);
    return false;
  }
}

/** Cancel every Festie local reminder currently scheduled (gate-off teardown). */
async function cancelAllFestieReminders(): Promise<void> {
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(
      scheduled
        .filter((n) => n.identifier.startsWith('festie-reminder-'))
        .map((n) =>
          Notifications.cancelScheduledNotificationAsync(n.identifier).catch((e) => Sentry.captureException(e)),
        ),
    );
  } catch (e) {
    Sentry.captureException(e);
  }
}
