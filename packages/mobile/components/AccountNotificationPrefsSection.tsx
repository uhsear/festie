import { useEffect, useRef, useState } from 'react';
import { View, Text, Switch, Alert, AppState, Linking, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore, useNotificationPrefsStore } from '@festie/shared/stores';
import { useNotificationTopics } from '@festie/shared/hooks';
import {
  MUST_SEE_REMINDER_OPTIONS,
  QUIET_HOURS_PRESETS,
  TOPIC_GLOBAL_KEY,
  isValidQuietWindow,
  mustSeeOptionLabel,
  timeZoneCity,
  visibleNotificationRows,
  type NotificationBoolKey,
  type NotificationTypeRow,
} from '@festie/shared/utils';
import { Skeleton } from './Skeleton';
import { ModalSelect, TimeField } from './admin/AdminFields';
import AppPressable from './AppPressable';
import { formatQuietHours } from '../lib/accountFormat';
import { mutedPrefKeys } from '../lib/notificationChannels';
import { makeStyles, typeStyle, useTokens } from '../hooks/useTokens';
import { useHaptics } from '../hooks/useHaptics';
import SectionLabel from './SectionLabel';

/**
 * Per-category notification preferences plus quiet hours, wired to
 * GET/PUT /notifications/prefs via the shared notificationPrefs store. Set
 * reminders are scheduled on the device, so they sit in their own group and
 * never depend on push. The other types gate which pushes the server delivers.
 */
const QUIET_START = '23:00';
const QUIET_END = '08:00';

const ROW_ICONS: Record<NotificationBoolKey, keyof typeof Ionicons.glyphMap> = {
  setReminders: 'alarm-outline',
  scheduleChanges: 'calendar-outline',
  crewUpdates: 'people-outline',
  crewMeetingPoints: 'location-outline',
  crewPolls: 'stats-chart-outline',
  crewMoney: 'wallet-outline',
  crewRides: 'car-outline',
  lineupDrops: 'megaphone-outline',
  crewReformed: 'refresh-outline',
  wrapReady: 'sparkles-outline',
};

const TOPIC_ROWS = [
  { key: 'crew', title: 'Crew picks', icon: 'people-outline' },
  { key: 'schedule', title: 'Schedule changes', icon: 'calendar-outline' },
] as const;

/**
 * Per-festival mute for the current festival (GET/PUT /notifications/topics/:festivalId).
 * Renders nothing unless the user joined the current festival.
 */
function FestivalTopicsRows() {
  const styles = useStyles();
  const t = useTokens();
  const haptics = useHaptics();
  const prefs = useNotificationPrefsStore((s) => s.prefs);
  const { festival, subs, error, setTopic } = useNotificationTopics();

  if (!festival) return null;

  const onTopic = (topic: 'crew' | 'schedule', value: boolean) => {
    haptics.select();
    setTopic(topic, value).catch(() => {
      Alert.alert('Update failed', "Couldn't update notification setting. Try again.");
    });
  };

  return (
    <>
      <SectionLabel>Only for {festival.name}</SectionLabel>
      <Text style={styles.groupCaption}>
        Turn one off to mute it for this festival only. The switches above apply to every festival.
      </Text>
      <View style={styles.card}>
        {subs === null ? (
          error ? (
            <View style={styles.errorRow} accessibilityLiveRegion="polite">
              <Ionicons name="alert-circle-outline" size={14} color={t.colors.text.danger} style={styles.errorIcon} />
              <Text style={styles.errorText}>Couldn’t load festival settings.</Text>
            </View>
          ) : (
            <View style={styles.skeleton}>
              {[0, 1].map((i) => (
                <View key={i} style={styles.skelRow}>
                  <Skeleton width={140} height={14} radius={t.radii.xs} />
                  <Skeleton width={40} height={22} radius={t.radii.pill} />
                </View>
              ))}
            </View>
          )
        ) : (
          TOPIC_ROWS.map((r) => {
            const globalOff = !prefs[TOPIC_GLOBAL_KEY[r.key]];
            return (
              <View key={r.key} style={styles.row}>
                <View style={styles.rowIcon}>
                  <Ionicons name={r.icon} size={18} color={t.colors.text.secondary} />
                </View>
                <View style={styles.rowBody}>
                  <Text style={styles.rowTitle}>{r.title}</Text>
                  {globalOff ? <Text style={styles.rowHint}>Off for every festival</Text> : null}
                </View>
                <Switch
                  value={subs[r.key]}
                  disabled={globalOff}
                  onValueChange={(v) => onTopic(r.key, v)}
                  trackColor={{ false: t.colors.text.muted, true: t.colors.accent.aqua }}
                  ios_backgroundColor={t.colors.text.muted}
                  thumbColor={t.colors.text.onAccent}
                  accessibilityLabel={`${r.title} for ${festival.name}`}
                  accessibilityState={{ disabled: globalOff }}
                />
              </View>
            );
          })
        )}
      </View>
    </>
  );
}

export default function AccountNotificationPrefsSection({ pushOn = true }: { pushOn?: boolean }) {
  const t = useTokens();
  const styles = useStyles();
  const haptics = useHaptics();
  const user = useAuthStore((s) => s.user);
  const prefs = useNotificationPrefsStore((s) => s.prefs);
  const loaded = useNotificationPrefsStore((s) => s.loaded);
  const isLoading = useNotificationPrefsStore((s) => s.isLoading);
  const storeError = useNotificationPrefsStore((s) => s.error);
  const loadPrefs = useNotificationPrefsStore((s) => s.loadPrefs);
  const updatePrefs = useNotificationPrefsStore((s) => s.updatePrefs);
  const [muted, setMuted] = useState<Set<NotificationBoolKey>>(new Set());
  const [startText, setStartText] = useState(prefs.dndStart ?? QUIET_START);
  const [endText, setEndText] = useState(prefs.dndEnd ?? QUIET_END);

  useEffect(() => {
    // Auth gate: /notifications/prefs 401s for guests (section can be mounted
    // eagerly by NativeTabs even when the user never opens Account).
    if (!user) return;
    loadPrefs().catch(() => {});
  }, [user, loadPrefs]);

  // Android only: a channel the user muted in system settings silences its rows.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const read = () =>
      Notifications.getNotificationChannelsAsync()
        .then((channels) => setMuted(mutedPrefKeys(channels, AndroidImportance.NONE)))
        // Best-effort: without a reading no row is flagged.
        .catch(() => {});
    void read();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void read();
    });
    return () => sub.remove();
  }, []);

  // Remember the last real DND window so toggling quiet hours OFF (which nulls
  // the bounds) then back ON restores the user's own window.
  const lastWindow = useRef<{ start: string; end: string }>({ start: QUIET_START, end: QUIET_END });
  useEffect(() => {
    if (prefs.dndStart && prefs.dndEnd) {
      lastWindow.current = { start: prefs.dndStart, end: prefs.dndEnd };
      // eslint-disable-next-line react-hooks/set-state-in-effect -- mirror the saved window into the editable text fields.
      setStartText(prefs.dndStart);
      setEndText(prefs.dndEnd);
    }
  }, [prefs.dndStart, prefs.dndEnd]);

  if (!user) return null;

  const quietOn = !!prefs.dndStart;
  const quietCaption = formatQuietHours(prefs.dndStart, prefs.dndEnd);
  const set = (patch: Parameters<typeof updatePrefs>[0]) => {
    haptics.select();
    updatePrefs(patch).catch(() => {});
  };

  // Save only a valid window; an invalid draft stays in the text fields.
  const editWindow = (start: string, end: string) => {
    setStartText(start);
    setEndText(end);
    if (isValidQuietWindow(start, end)) set({ dndStart: start, dndEnd: end });
  };

  // Until the first load resolves, the switches would show defaults (all on)
  // which is a quiet lie — render a skeleton instead so toggles reflect truth.
  const showSkeleton = !loaded && isLoading;

  const renderRow = (r: NotificationTypeRow) => {
    const value = prefs[r.key];
    return (
      <View key={r.key} style={styles.row}>
        <View style={styles.rowIcon}>
          <Ionicons name={ROW_ICONS[r.key]} size={18} color={value ? t.colors.accent.aqua : t.colors.text.secondary} />
        </View>
        <View style={styles.rowBody}>
          <Text style={styles.rowTitle}>{r.label}</Text>
          <Text style={styles.rowHint}>{r.hint}</Text>
          {muted.has(r.key) ? <Text style={styles.mutedHint}>Muted in Android settings</Text> : null}
        </View>
        <Switch
          value={value}
          onValueChange={(v) => set({ [r.key]: v })}
          trackColor={{ false: t.colors.text.muted, true: t.colors.accent.aqua }}
          ios_backgroundColor={t.colors.text.muted}
          thumbColor={t.colors.text.onAccent}
          accessibilityLabel={r.label}
          accessibilityState={{ checked: value }}
        />
      </View>
    );
  };

  if (showSkeleton) {
    return (
      <>
        <SectionLabel>Notification types</SectionLabel>
        <View style={styles.card}>
          <View style={styles.skeleton}>
            {[0, 1, 2, 3].map((i) => (
              <View key={i} style={styles.skelRow}>
                <Skeleton width={140} height={14} radius={t.radii.xs} />
                <Skeleton width={40} height={22} radius={t.radii.pill} />
              </View>
            ))}
          </View>
        </View>
        <FestivalTopicsRows />
      </>
    );
  }

  const rows = visibleNotificationRows();

  return (
    <>
      <SectionLabel>On this phone</SectionLabel>
      <Text style={styles.groupCaption}>Works offline. Push notifications not needed.</Text>
      <View style={styles.card}>
        {rows.filter((r) => r.onDevice).map(renderRow)}
        <View style={styles.selectWrap}>
          <ModalSelect
            label="Must-see reminders"
            value={String(prefs.mustSeeReminderMinutes ?? 'off')}
            options={MUST_SEE_REMINDER_OPTIONS.map((v) => ({ label: mustSeeOptionLabel(v), value: String(v ?? 'off') }))}
            onSelect={(v) =>
              set({ mustSeeReminderMinutes: v === 'off' ? null : (Number(v) as 5 | 10 | 15 | 30 | 60) })
            }
            hint="Reminds you before every set you mark Must see."
          />
        </View>
      </View>

      <SectionLabel>From your crew and Festie</SectionLabel>
      {pushOn ? null : <Text style={styles.groupCaption}>Turn on push notifications above to get these.</Text>}
      <View style={styles.card}>
        {rows.filter((r) => !r.onDevice).map(renderRow)}
        <View style={styles.row} accessible accessibilityLabel="SOS from your crew: always on">
          <View style={styles.rowIcon}>
            <Ionicons name="alert-circle" size={18} color={t.colors.accent.coral} />
          </View>
          <Text style={styles.rowTitle}>SOS from your crew</Text>
          <Text style={styles.alwaysOn}>Always on</Text>
        </View>

        <View style={styles.row}>
          <View style={styles.rowIcon}>
            <Ionicons name="moon-outline" size={18} color={quietOn ? t.colors.accent.aqua : t.colors.text.secondary} />
          </View>
          <View style={styles.rowBody}>
            <Text style={styles.rowTitle}>Quiet hours</Text>
            <Text style={styles.rowHint}>
              {quietOn && quietCaption
                ? `Mutes everything except SOS ${quietCaption}${prefs.dndTimeZone ? ` (${timeZoneCity(prefs.dndTimeZone)} time)` : ''}`
                : 'Mutes notifications during your chosen window, except SOS'}
            </Text>
          </View>
          <Switch
            value={quietOn}
            onValueChange={(v) =>
              set(
                v
                  ? { dndStart: lastWindow.current.start, dndEnd: lastWindow.current.end }
                  : { dndStart: null, dndEnd: null },
              )
            }
            trackColor={{ false: t.colors.text.muted, true: t.colors.accent.aqua }}
            ios_backgroundColor={t.colors.text.muted}
            thumbColor={t.colors.text.onAccent}
            accessibilityLabel="Quiet hours"
            accessibilityState={{ checked: quietOn }}
          />
        </View>

        {quietOn ? (
          <View style={styles.quietEditor}>
            <View style={styles.chips}>
              {QUIET_HOURS_PRESETS.map((p) => {
                const selected = prefs.dndStart === p.start && prefs.dndEnd === p.end;
                const label = p.id === 'festival' ? `${p.label} (4 AM to 11 AM)` : p.label;
                return (
                  <AppPressable
                    key={p.id}
                    onPress={() => editWindow(p.start, p.end)}
                    style={[styles.chip, selected && styles.chipSelected]}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    accessibilityLabel={label}
                  >
                    <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
                  </AppPressable>
                );
              })}
            </View>
            <View style={styles.timeFields}>
              <View style={styles.timeField}>
                <TimeField label="From" value={startText} onChangeText={(v) => editWindow(v, endText)} />
              </View>
              <View style={styles.timeField}>
                <TimeField label="To" value={endText} onChangeText={(v) => editWindow(startText, v)} />
              </View>
            </View>
            {!isValidQuietWindow(startText, endText) ? (
              <Text style={styles.errorText} accessibilityLiveRegion="polite">
                Start and end can't be the same.
              </Text>
            ) : null}
          </View>
        ) : null}

        {Platform.OS === 'android' ? (
          <AppPressable
            onPress={() => void Linking.openSettings()}
            style={styles.row}
            accessibilityRole="button"
            accessibilityLabel="Manage in Android settings"
          >
            <View style={styles.rowIcon}>
              <Ionicons name="settings-outline" size={18} color={t.colors.text.secondary} />
            </View>
            <Text style={styles.rowTitle}>Manage in Android settings</Text>
            <Ionicons name="chevron-forward" size={16} color={t.colors.text.secondary} />
          </AppPressable>
        ) : null}

        {storeError ? (
          <View style={styles.errorRow} accessibilityLiveRegion="polite">
            <Ionicons name="alert-circle-outline" size={14} color={t.colors.text.danger} style={styles.errorIcon} />
            <Text style={styles.errorText}>{storeError}</Text>
          </View>
        ) : null}
      </View>
      <FestivalTopicsRows />
    </>
  );
}

const useStyles = makeStyles((t) => ({
  card: {
    backgroundColor: t.colors.bg.secondary,
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    overflow: 'hidden',
    paddingBottom: t.spacing[2],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[3],
    paddingHorizontal: t.spacing[4],
    paddingVertical: t.spacing[3],
    minHeight: 52,
  },
  rowIcon: {
    width: 22,
    alignItems: 'center',
  },
  rowBody: {
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    ...typeStyle('body'),
    color: t.colors.text.primary,
    flex: 1,
  },
  rowHint: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  mutedHint: {
    ...typeStyle('caption'),
    color: t.colors.text.danger,
  },
  alwaysOn: {
    ...typeStyle('label'),
    color: t.colors.text.secondary,
  },
  groupCaption: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
    marginBottom: t.spacing[2],
  },
  selectWrap: {
    paddingHorizontal: t.spacing[4],
    paddingVertical: t.spacing[3],
  },
  quietEditor: {
    paddingHorizontal: t.spacing[4],
    paddingBottom: t.spacing[3],
    gap: t.spacing[3],
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: t.spacing[2],
  },
  chip: {
    borderWidth: 1,
    borderColor: t.colors.border.default,
    borderRadius: t.radii.pill,
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[2],
  },
  chipSelected: {
    borderColor: t.colors.accent.aqua,
  },
  chipText: {
    ...typeStyle('label'),
    color: t.colors.text.secondary,
  },
  chipTextSelected: {
    color: t.colors.accent.aqua,
  },
  timeFields: {
    flexDirection: 'row',
    gap: t.spacing[3],
  },
  timeField: {
    flex: 1,
  },
  skeleton: {
    paddingHorizontal: t.spacing[4],
    paddingTop: t.spacing[2],
    gap: t.spacing[3],
  },
  skelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: t.spacing[2],
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: t.spacing[4],
    paddingTop: t.spacing[2],
  },
  errorIcon: {
    marginRight: t.spacing[1],
  },
  errorText: {
    ...typeStyle('caption'),
    color: t.colors.text.danger,
    flexShrink: 1,
  },
}));
