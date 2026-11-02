import { useCallback, useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Sentry from '@sentry/react-native';
import { api } from '@festie/shared/services';

const TOKEN_KEY = 'festie-push-token';
// Festival id last reported to the server as covered by on-device reminders.
const LOCAL_FESTIVAL_KEY = 'festie-push-local-festival';
const NO_FESTIVAL = '';

/**
 * Tell the server which festival this phone schedules local set reminders for,
 * so the reminder scheduler skips the duplicate push. Pass null to turn the
 * skip off. No-op without a registered token or when the value is unchanged.
 */
export async function reportLocalRemindersFestival(festivalId: string | null): Promise<void> {
  try {
    const token = await AsyncStorage.getItem(TOKEN_KEY);
    if (!token) return;
    const reported = await AsyncStorage.getItem(LOCAL_FESTIVAL_KEY);
    if (reported === (festivalId ?? NO_FESTIVAL)) return;
    await api.post('/notifications/token', {
      token,
      platform: Platform.OS,
      localRemindersFestivalId: festivalId,
    });
    await AsyncStorage.setItem(LOCAL_FESTIVAL_KEY, festivalId ?? NO_FESTIVAL);
  } catch (e) {
    Sentry.captureException(e);
  }
}

// Show a banner for notifications that arrive while the app is foregrounded.
// Time-critical local set reminders (scheduled with sound:true + data.kind
// 'local-set-reminder') must still CHIME when foregrounded — the user may be on
// another screen and the set is about to start. Everything else stays silent
// in-app to avoid interrupting active use. (R4: the old blanket
// shouldPlaySound:false muted reminders even when they mattered.)
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const isSetReminder = notification.request?.content?.data?.kind === 'local-set-reminder';
    return {
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: isSetReminder,
      shouldSetBadge: false,
    };
  },
});

/**
 * Ensure the Android channels exist. Idempotent — safe to call on every mount.
 *
 * DC7: 'updates' has been split into two channels so users can tune them
 * independently in Android system settings:
 *   - 'set-reminders' (HIGH)   — on-device local set alarms (time-critical).
 *   - 'crew' (DEFAULT)          — FCM crew activity (member actions, status changes).
 *   - 'sos' (MAX, bypassDnd)    — crew_sos alerts (lib/notifications/send.ts
 *                                 CRITICAL_CHANNEL routes type 'crew_sos' here).
 *
 * The legacy 'updates' channel is kept so existing scheduled local
 * notifications (that still carry channelId='updates') land on a valid
 * channel during the transition — it can be removed once all devices have
 * received a build with the new channels.
 */
export async function ensureAndroidChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('default', {
    name: 'General',
    importance: Notifications.AndroidImportance.DEFAULT,
  });
  // DC7 split: personal set reminders get their own HIGH-importance channel.
  await Notifications.setNotificationChannelAsync('set-reminders', {
    name: 'Set reminders',
    importance: Notifications.AndroidImportance.HIGH,
  });
  // DC7 split: crew activity (member updates, status changes, etc.).
  await Notifications.setNotificationChannelAsync('crew', {
    name: 'Crew updates',
    importance: Notifications.AndroidImportance.DEFAULT,
  });
  // Emergency SOS alerts — MAX importance + bypassDnd so it reaches the crew
  // regardless of Do Not Disturb settings. Without this channel, backend
  // pushes routed to channelId 'sos' (crew_sos) have no channel to land on.
  await Notifications.setNotificationChannelAsync('sos', {
    name: 'Crew SOS alerts',
    importance: Notifications.AndroidImportance.MAX,
    bypassDnd: true,
  });
  // Transition channel: keep until all devices have received a build with the
  // new channels above. Previously bundled set reminders + crew updates.
  await Notifications.setNotificationChannelAsync('updates', {
    name: 'Set reminders & crew updates (legacy)',
    importance: Notifications.AndroidImportance.HIGH,
  });
}

export type PushPermission = 'granted' | 'denied' | 'undetermined';

export interface MobilePush {
  registered: boolean;
  permission: PushPermission | null;
  canAskAgain: boolean;
  busy: boolean;
  error: string | null;
  register: () => Promise<void>;
  unregister: () => Promise<void>;
}

/**
 * Android push registration via FCM. Requests permission, gets the device's
 * FCM token (getDevicePushTokenAsync), and registers it with the backend
 * (POST /notifications/token) — the same /notifications endpoints web uses,
 * so the existing firebase-admin sender delivers to this device. The token is
 * cached locally so the toggle reflects state and can unregister later.
 *
 * Requires a real build (dev-client or production) — Expo Go cannot obtain an
 * FCM device token.
 */
export function useMobilePush(): MobilePush {
  const [registered, setRegistered] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [permission, setPermission] = useState<PushPermission | null>(null);
  const [canAskAgain, setCanAskAgain] = useState(true);

  useEffect(() => {
    const readPermission = () =>
      Notifications.getPermissionsAsync()
        .then((p) => {
          setPermission(p.status);
          setCanAskAgain(p.canAskAgain);
        })
        // Best-effort: without a reading the UI keeps the plain switch.
        .catch(() => {});
    void readPermission();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void readPermission();
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    AsyncStorage.getItem(TOKEN_KEY)
      .then((t) => setRegistered(!!t))
      // Intentional best-effort: this only seeds the toggle's initial state from
      // the cached token. A storage-read miss just defaults to not-registered —
      // not worth a Sentry event.
      .catch(() => {});
    // Create/upgrade channels on mount so already-registered users (who won't
    // re-run register) get the correct 'updates' HIGH channel after this update.
    // A failure here means reminders/crew updates arrive silently or at the wrong
    // importance — a real, user-visible problem worth reporting.
    ensureAndroidChannels().catch((e) => Sentry.captureException(e));
  }, []);

  const register = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const existing = await Notifications.getPermissionsAsync();
      let final = existing;
      if (existing.status !== 'granted') {
        final = await Notifications.requestPermissionsAsync();
      }
      setPermission(final.status);
      setCanAskAgain(final.canAskAgain);
      // The UI shows the way forward (Open Settings), so a refusal is not an error.
      if (final.status !== 'granted') return;

      await ensureAndroidChannels();

      const { data: token } = await Notifications.getDevicePushTokenAsync();
      await api.post('/notifications/token', {
        token,
        platform: Platform.OS,
        deviceName: Device.deviceName ?? undefined,
      });
      await AsyncStorage.setItem(TOKEN_KEY, token);
      await AsyncStorage.removeItem(LOCAL_FESTIVAL_KEY);
      setRegistered(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't enable notifications. Try again.");
      throw err;
    } finally {
      setBusy(false);
    }
  }, []);

  const unregister = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const token = await AsyncStorage.getItem(TOKEN_KEY);
      if (token) {
        await api.delete('/notifications/token', { body: { token } });
        await AsyncStorage.removeItem(TOKEN_KEY);
        await AsyncStorage.removeItem(LOCAL_FESTIVAL_KEY);
      }
      setRegistered(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't disable notifications. Try again.");
      throw err;
    } finally {
      setBusy(false);
    }
  }, []);

  return { registered, permission, canAskAgain, busy, error, register, unregister };
}
