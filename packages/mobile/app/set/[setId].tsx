import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Linking,
  Alert,
  Share,
  Image,
  BackHandler,
  AppState,
  Platform,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useFestivalDataStore, useAuthStore, useUIStore, useNotificationPrefsStore } from '@festie/shared/stores';
import {
  usePicks,
  usePickSync,
  useFestival,
  useCrew,
  useDebouncedNote,
  useSpotifyPreview,
  type NoteSaveStatus,
} from '@festie/shared/hooks';
import { api, mapErrorToUserMessage } from '@festie/shared/services';
import {
  formatSetWhen,
  reminderNoteSummary,
  primarySpotifyArtist,
  getSetStatus,
  artistDisplayName,
  artistSubtitle,
  getSetLinks,
  detectConflicts,
  hasSetStarted,
  buildSetUrl,
  resolveFestivalTimeZone,
  reminderDeliveryProblem,
  QUEUED_WRITE_MESSAGE,
  type ReminderPermission,
} from '@festie/shared/utils';
import type { Priority } from '@festie/shared/types';
import { useTokens, makeStyles, typeStyle, useLargeText, typeScaleCap, MAX_FONT_SCALE } from '../../hooks/useTokens';
import DisplayWords from '../../components/DisplayWords';
import { safeStageColor } from '../../lib/stageColor';
import { priorityColor } from '../../lib/priorityColor';
import { PRIORITY_SYMBOLS } from '@festie/shared/constants';
import { PRIORITY_BUTTONS, priorityIconName } from '../../lib/prioritySymbol';
import { useListBottomInset } from '../../hooks/useListBottomInset';
import { ensureStageTextContrast } from '../../lib/stageTextContrast';
import { useHaptics } from '../../hooks/useHaptics';
import { useNow } from '../../hooks/useNow';
import Button from '../../components/Button';
import EmptyState from '../../components/EmptyState';
import LoadingState from '../../components/LoadingState';
import RatingButtons from '../../components/RatingButtons';
import ClashPrompt from '../../components/ClashPrompt';

const REMINDER_ASK_DISMISSED_KEY = 'festie-reminder-ask-dismissed';

/** Soft ask before the first system permission prompt. The reminder is saved whatever the user picks. */
async function askNotificationPermission(artist: string): Promise<void> {
  try {
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'undetermined') return;
    if (await AsyncStorage.getItem(REMINDER_ASK_DISMISSED_KEY)) return;
    Alert.alert(
      `Get a heads-up before ${artist}?`,
      'Allow notifications so Festie can remind you before sets start, even when the app is closed.',
      [
        { text: 'Not now', style: 'cancel', onPress: () => void AsyncStorage.setItem(REMINDER_ASK_DISMISSED_KEY, '1') },
        { text: 'Allow', onPress: () => void Notifications.requestPermissionsAsync() },
      ],
    );
  } catch {
    // Best effort: the reminder is saved either way and the delivery line explains a missing permission.
  }
}

/** Reminder lead-time options (minutes) — must match the server's allowed set. */
const REMINDER_OPTIONS: readonly { value: number; label: string }[] = [
  { value: 5, label: '5m' },
  { value: 10, label: '10m' },
  { value: 15, label: '15m' },
  { value: 30, label: '30m' },
  { value: 60, label: '1h' },
];

/**
 * Non-color priority signal for the "Who's going" rows (F27). The dot already
 * carries the color; this adds the legible label + an icon so the tier survives
 * color-blindness and screen readers.
 */

/**
 * The mobile set-detail screen — an expo-router modal mirroring the web
 * DetailPanel. Looks the set up by id from the shared data store so it is
 * reload-safe (only the setId travels in the URL). Recomputes everything the
 * panel needs (pick, conflicts, crew, notes) from shared hooks/stores.
 */
export default function SetDetailScreen() {
  const t = useTokens();
  const largeText = useLargeText();
  const styles = useStyles();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // Bottom padding that clears the home indicator (F11 — this stack/modal
  // surface MUST include the inset per the useListBottomInset contract).
  const bottomPad = useListBottomInset();
  // Headerless modal: anchor the top affordances to the status-bar inset so the
  // drag handle / close / share clear the notch on Android and any full-screen
  // presentation. Inside an iOS formSheet the sheet already sits below the status bar.
  const topInset = Platform.OS === 'ios' ? t.spacing[3] : Math.max(t.spacing[3], insets.top);
  const { setId, listen } = useLocalSearchParams<{ setId: string; listen?: string }>();

  // Safe dismiss: on a cold deep link there is no back stack, so router.back()
  // would strand the user on a blank screen. Fall back to the home tab.
  const dismiss = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)');
    }
  }, [router]);

  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        dismiss();
        return true;
      });
      return () => subscription.remove();
    }, [dismiss]),
  );

  const sets = useFestivalDataStore((s) => s.sets);
  const currentFestival = useFestivalDataStore((s) => s.currentFestival);
  const nowMs = useNow(60_000);
  const currentFestivalId = useFestivalDataStore((s) => s.currentFestivalId);
  const selectFestival = useFestivalDataStore((s) => s.selectFestival);
  const currentProfile = useFestivalDataStore((s) => s.currentProfile);
  const allProfiles = useFestivalDataStore((s) => s.allProfiles);
  const loadProfiles = useFestivalDataStore((s) => s.loadProfiles);
  const days = useFestivalDataStore((s) => s.days);

  const { getMyPick, savePick, getOtherPicks, saveReminder, getMyReminder } = usePicks();
  const { getStageColor, getStageName } = useFestival();
  const { getCrewScopedOtherPicks } = useCrew();
  const haptics = useHaptics();

  const set = useMemo(() => sets.find((x) => x.id === setId), [sets, setId]);

  // Cold deep-link (festie.us/set/<id> or festie://set/<id>): the set isn't in
  // the store yet because its festival isn't loaded. Resolve which festival the
  // set belongs to, load it, and the set then appears. Runs once; on failure we
  // fall through to the "not found" state below.
  const [resolveFailed, setResolveFailed] = useState(false);
  const resolveTried = useRef(false);
  useEffect(() => {
    if (set || resolveTried.current || !setId) return;
    resolveTried.current = true;
    (async () => {
      try {
        const { festivalId } = await api.get<{ festivalId: string }>(`/festivals/locate-set/${setId}`);
        if (festivalId && festivalId !== currentFestivalId) {
          await selectFestival(festivalId);
        }
        if (!useFestivalDataStore.getState().sets.some((x) => x.id === setId)) {
          setResolveFailed(true);
        }
      } catch {
        setResolveFailed(true);
      }
    })();
  }, [set, setId, currentFestivalId, selectFestival]);

  const b2bSeparator = currentFestival?.b2bSeparator;

  // ---- Derived display data (only computed when the set exists). ----------
  const artistName = set ? artistDisplayName(set, b2bSeparator) : '';
  const artistPhoto = set?.artists?.find((a) => a.photo)?.photo;

  // Share the public universal link to this set (mirrors web's /set/$setId
  // route). festie.us is the registered universal-link host (app.json) and the
  // festie:// scheme also resolves set/<id>, so the link deep-links into the app
  // when installed and falls back to the web page otherwise.
  const shareUrl = useMemo(() => (set ? buildSetUrl(set.id) : ''), [set]);
  // Narrow dep (currentFestival?.name, not the whole object) is deliberate so the
  // share handler only re-creates when the displayed name changes. React Compiler
  // is not enabled here, so keep the manual memo and suppress its readiness warning.
  // eslint-disable-next-line react-hooks/preserve-manual-memoization -- intentional narrower deps
  const handleShare = useCallback(async () => {
    if (!set) return;
    try {
      await Share.share({
        message: `${artistName} at ${currentFestival?.name ?? 'the festival'} — ${shareUrl}`,
        url: shareUrl,
        title: artistName,
      });
    } catch {
      // User dismissed the share sheet — not an error worth surfacing.
    }
  }, [set, artistName, currentFestival?.name, shareUrl]);
  const subtitle = set ? artistSubtitle(set, b2bSeparator) : '';
  const stageName = set ? getStageName(set.stageId) || 'Unknown' : 'Unknown';
  const stageColor = safeStageColor(set ? getStageColor(set.stageId) : undefined, t.colors.text.muted);
  // F26: server stage colors carry no AA guarantee as TEXT. Move the hue's
  // luminance away from the background until the label reaches ~4.6:1 (lighter on
  // Stage, darker on Daylight). The pill FILL keeps the raw stageColor at 15%
  // alpha (decorative, not text).
  const stageTextColor = useMemo(
    () => ensureStageTextContrast(stageColor, t.colors.bg.primary),
    [stageColor, t.colors.bg.primary],
  );
  const timeZone = resolveFestivalTimeZone(currentFestival);
  const status = set ? getSetStatus(set, new Date(nowMs), days, timeZone) : null;
  const whenLine = set ? formatSetWhen(set, days, status) : '';
  const myPick = set ? getMyPick(set.id) : undefined;
  const myReminder = set ? getMyReminder(set.id) : undefined;

  const allGenres = useMemo(() => [...new Set((set?.artists || []).flatMap((a) => a.genres || []))].slice(0, 6), [set]);

  const artistLinks = useMemo(() => (set ? getSetLinks(set) : []), [set]);

  // Conflicts: other picked sets whose times overlap this one (web parity).
  const conflicts = useMemo(() => {
    if (!set || !currentProfile) return [];
    const detected = detectConflicts(sets, (id: string) => {
      const val = currentProfile.picks?.[id];
      return (val as Priority) || null;
    });
    return detected
      .filter((c) => c.setA.id === set.id || c.setB.id === set.id)
      .map((c) => (c.setA.id === set.id ? c.setB : c.setA));
  }, [sets, currentProfile, set]);

  // Crew / who's going.
  const others = useMemo(() => {
    if (!set || !currentProfile) return [];
    const raw = getCrewScopedOtherPicks(set.id);
    const scoped = raw.length > 0 ? raw : getOtherPicks(set.id);
    return scoped.map((o) => {
      const profile = allProfiles.find((p) => p.id === o.profileId);
      return {
        profileId: o.profileId,
        priority: o.priority,
        name: profile?.name || 'Unknown',
      };
    });
  }, [set, currentProfile, getCrewScopedOtherPicks, getOtherPicks, allProfiles]);

  const whoTitle = others.length > 0 ? `Who's Going (${others.length})` : 'Nobody else going yet';

  const crewNotes = useMemo(() => {
    if (!set) return [];
    return allProfiles
      .filter((p) => p.id !== currentProfile?.id && p.notes?.['crew:' + set.id])
      .map((p) => ({
        name: p.name || 'Unknown',
        note: p.notes['crew:' + set.id]!,
      }));
  }, [allProfiles, currentProfile?.id, set]);

  // ---- Notes (debounced save; flushed on unmount so closing the sheet keeps the text). ----
  const personal = useDebouncedNote({
    festivalId: currentFestival?.id,
    profileId: currentProfile?.id,
    noteKey: set?.id ?? '',
    initialValue: currentProfile?.notes?.[set?.id ?? ''] || '',
    onError: () => haptics.warning(),
  });
  const crew = useDebouncedNote({
    festivalId: currentFestival?.id,
    profileId: currentProfile?.id,
    noteKey: 'crew:' + (set?.id ?? ''),
    initialValue: currentProfile?.notes?.['crew:' + (set?.id ?? '')] || '',
    onError: () => haptics.warning(),
  });

  const canRemind = !!set?.startTime && !(set && currentFestival && hasSetStarted(set, currentFestival, days));
  const reminderSummary = reminderNoteSummary(myReminder, !!personal.value, canRemind);
  // ---- Reminder delivery (OS permission + Account preference). ----
  // 'undetermined', and 'denied' while the OS can still ask, count as 'default' (not enabled yet).
  const [permission, setPermission] = useState<ReminderPermission>('granted');
  const setRemindersPref = useNotificationPrefsStore((s) => s.prefs.setReminders);
  const readPermission = useCallback(() => {
    Notifications.getPermissionsAsync()
      .then((p) =>
        setPermission(
          p.status === 'granted'
            ? 'granted'
            : p.status === 'denied' && !p.canAskAgain
              ? 'denied'
              : 'default',
        ),
      )
      .catch(() => {});
  }, []);
  useEffect(() => {
    const read = readPermission;
    read();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') read();
    });
    return () => sub.remove();
  }, [readPermission]);
  const turnOnNotifications = useCallback(() => {
    Notifications.requestPermissionsAsync()
      .catch(() => {})
      .finally(readPermission);
  }, [readPermission]);
  const deliveryProblem = reminderDeliveryProblem({
    hasReminder: myReminder != null,
    permission,
    setRemindersPref,
  });
  const { sync: pickSync, retry: retryPick } = usePickSync(set?.id ?? '');

  // ---- Spotify preview (shared hook; rendered inline via WebView). ----
  const { status: spotifyStatus, preview } = useSpotifyPreview(set?.id);
  const spotifyArtist = set ? primarySpotifyArtist(set) : null;
  const embedUrl = preview?.embedUrl;
  const [spotifyOpen, setSpotifyOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  // Opened from a card's Listen button: open the player once it is ready.
  const listenHandled = useRef(false);
  useEffect(() => {
    if (listen === '1' && spotifyStatus === 'ready' && !listenHandled.current) {
      listenHandled.current = true;
      setSpotifyOpen(true);
    }
  }, [listen, spotifyStatus]);

  // ---- Actions. ------------------------------------------------------------
  const handlePriority = useCallback(
    (priority: Priority | null) => {
      if (!set || !currentFestival) return;
      // F34: selection haptic, matching SetCardMobile's priority toggle and the
      // reminder chips below — the same gesture class should always buzz.
      haptics.select();
      savePick(currentFestival.id, set.id, priority).catch((err) => {
        haptics.warning();
        useUIStore.getState().showToast(mapErrorToUserMessage(err, "Couldn't save your pick. Try again."), { kind: 'error' });
      });
    },
    [set, currentFestival, savePick, haptics],
  );

  // A failed reminder save shows inline: on iOS the root toast sits behind this native sheet.
  const [reminderFailed, setReminderFailed] = useState<{ minutes: number | null } | null>(null);
  const handleReminder = useCallback(
    (minutes: number | null) => {
      if (!set || !currentFestival) return;
      haptics.select();
      setReminderFailed(null);
      if (minutes != null) void askNotificationPermission(artistName || 'this set');
      saveReminder(currentFestival.id, set.id, minutes).catch((err) => {
        haptics.warning();
        setReminderFailed({ minutes });
        useUIStore.getState().showToast(mapErrorToUserMessage(err, "Couldn't save your reminder. Try again."), { kind: 'error' });
      });
    },
    [set, currentFestival, saveReminder, haptics, artistName],
  );

  // Clash-prompt clear — demote one side of a clash to null. savePick is
  // offline-queued, so resolving a clash works on dead signal.
  const handleClashClear = useCallback(
    (clearSetId: string) => {
      if (!currentFestival) return;
      haptics.select();
      savePick(currentFestival.id, clearSetId, null).catch((err) => {
        haptics.warning();
        useUIStore.getState().showToast(mapErrorToUserMessage(err, "Couldn't clear your pick. Try again."), { kind: 'error' });
      });
    },
    [currentFestival, savePick, haptics],
  );

  const user = useAuthStore((s) => s.user);
  const [joinBusy, setJoinBusy] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const handleJoin = useCallback(async () => {
    if (!currentFestival) return;
    // A guest has no account yet — send them to sign in first. After auth they
    // land back on the tabs and can re-open the set to join.
    if (!user) {
      router.push('/(auth)/login');
      return;
    }
    setJoinBusy(true);
    setJoinError(null);
    try {
      await api.post('/profiles', { festivalId: currentFestival.id });
      await loadProfiles(currentFestival.id);
    } catch (err) {
      // The store does NOT surface this failure (loadProfiles is never called
      // when the join itself rejects), so map and show it here — mirrors web's
      // DetailPanel handleJoinFestival catch (toast on join failure).
      setJoinError(mapErrorToUserMessage(err, "Couldn't join festival. Try again."));
    } finally {
      setJoinBusy(false);
    }
  }, [currentFestival, user, router, loadProfiles]);

  const openLink = useCallback((url: string) => {
    Linking.openURL(url).catch(() => {});
  }, []);

  // ---- Reload-safe guard: the set isn't in the store (cold open / deep link).
  if (!set) {
    // Still resolving the deep link's festival — show a spinner, not "not found".
    // DC24: use the shared LoadingState component (indeterminate resolve = spinner
    // rule) instead of a raw ActivityIndicator so the deep-link path matches the
    // design system.
    if (!resolveFailed) {
      return (
        <View style={[styles.container, styles.loadingContainer]}>
          <CloseButton onPress={dismiss} style={[styles.floatingClose, { top: topInset }]} />
          <LoadingState />
        </View>
      );
    }
    return (
      <View style={styles.container}>
        <CloseButton onPress={dismiss} style={[styles.floatingClose, { top: topInset }]} />
        <EmptyState
          icon="alert-circle-outline"
          title="Set not found"
          message="This set isn't loaded. Go back to the schedule and open it again."
          action={{ label: 'Back to schedule', onPress: dismiss }}
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Faux drag handle removed — the native formSheet (SDK 56) renders a real
          grabber (sheetGrabberVisible). Share and close sit in their own header
          row, not floating over the content: absolutely positioned, they covered
          the stage pill (iOS adds the sheet's top inset) and the artist photo. */}
      <View style={[styles.headerBar, { paddingTop: topInset }]}>
        <TouchableOpacity
          style={styles.headerButton}
          onPress={handleShare}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Share set"
          hitSlop={8}
        >
          <Ionicons name="share-outline" size={20} color={t.colors.text.secondary} />
        </TouchableOpacity>
        <CloseButton onPress={dismiss} />
      </View>

      {/* F1/F15: keyboard avoidance for the note inputs at the sheet bottom.
          NO KeyboardAvoidingView here — behavior="padding" inside an iOS
          formSheet miscomputes the keyboard frame against the sheet's detent
          and collapses the content to zero height (the "blank sheet" bug).
          automaticallyAdjustKeyboardInsets (iOS) + the Android window-resize
          default cover the keyboard without it; interactive dismiss keeps the
          active input visible while typing. */}
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: bottomPad }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        automaticallyAdjustKeyboardInsets
        showsVerticalScrollIndicator={false}
      >
        {/* Stage pill */}
        <View style={[styles.stagePill, { backgroundColor: stageColor + '25' }]}>
          <Text style={[styles.stageText, { color: stageTextColor }]} numberOfLines={1}>
            {stageName}
          </Text>
        </View>

        {/* Artist header: small avatar beside the name keeps the pick buttons in the half-height detent. */}
        <View style={styles.artistRow}>
          {artistPhoto && !largeText ? (
            <Image
              source={{ uri: artistPhoto }}
              style={styles.artistAvatar}
              resizeMode="cover"
              accessibilityIgnoresInvertColors
            />
          ) : null}
          <View style={styles.artistText}>
            <Text style={styles.artist} accessibilityRole="header" maxFontSizeMultiplier={typeScaleCap('display-lg')}>
              <DisplayWords text={artistName} fontSize={styles.artist.fontSize} />
            </Text>
            {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
          </View>
        </View>
        <Text style={styles.time}>{whenLine}</Text>

        {/* Priority picker / Join CTA */}
        {currentProfile ? (
          <>
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Your pick</Text>
              <View style={styles.priorityRow}>
                {PRIORITY_BUTTONS.map((option) => {
                  const active = myPick === option.value;
                  const accent = priorityColor(t, option.value);
                  const pending = pickSync?.state === 'saving' || pickSync?.state === 'queued';
                  return (
                    <TouchableOpacity
                      key={option.value}
                      style={[styles.priorityButton, active && { backgroundColor: accent, borderColor: accent }]}
                      onPress={() => handlePriority(active ? null : option.value)}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      accessibilityLabel={
                        active && pending
                          ? `${option.label}, ${pickSync?.state === 'queued' ? 'waiting to sync' : 'saving'}`
                          : option.label
                      }
                    >
                      <Ionicons
                        name={option.icon}
                        size={16}
                        color={active ? t.colors.text.onLightAccent : t.colors.text.muted}
                      />
                      {active && pending ? (
                        <Ionicons name="time-outline" size={14} color={t.colors.text.onLightAccent} />
                      ) : null}
                      <Text
                        style={[styles.priorityText, active && { color: t.colors.text.onLightAccent }]}
                        maxFontSizeMultiplier={MAX_FONT_SCALE}
                      >
                        {option.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              {pickSync?.state === 'failed' ? (
                <View style={styles.statusRow} accessibilityLiveRegion="polite">
                  <Text style={styles.statusWarn}>Pick not saved.</Text>
                  <TouchableOpacity
                    style={styles.statusAction}
                    onPress={() => retryPick().catch(() => {})}
                    accessibilityRole="button"
                    accessibilityLabel="Retry saving pick"
                  >
                    <Text style={styles.statusActionText}>Retry</Text>
                  </TouchableOpacity>
                </View>
              ) : null}
            </View>
            <View style={styles.section}>
              <TouchableOpacity
                style={styles.panelButton}
                onPress={() => setNoteOpen((v) => !v)}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityState={{ expanded: noteOpen }}
                accessibilityLabel={`Reminder and note: ${reminderSummary}`}
              >
                <Ionicons name="notifications-outline" size={16} color={t.colors.accent.aqua} />
                <Text style={styles.spotifyText} numberOfLines={1}>
                  {reminderSummary}
                </Text>
                <Ionicons name={noteOpen ? 'chevron-up' : 'chevron-down'} size={16} color={t.colors.text.secondary} />
              </TouchableOpacity>
              {noteOpen ? (
                <>
                  {canRemind ? (
                    <>
              <View style={styles.reminderRow}>
                {REMINDER_OPTIONS.map((opt) => {
                  const active = myReminder === opt.value;
                  return (
                    <TouchableOpacity
                      key={opt.value}
                      style={[
                        styles.reminderChip,
                        active && {
                          backgroundColor: t.colors.accent.aqua,
                          borderColor: t.colors.accent.aqua,
                        },
                      ]}
                      onPress={() => handleReminder(active ? null : opt.value)}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      accessibilityLabel={
                        active ? `Reminder set ${opt.label} before, tap to clear` : `Remind me ${opt.label} before`
                      }
                    >
                      <Text
                        style={[styles.priorityText, active && { color: t.colors.text.onLightAccent }]}
                        maxFontSizeMultiplier={MAX_FONT_SCALE}
                      >
                        {opt.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              {reminderFailed ? (
                <View style={styles.statusRow} accessibilityLiveRegion="polite">
                  <Text style={styles.statusWarn}>Reminder not saved.</Text>
                  <TouchableOpacity
                    style={styles.statusAction}
                    onPress={() => handleReminder(reminderFailed.minutes)}
                    accessibilityRole="button"
                    accessibilityLabel="Retry saving reminder"
                  >
                    <Text style={styles.statusActionText}>Retry</Text>
                  </TouchableOpacity>
                </View>
              ) : null}
              {deliveryProblem === 'not-enabled' ? (
                <View style={styles.statusRow} accessibilityLiveRegion="polite">
                  <Text style={styles.statusWarn}>Notifications are off, so this reminder can't reach you.</Text>
                  <TouchableOpacity style={styles.statusAction} onPress={turnOnNotifications} accessibilityRole="button">
                    <Text style={styles.statusActionText}>Turn on</Text>
                  </TouchableOpacity>
                </View>
              ) : null}
              {deliveryProblem === 'denied' || deliveryProblem === 'pref-off' ? (
                <View style={styles.statusRow} accessibilityLiveRegion="polite">
                  <Text style={styles.statusWarn}>
                    {deliveryProblem === 'denied'
                      ? "Notifications are off for Festie, so this reminder can't reach you."
                      : 'Set reminders are turned off in Account.'}
                  </Text>
                  <TouchableOpacity
                    style={styles.statusAction}
                    onPress={() =>
                      deliveryProblem === 'denied' ? Linking.openSettings() : router.push('/(tabs)/account')
                    }
                    accessibilityRole="button"
                  >
                    <Text style={styles.statusActionText}>
                      {deliveryProblem === 'denied' ? 'Open settings' : 'Open Account'}
                    </Text>
                  </TouchableOpacity>
                </View>
              ) : null}
                    </>
                  ) : null}
                  <Text style={styles.sectionLabel}>Your note</Text>
                  <TextInput
                    style={styles.noteInput}
                    value={personal.value}
                    onChangeText={personal.setValue}
                    placeholder='Private note, e.g. "meet at the rail"'
                    placeholderTextColor={t.colors.text.placeholder}
                    multiline
                    accessibilityLabel="Personal note"
                  />
                  <NoteStatus status={personal.status} onRetry={personal.retry} />
                </>
              ) : null}
            </View>
          </>
        ) : (
          <View style={styles.joinBox}>
            <Text style={styles.joinCopy}>
              {user
                ? 'Join this festival to save picks, keep private notes, and compare crew overlap.'
                : 'Sign in to save picks, keep private notes, and compare crew overlap.'}
            </Text>
            {joinError ? (
              <Text style={styles.joinErrorText} accessibilityRole="alert" accessibilityLiveRegion="assertive">
                {joinError}
              </Text>
            ) : null}
            <Button
              label={user ? 'Join Festival' : 'Sign in to join'}
              onPress={handleJoin}
              loading={joinBusy}
              accessibilityLabel={user ? 'Join festival' : 'Sign in to join'}
            />
          </View>
        )}

        {/* Listen: one Spotify entry point. The links row skips this artist's Spotify link. */}
        {spotifyArtist ? (
          <View style={styles.spotifySection}>
            {spotifyStatus === 'ready' || spotifyStatus === 'loading' ? (
              <TouchableOpacity
                style={styles.spotifyButton}
                onPress={() => setSpotifyOpen((v) => !v)}
                disabled={spotifyStatus === 'loading'}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityState={{ expanded: spotifyOpen, disabled: spotifyStatus === 'loading' }}
                accessibilityLabel={spotifyOpen ? 'Hide player' : `Listen to ${preview?.artistName ?? spotifyArtist.name}`}
              >
                <Ionicons name="musical-note" size={16} color={t.colors.accent.aqua} />
                <Text style={styles.spotifyText} numberOfLines={1}>
                  Listen
                  {preview?.trackName ? <Text style={styles.spotifyTrack}>{`  ${preview.trackName}`}</Text> : null}
                </Text>
                <Ionicons name={spotifyOpen ? 'chevron-up' : 'chevron-down'} size={16} color={t.colors.text.secondary} />
              </TouchableOpacity>
            ) : null}
            {spotifyStatus === 'offline' ? <Text style={styles.statusText}>Listening needs signal.</Text> : null}
            {spotifyOpen && spotifyStatus === 'ready' && embedUrl ? (
              <View style={[styles.spotifyEmbed, { height: preview?.embedType === 'track' ? 152 : 352 }]}>
                <WebView
                  source={{ uri: embedUrl }}
                  style={styles.spotifyWebView}
                  allowsInlineMediaPlayback
                  mediaPlaybackRequiresUserAction={false}
                  originWhitelist={['https://open.spotify.com', 'https://*.spotify.com']}
                  onShouldStartLoadWithRequest={(req) => {
                    // Default-DENY: only the embed itself + in-frame Spotify
                    // resource loads stay in the WebView. User clicks (Spotify
                    // or not) open externally; any other origin is blocked so a
                    // hijacked iframe can't navigate the WebView off-Spotify.
                    if (req.url === embedUrl) return true;
                    let host = '';
                    try {
                      host = new URL(req.url).hostname;
                    } catch {
                      return false;
                    }
                    const isSpotify = /(^|\.)(spotify\.com|scdn\.co|spotifycdn\.com)$/.test(host);
                    if (req.navigationType === 'click') {
                      // Top-level user navigation → hand off to the OS.
                      openLink(req.url);
                      return false;
                    }
                    // Non-click (iframe/resource): allow only Spotify hosts.
                    return isSpotify;
                  }}
                />
              </View>
            ) : null}
            {spotifyStatus !== 'loading' && (spotifyStatus !== 'ready' || spotifyOpen) ? (
              <TouchableOpacity
                style={styles.linkButton}
                onPress={() => openLink(spotifyArtist.url)}
                activeOpacity={0.7}
                accessibilityRole="link"
                accessibilityLabel={`Open ${spotifyArtist.name} in Spotify`}
              >
                <Ionicons name="open-outline" size={t.iconSize.compact} color={t.colors.accent.aqua} />
                <Text style={styles.linkText}>Open in Spotify</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}

        {/* Single conflict card (DC3 Option A). ClashPrompt IS the merged
              card — it names both acts and offers per-pair Keep/Switch actions
              ("Keep {other}" clears the current pick = a Switch). The passive
              "N scheduling conflicts" box that used to sit below was the
              duplicate coral surface and has been removed. */}
        {currentProfile && conflicts.length > 0 ? (
          <ClashPrompt
            currentSet={set}
            conflicts={conflicts}
            b2bSeparator={b2bSeparator}
            getPriority={getMyPick}
            onClear={handleClashClear}
          />
        ) : null}

        {/* Ratings — only once the set has started (web parity). */}
        {currentProfile && currentFestival && hasSetStarted(set, currentFestival, days) ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Rate this set</Text>
            <RatingButtons setId={set.id} festivalId={currentFestival.id} />
          </View>
        ) : null}

        {/* Genres */}
        {allGenres.length > 0 ? (
          <View style={styles.chipRow}>
            {allGenres.map((g) => (
              <View key={g} style={styles.chip}>
                <Text style={styles.chipText}>{g}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {/* Artist links */}
        {artistLinks.length > 0 ? (
          <View style={styles.linkRow}>
            {artistLinks.flatMap((entry) =>
              Object.entries(entry.links)
                .filter(([key, url]) => !(key === 'spotify' && url === spotifyArtist?.url))
                .map(([key, url]) => (
                <TouchableOpacity
                  key={`${entry.name}-${key}`}
                  style={styles.linkButton}
                  onPress={() => openLink(url)}
                  activeOpacity={0.7}
                  accessibilityRole="link"
                  accessibilityLabel={`Open ${entry.name} on ${key}`}
                >
                  <Ionicons name="open-outline" size={t.iconSize.compact} color={t.colors.accent.aqua} />
                  <Text style={styles.linkText}>{key}</Text>
                </TouchableOpacity>
              )),
            )}
          </View>
        ) : null}

        {/* Who's going */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>{whoTitle}</Text>
          {others.map((o) => {
            // F27: the priority tier must not be color-only. The dot keeps the
            // color; a label + matching icon carry the same signal for
            // color-blind users, and the row exposes it to screen readers.
            const meta = { label: PRIORITY_SYMBOLS[o.priority].short, icon: priorityIconName(o.priority) };
            return (
              <View key={o.profileId} style={styles.crewRow} accessible accessibilityLabel={`${o.name}, ${meta.label}`}>
                <View style={[styles.crewDot, { backgroundColor: priorityColor(t, o.priority) }]} />
                <Text style={styles.crewName} numberOfLines={1}>
                  {o.name}
                </Text>
                <Ionicons name={meta.icon} size={12} color={t.colors.text.muted} />
                <Text style={styles.crewPriority}>{meta.label}</Text>
              </View>
            );
          })}
          {crewNotes.map((n, i) => (
            <View key={`note-${i}`} style={styles.crewNoteRow}>
              <Text style={styles.crewNoteName}>{n.name}</Text>
              <Text style={styles.crewNoteText}>{n.note}</Text>
            </View>
          ))}
        </View>

        {/* Crew note */}
        {currentProfile ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Crew note (your crew sees this)</Text>
            <TextInput
              style={styles.noteInput}
              value={crew.value}
              onChangeText={crew.setValue}
              placeholder="Share a note with your crew…"
              placeholderTextColor={t.colors.text.placeholder}
              multiline
              accessibilityLabel="Crew note"
            />
            <NoteStatus status={crew.status} onRetry={crew.retry} />
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

/** Save-state line under a note input. Renders nothing while idle. */
function NoteStatus({ status, onRetry }: { status: NoteSaveStatus; onRetry: () => void }) {
  const styles = useStyles();
  if (status === 'idle') return null;
  if (status === 'failed') {
    return (
      <View style={styles.statusRow} accessibilityLiveRegion="polite">
        <Text style={styles.statusWarn}>Not saved.</Text>
        <TouchableOpacity
          style={styles.statusAction}
          onPress={onRetry}
          accessibilityRole="button"
          accessibilityLabel="Retry saving note"
        >
          <Text style={styles.statusActionText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }
  const text = status === 'saving' ? 'Saving…' : status === 'queued' ? QUEUED_WRITE_MESSAGE : 'Saved';
  return (
    <Text style={styles.statusText} accessibilityLiveRegion="polite">
      {text}
    </Text>
  );
}

/** Close affordance for the modal header. */
function CloseButton({ onPress, style }: { onPress: () => void; style?: StyleProp<ViewStyle> }) {
  const t = useTokens();
  const styles = useStyles();
  return (
    <TouchableOpacity
      style={[styles.headerButton, style]}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel="Close detail"
      hitSlop={8}
    >
      <Ionicons name="close" size={t.iconSize.md} color={t.colors.text.secondary} />
    </TouchableOpacity>
  );
}

const useStyles = makeStyles((t) => ({
  // R4: glass sheet surface — bg.elevated + 24px top-corner radii +
  // 1px glass.border + inset top highlight hairline.
  // RN has no backdrop-filter; the translucent surface + top-highlight
  // hairline approximate the glass edge without blur (platform limitation).
  container: {
    flex: 1,
    backgroundColor: t.colors.bg.elevated,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderColor: t.colors.glass.border,
    // Top-highlight: a brighter top border edge simulates the glass inset.
    // We use borderTopColor to distinguish the top edge from the sides.
    borderTopColor: t.colors.border.light,
    overflow: 'hidden',
  },
  loadingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Header row above the scroll body: share left, close right. In normal flow,
  // so it can never overlap the stage pill or the artist photo.
  headerBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: t.spacing[4],
    paddingBottom: t.spacing[2],
  },
  headerButton: {
    width: 44,
    height: 44,
    borderRadius: t.radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.colors.bg.secondary,
    borderWidth: 1,
    borderColor: t.colors.border.default,
  },
  // Loading / not-found states have no header row; close floats top-right.
  floatingClose: {
    position: 'absolute',
    right: t.spacing[4],
    zIndex: 10,
  },
  content: {
    padding: t.spacing[5],
    paddingTop: t.spacing[2],
    // paddingBottom is applied at the call site via useListBottomInset (F11) so
    // the last input clears the home indicator on notched iPhones.
    gap: t.spacing[3],
  },
  artistRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[3],
  },
  artistAvatar: {
    width: 64,
    height: 64,
    borderRadius: t.radii.pill,
    backgroundColor: t.colors.bg.secondary,
  },
  artistText: {
    flex: 1,
  },
  stagePill: {
    alignSelf: 'flex-start',
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[1],
    borderRadius: t.radii.pill,
  },
  stageText: {
    ...typeStyle('micro'),
  },
  artist: {
    ...typeStyle('display-lg'),
    color: t.colors.text.primary,
  },
  subtitle: {
    ...typeStyle('body'),
    color: t.colors.text.muted,
  },
  time: {
    ...typeStyle('body'),
    color: t.colors.text.secondary,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: t.spacing[2],
  },
  chip: {
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[1],
    borderRadius: t.radii.pill,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
  },
  chipText: {
    ...typeStyle('micro'),
    color: t.colors.text.secondary,
  },
  linkRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: t.spacing[2],
  },
  linkButton: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[1],
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[2],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.accent.aqua,
  },
  linkText: {
    ...typeStyle('label'),
    color: t.colors.accent.aqua,
    textTransform: 'capitalize',
  },
  spotifySection: {
    gap: t.spacing[2],
  },
  spotifyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    paddingHorizontal: t.spacing[4],
    paddingVertical: t.spacing[3],
    borderRadius: t.radii.pill,
    borderWidth: 1,
    borderColor: t.colors.border.light,
    backgroundColor: t.colors.bg.card,
  },
  spotifyText: {
    ...typeStyle('label'),
    color: t.colors.text.primary,
    flex: 1,
  },
  spotifyTrack: {
    ...typeStyle('label'),
    color: t.colors.text.muted,
  },
  panelButton: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    paddingHorizontal: t.spacing[4],
    paddingVertical: t.spacing[3],
    borderRadius: t.radii.pill,
    borderWidth: 1,
    borderColor: t.colors.border.light,
    backgroundColor: t.colors.bg.card,
  },
  spotifyEmbed: {
    borderRadius: t.radii.default,
    overflow: 'hidden',
  },
  spotifyWebView: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  section: {
    gap: t.spacing[2],
    marginTop: t.spacing[1],
  },
  sectionLabel: {
    ...typeStyle('label'),
    color: t.colors.text.secondary,
  },
  priorityRow: {
    flexDirection: 'row',
    gap: t.spacing[2],
  },
  // Reminder chips: wrap to a second line instead of cramming all five across
  // one cramped row. Each chip sizes to its label (no flex:1) and keeps a 44pt
  // touch target.
  reminderRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: t.spacing[2],
  },
  reminderChip: {
    minWidth: 56,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: t.spacing[4],
    paddingVertical: t.spacing[2],
    borderRadius: t.radii.pill,
    backgroundColor: t.colors.overlay[3],
    borderWidth: 1,
    borderColor: t.colors.border.light,
  },
  priorityButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: t.spacing[1],
    // WCAG 2.5.5 / 2.5.8 minimum 44pt touch target.
    minHeight: 44,
    paddingHorizontal: t.spacing[2],
    paddingVertical: t.spacing[3],
    borderRadius: t.radii.pill,
    backgroundColor: t.colors.overlay[3],
    borderWidth: 1,
    borderColor: t.colors.border.light,
  },
  priorityText: {
    // Bumped from the 10px micro role to 12px (caption) for legibility — the
    // 10px picker labels were too small to read comfortably. Weight 500 is
    // passed into typeStyle so the correct SpaceGrotesk_500Medium cut is
    // selected on native (a post-spread fontWeight override is inert there).
    ...typeStyle('caption', 500),
    color: t.colors.text.muted,
    textAlign: 'center',
    flexShrink: 1,
  },
  joinBox: {
    gap: t.spacing[3],
    padding: t.spacing[4],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.overlay[2],
  },
  joinCopy: {
    ...typeStyle('body'),
    color: t.colors.text.secondary,
  },
  // Mirrors app/(auth)/login.tsx's `error` style — same danger token + role.
  joinErrorText: {
    ...typeStyle('label'),
    color: t.colors.text.danger,
  },
  // Join CTA migrated to components/Button (F8).
  crewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
  },
  crewDot: {
    width: 8,
    height: 8,
    borderRadius: t.radii.pill,
  },
  crewName: {
    ...typeStyle('body'),
    color: t.colors.text.primary,
    flex: 1,
  },
  // F27: non-color priority label beside the colored dot.
  crewPriority: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
  },
  crewNoteRow: {
    gap: t.spacing[1],
    paddingVertical: t.spacing[2],
    borderTopWidth: 1,
    // R2 hairline: neutral white 0.08 section divider (was border.default 0.06).
    borderTopColor: t.colors.glass.border,
  },
  crewNoteName: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  crewNoteText: {
    ...typeStyle('body'),
    color: t.colors.text.primary,
  },
  statusRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: t.spacing[2],
  },
  statusText: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
  },
  statusWarn: {
    ...typeStyle('caption'),
    color: t.colors.accent.amber,
    flexShrink: 1,
  },
  statusAction: {
    minHeight: 44,
    minWidth: 44,
    justifyContent: 'center',
    paddingHorizontal: t.spacing[2],
  },
  statusActionText: {
    ...typeStyle('label'),
    color: t.colors.accent.aqua,
  },
  noteInput: {
    ...typeStyle('body'),
    color: t.colors.text.primary,
    minHeight: 64,
    padding: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    // border.light (0.10) not default (0.06): the input sits on the glass
    // sheet surface and the dimmer hairline was effectively invisible.
    borderColor: t.colors.border.light,
    backgroundColor: t.colors.bg.input,
    textAlignVertical: 'top',
  },
}));
