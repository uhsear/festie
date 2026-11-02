// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * CrewLiveLocation — opt-in "Share my live location" control for the active crew.
 *
 * PRIVACY MODEL (see liveLocationStore header): OFF by default, explicit
 * per-session opt-in, scoped to ONE crew, fully ephemeral, and aggressively
 * auto-expiring. Foreground-only unless the sharer opts into keeping it going
 * while the phone is locked.
 *
 * This component only renders. The session lives in the shared liveLocationStore
 * (`shareIntent`) and runs in the app-wide LiveSharePublisher, so a tab or screen
 * change never stops it. Enabling requests foreground location permission (plus background, after a
 * disclosure, when the lock switch is on), then writes the intent with an absolute end time. A banner with Pause and Stop
 * stays visible while sharing, including while paused.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, Alert, Linking, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useCrewStore, useFestivalStore, useLiveLocationStore } from '@festie/shared/stores';
import { LIVE_SHARE_COPY } from '@festie/shared/constants';
import { useShareExplainer } from '@festie/shared/hooks';
import {
  formatCountdown,
  fmtZonedClock,
  liveShareEndedText,
  liveShareOptions,
  resolveFestivalTimeZone,
  type LiveShareOption,
} from '@festie/shared/utils';
import { useTokens, makeStyles, typeStyle, MAX_FONT_SCALE } from '../hooks/useTokens';
import AppSwitch from './AppSwitch';
import { useHaptics } from '../hooks/useHaptics';
import { useNow } from '../hooks/useNow';
import { BACKGROUND_SHARE_AVAILABLE } from '../lib/backgroundShare';

interface CrewLiveLocationProps {
  crewId: string;
}

export default function CrewLiveLocation({ crewId }: CrewLiveLocationProps) {
  const t = useTokens();
  const styles = useStyles();
  const haptics = useHaptics();

  const shareIntent = useLiveLocationStore((s) => s.shareIntent);
  const shareEndedReason = useLiveLocationStore((s) => s.shareEndedReason);
  const beginShare = useLiveLocationStore((s) => s.beginShare);
  const setSharePaused = useLiveLocationStore((s) => s.setSharePaused);
  const endShare = useLiveLocationStore((s) => s.endShare);
  const clearShareEnded = useLiveLocationStore((s) => s.clearShareEnded);
  const days = useFestivalStore((s) => s.days);
  const sets = useFestivalStore((s) => s.sets);
  const currentFestival = useFestivalStore((s) => s.currentFestival);
  const timeZone = resolveFestivalTimeZone(currentFestival);

  const sharing = shareIntent?.crewId === crewId;
  const paused = sharing && shareIntent.paused;
  const [busy, setBusy] = useState(false);
  // The opt-in duration sheet is open (picking a time-box before sharing starts).
  const [choosing, setChoosing] = useState(false);
  const explainer = useShareExplainer();
  // Battery is opt-in per session and never saved.
  const [shareBattery, setShareBattery] = useState(false);
  // Background sharing is opt-in per session and never remembered.
  const [keepLocked, setKeepLocked] = useState(false);
  const now = useNow(30_000);

  // Re-opt-in per crew: close the chooser when the crew changes (the store clears
  // the session itself on a crew switch).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- privacy-critical event-driven reset: close the chooser and clear the battery opt-in when the crew changes so nothing carries over.
    setChoosing(false);
    setShareBattery(false);
    setKeepLocked(false);
  }, [crewId]);

  const { options, defaultId } = useMemo(
    () => liveShareOptions({ days, sets, timeZone, nowMs: now }),
    [days, sets, timeZone, now],
  );

  // Pick a time-box → request permission → start the shared session.
  const startSharing = useCallback(
    async (option: LiveShareOption) => {
      if (busy) return;
      // Fixed at tap time so a slow permission flow does not shorten the share.
      const expiresAt = new Date(Date.now() + option.ms).toISOString();
      const startForeground = () => {
        beginShare(crewId, expiresAt, shareBattery, false);
        setChoosing(false);
        haptics.select();
      };
      const requestBackground = async () => {
        try {
          const bg = await Location.requestBackgroundPermissionsAsync();
          if (bg.granted) {
            beginShare(crewId, expiresAt, shareBattery, true);
            setChoosing(false);
            haptics.select();
            return;
          }
          Alert.alert(
            LIVE_SHARE_COPY.bgDeniedTitle,
            Platform.OS === 'ios' ? LIVE_SHARE_COPY.bgDeniedBodyIos : LIVE_SHARE_COPY.bgDeniedBodyAndroid,
            [
              { text: LIVE_SHARE_COPY.cancel, style: 'cancel' },
              { text: LIVE_SHARE_COPY.bgDeniedShareOpen, onPress: startForeground },
              { text: LIVE_SHARE_COPY.openSettings, onPress: () => void Linking.openSettings() },
            ],
          );
        } catch {
          Alert.alert('Location unavailable', "Couldn't start location sharing. Try again.");
        }
      };
      setBusy(true);
      try {
        const perm = await Location.requestForegroundPermissionsAsync();
        if (!perm.granted) {
          // canAskAgain === false means the OS won't re-prompt (permanently
          // denied / "Don't allow"); a "try again" here is a dead end, so route
          // the user to Settings instead. Otherwise the next attempt re-prompts.
          if (perm.canAskAgain === false) {
            Alert.alert(
              'Location permission needed',
              'Location is turned off for Festie. Open Settings to allow location access while using the app, then turn sharing back on.',
              [
                { text: 'Not now', style: 'cancel' },
                { text: 'Open Settings', onPress: () => void Linking.openSettings() },
              ],
            );
          } else {
            Alert.alert(
              'Location permission needed',
              'To share your live location with this crew, allow location access while using the app, then try again.',
            );
          }
          return;
        }
        if (!keepLocked) {
          startForeground();
          return;
        }
        const crewName = useCrewStore.getState().activeCrew?.name ?? 'your crew';
        Alert.alert(
          LIVE_SHARE_COPY.bgDisclosureTitle,
          LIVE_SHARE_COPY.bgDisclosureBody(crewName, fmtZonedClock(Date.parse(expiresAt), timeZone)),
          [
            { text: LIVE_SHARE_COPY.cancel, style: 'cancel' },
            { text: LIVE_SHARE_COPY.bgDisclosureContinue, onPress: () => void requestBackground() },
          ],
        );
      } catch {
        Alert.alert('Location unavailable', "Couldn't start location sharing. Try again.");
      } finally {
        setBusy(false);
      }
    },
    [busy, beginShare, crewId, shareBattery, keepLocked, timeZone, haptics],
  );

  const disableSharing = useCallback(() => {
    endShare('user');
    haptics.tap();
  }, [endShare, haptics]);

  // The Switch opens the duration sheet (sharing only starts once a time-box is
  // picked — value stays OFF until then); switching off cancels/stops.
  const onToggle = useCallback(
    (next: boolean) => {
      if (next) {
        clearShareEnded();
        setKeepLocked(false);
        setChoosing(true);
        haptics.tap();
      } else {
        setChoosing(false);
        disableSharing();
      }
    },
    [clearShareEnded, disableSharing, haptics],
  );

  const togglePause = useCallback(() => {
    setSharePaused(!paused);
    haptics.tap();
  }, [setSharePaused, paused, haptics]);

  const expiresMs = sharing ? Date.parse(shareIntent.expiresAt) : NaN;
  const sub = Number.isFinite(expiresMs)
    ? (paused ? LIVE_SHARE_COPY.pausedSub : LIVE_SHARE_COPY.sharingSub)(
        formatCountdown(expiresMs - now),
        fmtZonedClock(expiresMs, timeZone),
      )
    : null;
  const lockedSub = sharing
    ? shareIntent.background
      ? LIVE_SHARE_COPY.lockedOnSub
      : LIVE_SHARE_COPY.lockedOffSub
    : null;
  const notice =
    shareEndedReason === 'background' || shareEndedReason === 'low-power' ? liveShareEndedText(shareEndedReason) : null;

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <View style={styles.rowIcon}>
          <Ionicons name="navigate-circle-outline" size={20} color={t.colors.accent.aqua} />
        </View>
        <View style={styles.rowBody}>
          <Text style={styles.rowTitle}>{LIVE_SHARE_COPY.title}</Text>
          <Text style={styles.rowSub}>{LIVE_SHARE_COPY.ruleNative}</Text>
        </View>
        <AppSwitch
          value={sharing || choosing}
          onValueChange={onToggle}
          disabled={busy}
          accessibilityRole="switch"
          accessibilityLabel={LIVE_SHARE_COPY.switchA11y}
          accessibilityState={{ checked: sharing || choosing, disabled: busy }}
        />
      </View>

      {notice && !sharing && !choosing ? (
        <View style={styles.notice}>
          <Text style={styles.noticeText}>{notice}</Text>
          <TouchableOpacity
            onPress={clearShareEnded}
            style={styles.noticeDismiss}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Dismiss"
          >
            <Text style={styles.chooserCancelText}>Dismiss</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {/* Duration sheet — explicit opt-in time-box before any sharing starts. */}
      {choosing && !sharing ? (
        <View style={styles.chooser}>
          <Text style={styles.chooserTitle} accessibilityRole="header">
            {explainer.needed ? LIVE_SHARE_COPY.explainerTitle : LIVE_SHARE_COPY.chooserTitle}
          </Text>
          {explainer.needed ? (
            <>
              {LIVE_SHARE_COPY.explainerPoints.map((point) => (
                <Text key={point} style={styles.rowSub}>{`• ${point}`}</Text>
              ))}
              <TouchableOpacity
                onPress={explainer.markSeen}
                style={[styles.durationChip, styles.durationChipDefault]}
                activeOpacity={0.8}
                accessibilityRole="button"
              >
                <Text
                  style={[styles.durationChipText, styles.durationChipTextDefault]}
                  maxFontSizeMultiplier={MAX_FONT_SCALE}
                >
                  {LIVE_SHARE_COPY.explainerOk}
                </Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <View style={styles.batteryRow}>
                <View style={styles.rowBody}>
                  <Text style={styles.rowTitle}>{LIVE_SHARE_COPY.battery}</Text>
                  <Text style={styles.rowSub}>{LIVE_SHARE_COPY.batteryHint}</Text>
                </View>
                <AppSwitch
                  value={shareBattery}
                  onValueChange={setShareBattery}
                  accessibilityRole="switch"
                  accessibilityLabel={LIVE_SHARE_COPY.battery}
                  accessibilityState={{ checked: shareBattery }}
                />
              </View>
              {BACKGROUND_SHARE_AVAILABLE && (
                <View style={styles.batteryRow}>
                  <View style={styles.rowBody}>
                    <Text style={styles.rowTitle}>{LIVE_SHARE_COPY.keepLocked}</Text>
                    <Text style={styles.rowSub}>{LIVE_SHARE_COPY.keepLockedHint}</Text>
                  </View>
                  <AppSwitch
                    value={keepLocked}
                    onValueChange={setKeepLocked}
                    accessibilityRole="switch"
                    accessibilityLabel={LIVE_SHARE_COPY.keepLocked}
                    accessibilityState={{ checked: keepLocked }}
                  />
                </View>
              )}
              <View style={styles.chooserOptions}>
                {options.map((d) => {
                  const isDefault = d.id === defaultId;
                  return (
                    <TouchableOpacity
                      key={d.id}
                      onPress={() => startSharing(d)}
                      disabled={busy}
                      style={[styles.durationChip, isDefault && styles.durationChipDefault]}
                      activeOpacity={0.8}
                      accessibilityRole="button"
                      accessibilityLabel={`Share for ${d.label}`}
                    >
                      <Text
                        style={[styles.durationChipText, isDefault && styles.durationChipTextDefault]}
                        maxFontSizeMultiplier={MAX_FONT_SCALE}
                      >
                        {d.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </>
          )}
          <TouchableOpacity
            onPress={() => setChoosing(false)}
            style={styles.chooserCancel}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Cancel sharing"
          >
            <Text style={styles.chooserCancelText}>{LIVE_SHARE_COPY.cancel}</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {sharing ? (
        <View style={styles.banner}>
          <View style={[styles.bannerDot, paused && styles.bannerDotPaused]} />
          <View style={styles.bannerBody}>
            <Text
              style={styles.bannerText}
              accessibilityRole="alert"
              accessibilityLabel={
                sub
                  ? `${paused ? LIVE_SHARE_COPY.pausedTitle : LIVE_SHARE_COPY.sharingTitle}. ${sub}. ${lockedSub}`
                  : undefined
              }
            >
              {paused ? LIVE_SHARE_COPY.pausedTitle : LIVE_SHARE_COPY.sharingTitle}
            </Text>
            {sub ? <Text style={styles.bannerSub}>{sub}</Text> : null}
            {lockedSub ? <Text style={styles.bannerSub}>{lockedSub}</Text> : null}
          </View>
          <TouchableOpacity
            onPress={togglePause}
            style={styles.stopButton}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={paused ? LIVE_SHARE_COPY.resumeA11y : LIVE_SHARE_COPY.pauseA11y}
          >
            <Text style={styles.stopButtonText}>{paused ? LIVE_SHARE_COPY.resume : LIVE_SHARE_COPY.pause}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={disableSharing}
            style={styles.stopButton}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={LIVE_SHARE_COPY.stopA11y}
          >
            <Text style={styles.stopButtonText}>{LIVE_SHARE_COPY.stop}</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  wrap: {
    gap: t.spacing[2],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[3],
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[3],
    minHeight: 56,
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
  },
  rowIcon: {
    width: 28,
    alignItems: 'center',
  },
  rowBody: {
    flex: 1,
    gap: t.spacing[1],
  },
  rowTitle: {
    ...typeStyle('label'),
    color: t.colors.text.primary,
  },
  rowSub: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.accent.aqua,
    backgroundColor: t.colors.aquaAlpha[12],
  },
  bannerDot: {
    width: 10,
    height: 10,
    borderRadius: t.radii.pill,
    backgroundColor: t.colors.accent.aqua,
  },
  bannerDotPaused: {
    backgroundColor: t.colors.text.muted,
  },
  bannerBody: {
    flex: 1,
    gap: 2,
  },
  bannerText: {
    ...typeStyle('label'),
    color: t.colors.text.primary,
  },
  bannerSub: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  notice: {
    gap: t.spacing[1],
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[2],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
  },
  noticeText: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  noticeDismiss: {
    alignSelf: 'flex-start',
    minHeight: 44,
    justifyContent: 'center',
  },
  batteryRow: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[3],
  },
  chooser: {
    gap: t.spacing[2],
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
  },
  chooserTitle: {
    ...typeStyle('label'),
    color: t.colors.text.primary,
  },
  chooserOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: t.spacing[2],
  },
  durationChip: {
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[2],
    minHeight: 44,
    justifyContent: 'center',
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.primary,
  },
  durationChipDefault: {
    borderColor: t.colors.accent.aqua,
    backgroundColor: t.colors.aquaAlpha[12],
  },
  durationChipText: {
    ...typeStyle('label'),
    color: t.colors.text.secondary,
  },
  durationChipTextDefault: {
    color: t.colors.accent.aqua,
  },
  chooserCancel: {
    alignSelf: 'flex-start',
    paddingVertical: t.spacing[1],
    minHeight: 44,
    justifyContent: 'center',
  },
  chooserCancelText: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
  },
  stopButton: {
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[2],
    minHeight: 44,
    minWidth: 64,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.accent.aqua,
  },
  stopButtonText: {
    ...typeStyle('label'),
    color: t.colors.accent.aqua,
  },
}));
