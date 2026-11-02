/**
 * Background live-location share (T41). While the store's shareIntent is a
 * `background` intent, a native location task posts each fix to the crew over
 * HTTP (the socket is closed whenever the app is backgrounded). The intent
 * lives only in memory: if the process dies the task stops itself on its next
 * wake, so no location state is ever persisted.
 *
 * Loaded from index.js after ./bootstrap: defineTask must run at module scope
 * at launch, and the shared stores must not hydrate before configureStorage.
 *
 * OTA safety: binaries before 1.5.0 have no ExpoTaskManager native module, and a
 * static import of expo-task-manager throws at launch there. The module is
 * required lazily behind requireOptionalNativeModule, and without it nothing
 * below the gate runs. notifyShareStopped needs only expo-notifications.
 */
import { requireOptionalNativeModule } from 'expo';
import * as Battery from 'expo-battery';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import type * as TaskManagerModule from 'expo-task-manager';
import { AppState } from 'react-native';
import { LIVE_LOCATION, LIVE_SHARE_COPY } from '@festie/shared/constants';
import { isTerminalLiveFixError, postLiveFix, stopLiveFix } from '@festie/shared/services';
import { useCrewStore, useFestivalDataStore, useLiveLocationStore } from '@festie/shared/stores';
import type { LiveShareEndReason } from '@festie/shared/stores';
import { decideBackgroundFix, fmtZonedClock, liveShareEndedText, resolveFestivalTimeZone } from '@festie/shared/utils';
import type { LatLng } from '@festie/shared/utils';

export const LIVE_SHARE_TASK = 'festie-live-share';

export const BACKGROUND_SHARE_AVAILABLE = requireOptionalNativeModule('ExpoTaskManager') != null;

let running: { crewId: string } | null = null;
let lastSentAt: number | null = null;
let lastSentCoord: LatLng | null = null;

async function stopNativeUpdates(): Promise<void> {
  try {
    if (await Location.hasStartedLocationUpdatesAsync(LIVE_SHARE_TASK)) {
      await Location.stopLocationUpdatesAsync(LIVE_SHARE_TASK);
    }
  } catch (err) {
    console.warn('[backgroundShare] stop failed', err);
  }
}

export async function notifyShareStopped(reason: LiveShareEndReason): Promise<void> {
  if (reason === 'user') return;
  try {
    if (!(await Notifications.getPermissionsAsync()).granted) return;
    await Notifications.scheduleNotificationAsync({
      content: { title: LIVE_SHARE_COPY.stoppedNoticeTitle, body: liveShareEndedText(reason) },
      trigger: null,
    });
  } catch (err) {
    console.warn('[backgroundShare] stop notice failed', err);
  }
}

async function readBattery(): Promise<{ battery?: number; lowPower?: boolean }> {
  let battery: number | undefined;
  let lowPower: boolean | undefined;
  try {
    const level = await Battery.getBatteryLevelAsync();
    if (level >= 0) battery = Math.round(level * 100);
  } catch {
    /* unreadable: omit */
  }
  try {
    lowPower = await Battery.isLowPowerModeEnabledAsync();
  } catch {
    /* unreadable: omit */
  }
  return { battery, lowPower };
}

async function startNativeUpdates(intent: { crewId: string; expiresAt: string }): Promise<void> {
  const crewName = useCrewStore.getState().activeCrew?.name ?? 'your crew';
  // Same zone as the disclosure and banner in CrewLiveLocation, so the notice shows the end time the user accepted.
  const timeZone = resolveFestivalTimeZone(useFestivalDataStore.getState().currentFestival);
  await Location.startLocationUpdatesAsync(LIVE_SHARE_TASK, {
    accuracy: Location.Accuracy.Balanced,
    timeInterval: LIVE_LOCATION.UPDATE_INTERVAL_MS,
    distanceInterval: 0,
    pausesUpdatesAutomatically: false,
    activityType: Location.ActivityType.Other,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: LIVE_SHARE_COPY.fgsTitle(crewName),
      notificationBody: LIVE_SHARE_COPY.fgsBody(fmtZonedClock(Date.parse(intent.expiresAt), timeZone)),
      notificationColor: '#00e8d0',
      killServiceOnDestroy: true,
    },
  });
}

function stopRunning(): void {
  if (!running) return;
  const { crewId } = running;
  running = null;
  void stopNativeUpdates();
  stopLiveFix(crewId).catch(console.warn);
}

function installBackgroundShare(): void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const TaskManager: typeof TaskManagerModule = require('expo-task-manager');
  TaskManager.defineTask<{ locations: Location.LocationObject[] }>(LIVE_SHARE_TASK, async ({ data, error }) => {
    if (error) {
      console.warn('[backgroundShare] task error', error);
      return;
    }
    const intent = useLiveLocationStore.getState().shareIntent;
    if (!intent || !intent.background || intent.paused) {
      await stopNativeUpdates();
      return;
    }
    const loc = data?.locations?.[data.locations.length - 1];
    if (!loc) return;
    const next: LatLng = { lat: loc.coords.latitude, lng: loc.coords.longitude };
    const decision = decideBackgroundFix(
      { expiresAtMs: Date.parse(intent.expiresAt), lastSentCoord, lastSentAt },
      next,
      Date.now(),
    );
    if (decision === 'expire') {
      useLiveLocationStore.getState().endShare('expired');
      return;
    }
    if (decision === 'skip') return;
    try {
      const { battery, lowPower } = intent.shareBattery ? await readBattery() : {};
      const { accuracy, heading, speed } = loc.coords;
      await postLiveFix(intent.crewId, {
        lat: next.lat,
        lng: next.lng,
        accuracy: accuracy ?? undefined,
        // The schema rejects negative values; expo reports -1 for "unknown".
        heading: heading != null && heading >= 0 ? heading : undefined,
        speed: speed != null && speed >= 0 ? speed : undefined,
        battery,
        lowPower,
        capturedAt: new Date(loc.timestamp).toISOString(),
        expiresAt: intent.expiresAt,
      });
      lastSentAt = Date.now();
      lastSentCoord = next;
    } catch (err) {
      if (isTerminalLiveFixError(err)) useLiveLocationStore.getState().endShare('rejected');
      else console.warn('[backgroundShare] fix failed', err);
    }
  });

  useLiveLocationStore.subscribe((state, prev) => {
    const intent = state.shareIntent;
    const want = intent?.background && !intent.paused ? intent : null;
    if (running && (!want || want.crewId !== running.crewId)) stopRunning();
    if (want && !running) {
      lastSentAt = null;
      lastSentCoord = null;
      running = { crewId: want.crewId };
      startNativeUpdates(want).catch((err) => {
        console.warn('[backgroundShare] start failed', err);
        running = null;
        useLiveLocationStore.getState().endShare('denied');
      });
    }
    if (
      prev.shareIntent?.background &&
      !intent &&
      state.shareEndedReason &&
      state.shareEndedReason !== 'user' &&
      AppState.currentState !== 'active'
    ) {
      void notifyShareStopped(state.shareEndedReason);
    }
  });

  // Clear a task a previous process left registered.
  const initial = useLiveLocationStore.getState().shareIntent;
  if (!initial?.background) void stopNativeUpdates();
}

if (BACKGROUND_SHARE_AVAILABLE) installBackgroundShare();
