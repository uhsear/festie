import { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Alert, Linking, AccessibilityInfo } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useCrewStore, useFestivalDataStore } from '@festie/shared/stores';
import { useAutoArrive, useFestival } from '@festie/shared/hooks';
import {
  CREW_STATUS_PRESETS,
  arrivedMessage,
  crewStatusLabel,
  etaMinutes,
  formatStaleness,
  isStatusFresh,
  presetStageName,
  resolveFestivalTimeZone,
  selectNowNext,
  splitMeetingPoints,
  statusNoteLine,
} from '@festie/shared/utils';
import type { CrewMemberStatus, CrewStatusKey } from '@festie/shared/types';
import { makeStyles, typeStyle, useTokens, MAX_FONT_SCALE } from '../hooks/useTokens';
import { useHaptics } from '../hooks/useHaptics';
import { useNow } from '../hooks/useNow';
import Avatar from './Avatar';
import Button from './Button';

interface CrewStatusProps {
  crewId: string;
  currentUserId: string;
}

const STATUS_ICON: Record<CrewStatusKey, keyof typeof Ionicons.glyphMap> = {
  'on-my-way': 'walk-outline',
  here: 'checkmark-circle-outline',
  delayed: 'time-outline',
  'at-camp': 'bonfire-outline',
  'at-stage': 'musical-notes-outline',
  break: 'cafe-outline',
  lost: 'help-buoy-outline',
};

const statusIcon = (status: string | null): keyof typeof Ionicons.glyphMap =>
  STATUS_ICON[status as CrewStatusKey] ?? 'location-outline';

/**
 * Crew member status (M5) — last-synced "On my way to [meeting point] · ETA ~N
 * min" action + a crew status list with HONEST staleness.
 *
 * CARDINAL RULE: this is offline-DEGRADED-SYNCS, NOT live GPS. Every row is a
 * snapshot the member set (often offline) that delivered on the next signal
 * blip. The copy ALWAYS says "as of N ago" (formatStaleness) and "sent when
 * signal returns" — it NEVER implies a live, moving position.
 *
 * Offline path: updateMyStatus queues the PUT with a deterministic clientId so
 * repeated toggles collapse, optimistically upserts my row, and reconciles on
 * reconnect. ETA is computed (etaMinutes from @festie/shared) from the device's
 * captured position to the target meeting point's saved coord when both exist;
 * otherwise the member types a manual estimate. Mirrors the web CrewStatus.
 */
export default function CrewStatus({ crewId, currentUserId }: CrewStatusProps) {
  const t = useTokens();
  const styles = useStyles();
  const haptics = useHaptics();

  const meetingPoints = useCrewStore((s) => s.meetingPoints);
  const statuses = useCrewStore((s) => s.crewStatuses);
  const members = useCrewStore((s) => s.crewMembers);
  const loadStatuses = useCrewStore((s) => s.loadStatuses);
  const updateMyStatus = useCrewStore((s) => s.updateMyStatus);

  const currentFestival = useFestivalDataStore((s) => s.currentFestival);
  const sets = useFestivalDataStore((s) => s.sets);
  const days = useFestivalDataStore((s) => s.days);
  const picks = useFestivalDataStore((s) => s.currentProfile?.picks);
  const { getStageName } = useFestival();
  const nowMs = useNow(60_000);

  const [showPresets, setShowPresets] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [targetId, setTargetId] = useState<string>('');
  const [manualEta, setManualEta] = useState<string>('');
  const [note, setNote] = useState('');
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [focusedField, setFocusedField] = useState<'eta' | 'note' | null>(null);

  // Load once per crew. Offline this resolves from the persisted read-cache.
  useEffect(() => {
    if (crewId) loadStatuses(crewId).catch(() => {});
  }, [crewId, loadStatuses]);

  // Realtime crew:status-updated patching is wired centrally (single shared
  // socket), so this component just reads crewStore.crewStatuses.

  useAutoArrive({
    crewId,
    userId: currentUserId,
    meetingPoints,
    onArrive: (label) => {
      haptics.success();
      AccessibilityInfo.announceForAccessibility(arrivedMessage(label));
    },
  });

  const stageName = useMemo(() => {
    const selection = selectNowNext({
      sets,
      days,
      picks: picks ?? {},
      nowMs,
      timeZone: resolveFestivalTimeZone(currentFestival),
    });
    return presetStageName(selection, nowMs, getStageName);
  }, [sets, days, picks, nowMs, currentFestival, getStageName]);

  const openTargets = useMemo(() => splitMeetingPoints(meetingPoints, [], nowMs).current, [meetingPoints, nowMs]);

  const target = useMemo(() => meetingPoints.find((m) => m.id === targetId) ?? null, [meetingPoints, targetId]);

  // Geo-computed ETA: device position → target coord. null when either is
  // missing (no coord target, or no captured position) — then the manual
  // estimate is used.
  const computedEta = useMemo(() => {
    if (!coords || !target || typeof target.latitude !== 'number' || typeof target.longitude !== 'number') {
      return null;
    }
    return etaMinutes(
      { latitude: coords.lat, longitude: coords.lng },
      { latitude: target.latitude, longitude: target.longitude },
    );
  }, [coords, target]);

  const effectiveEta = computedEta ?? (manualEta.trim() ? Number(manualEta.trim()) : null);

  const reset = () => {
    setTargetId('');
    setManualEta('');
    setNote('');
    setCoords(null);
    setLocating(false);
    setShowForm(false);
  };

  // Capture the device position via expo-location for a distance-based ETA to
  // the target meeting point's saved coord. Permission denial gracefully falls
  // back to the manual estimate.
  const captureLocation = async () => {
    if (locating) return;
    setLocating(true);
    try {
      const { status: perm } = await Location.requestForegroundPermissionsAsync();
      if (perm !== 'granted') {
        Alert.alert('Location permission denied', 'Type an ETA estimate instead.');
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      // Confirm the fix landed — a geo-ETA is about to replace the manual field.
      haptics.success();
    } catch {
      Alert.alert('Location unavailable', "Couldn't get your location — type an ETA estimate instead.");
    } finally {
      setLocating(false);
    }
  };

  // Silent fix for the "Lost" preset: no denial alert, send without a position on failure.
  const quietFix = async (): Promise<{ lat: number; lng: number } | null> => {
    try {
      const { status: perm } = await Location.requestForegroundPermissionsAsync();
      if (perm !== 'granted') return null;
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      return { lat: pos.coords.latitude, lng: pos.coords.longitude };
    } catch {
      return null;
    }
  };

  const sendPreset = async (key: CrewStatusKey) => {
    if (busy) return;
    if (key === 'on-my-way') {
      setShowPresets(false);
      setShowForm(true);
      return;
    }
    setBusy(true);
    try {
      const fix = key === 'lost' ? await quietFix() : null;
      await updateMyStatus(
        crewId,
        {
          status: key,
          targetMeetingPointId: null,
          etaMinutes: null,
          note: key === 'at-stage' ? stageName : null,
          ...(fix ? { position: fix } : {}),
        },
        currentUserId,
      );
      haptics.success();
      setShowPresets(false);
    } catch {
      // Error surfaced via the crew store.
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const eta = effectiveEta != null && Number.isFinite(effectiveEta) ? Math.round(effectiveEta) : null;
      await updateMyStatus(
        crewId,
        {
          status: 'on-my-way',
          targetMeetingPointId: targetId || null,
          etaMinutes: eta != null && eta >= 0 ? Math.min(eta, 1440) : null,
          note: note.trim() || null,
          // 055: persist the captured device fix as an OFFLINE presence breadcrumb
          // (NOT live GPS). Omit when no fix was captured so the server COALESCEs —
          // leaving any prior breadcrumb untouched.
          ...(coords ? { position: { lat: coords.lat, lng: coords.lng } } : {}),
        },
        currentUserId,
      );
      haptics.success();
      reset();
    } catch {
      // Error surfaced via the crew store.
    } finally {
      setBusy(false);
    }
  };

  const clearMine = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await updateMyStatus(
        crewId,
        { status: null, targetMeetingPointId: null, etaMinutes: null, note: null },
        currentUserId,
      );
    } catch {
      // Error surfaced via the crew store.
    } finally {
      setBusy(false);
    }
  };

  // Open a crewmate's last-known breadcrumb in the device's maps app. This is
  // the OFFLINE last-synced fix (never live), so it's an approximate pin only.
  const openBreadcrumb = (lat: number, lng: number) => {
    Linking.openURL(`https://maps.google.com/?q=${lat},${lng}`).catch(() => {});
  };

  const mine = statuses.find((s) => s.user_id === currentUserId && isStatusFresh(s, nowMs));
  const labelFor = (id: string | null) => (id ? (meetingPoints.find((m) => m.id === id)?.label ?? null) : null);
  const activeStatuses = statuses.filter((s) => isStatusFresh(s, nowMs));

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerTitleRow}>
          <Ionicons name="navigate-outline" size={16} color={t.colors.accent.aqua} />
          <Text style={styles.headerTitle}>Crew status</Text>
        </View>
        {!showForm && !showPresets ? (
          <TouchableOpacity
            style={styles.headerButton}
            onPress={() => setShowPresets(true)}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Share your status"
          >
            <Text style={styles.headerButtonText} maxFontSizeMultiplier={MAX_FONT_SCALE}>{mine ? 'Update mine' : 'Share status'}</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {/* Honesty banner: this is NEVER live. */}
      <Text style={styles.banner}>Not live: each status shows when that crewmate last had signal.</Text>

      {showPresets ? (
        <View style={styles.formBox}>
          <View style={styles.formHeader}>
            <Text style={styles.formTitle}>Share my status</Text>
            <TouchableOpacity
              onPress={() => setShowPresets(false)}
              style={styles.iconButton}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Cancel status"
            >
              <Ionicons name="close" size={t.iconSize.action} color={t.colors.text.secondary} />
            </TouchableOpacity>
          </View>
          <View style={styles.statusGrid}>
            {CREW_STATUS_PRESETS.map((preset) => {
              if (preset.key === 'at-stage' && !stageName) return null;
              const label = preset.key === 'at-stage' ? `At ${stageName}` : preset.label;
              return (
                <TouchableOpacity
                  key={preset.key}
                  style={styles.statusChip}
                  onPress={() => sendPreset(preset.key)}
                  disabled={busy}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityLabel={label}
                >
                  <Ionicons name={STATUS_ICON[preset.key]} size={16} color={t.colors.text.secondary} />
                  <Text style={styles.statusChipText} maxFontSizeMultiplier={MAX_FONT_SCALE}>{label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      ) : null}

      {showForm ? (
        <View style={styles.formBox}>
          <View style={styles.formHeader}>
            <Text style={styles.formTitle}>On my way</Text>
            <TouchableOpacity
              onPress={reset}
              style={styles.iconButton}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Cancel status"
            >
              <Ionicons name="close" size={t.iconSize.action} color={t.colors.text.secondary} />
            </TouchableOpacity>
          </View>

          {/* ETA target: a meeting point. Coordless points still work (manual ETA). */}
          <Text style={styles.fieldLabel}>Heading to</Text>
          <View style={styles.typeGrid}>
            <TouchableOpacity
              style={[styles.targetChip, !targetId && styles.targetChipActive]}
              onPress={() => setTargetId('')}
              activeOpacity={0.8}
              accessibilityRole="radio"
              accessibilityState={{ selected: !targetId }}
              accessibilityLabel="No specific point"
            >
              <Text style={[styles.targetChipText, !targetId && styles.targetChipTextActive]} maxFontSizeMultiplier={MAX_FONT_SCALE}>No specific point</Text>
            </TouchableOpacity>
            {openTargets.map((m) => {
              const active = targetId === m.id;
              const hasCoord = typeof m.latitude === 'number' && typeof m.longitude === 'number';
              return (
                <TouchableOpacity
                  key={m.id}
                  style={[styles.targetChip, active && styles.targetChipActive]}
                  onPress={() => setTargetId(m.id)}
                  activeOpacity={0.8}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`Heading to ${m.label}`}
                >
                  {hasCoord ? (
                    <Ionicons name="location" size={12} color={active ? t.colors.accent.aqua : t.colors.text.muted} />
                  ) : null}
                  <Text style={[styles.targetChipText, active && styles.targetChipTextActive]} maxFontSizeMultiplier={MAX_FONT_SCALE}>{m.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Location capture → geo ETA, or manual estimate. */}
          <View style={styles.captureRow}>
            <Button
              variant="utility"
              size="sm"
              icon="locate-outline"
              label="Use my location"
              loadingLabel="Locating…"
              loading={locating}
              onPress={captureLocation}
              accessibilityLabel="Use my location for ETA"
            />
            {computedEta != null ? (
              <Text style={styles.etaText}>ETA ~{computedEta} min</Text>
            ) : (
              <TextInput
                style={[styles.etaInput, focusedField === 'eta' && styles.inputFocused]}
                placeholder="ETA min"
                placeholderTextColor={t.colors.text.placeholder}
                keyboardType="number-pad"
                value={manualEta}
                onChangeText={setManualEta}
                maxLength={4}
                onFocus={() => setFocusedField('eta')}
                onBlur={() => setFocusedField((f) => (f === 'eta' ? null : f))}
                accessibilityLabel="ETA in minutes"
              />
            )}
          </View>

          <TextInput
            style={[styles.input, focusedField === 'note' && styles.inputFocused]}
            placeholder="Note (optional, e.g. grabbing water first)"
            placeholderTextColor={t.colors.text.placeholder}
            value={note}
            onChangeText={setNote}
            maxLength={280}
            onFocus={() => setFocusedField('note')}
            onBlur={() => setFocusedField((f) => (f === 'note' ? null : f))}
            accessibilityLabel="Status note"
          />

          <Button
            label={
              target
                ? `On my way to ${target.label}${effectiveEta != null ? ` · ETA ~${Math.round(effectiveEta)} min` : ''}`
                : 'Share status'
            }
            loading={busy}
            loadingLabel="Sharing…"
            numberOfLines={2}
            onPress={submit}
            accessibilityLabel="Share status"
          />
          <Text style={styles.sendHint}>Sent when signal returns.</Text>
        </View>
      ) : null}

      {/* Crew status list with HONEST staleness. */}
      {activeStatuses.length > 0 ? (
        <View style={styles.list}>
          {activeStatuses.map((s: CrewMemberStatus) => {
            const isMe = s.user_id === currentUserId;
            const targetLabel = labelFor(s.target_meeting_point_id);
            return (
              <View key={s.user_id} style={styles.statusRow}>
                <Ionicons name={statusIcon(s.status)} size={t.iconSize.action} color={t.colors.accent.aqua} style={styles.statusRowIcon} />
                <View style={styles.statusRowBody}>
                  <View style={styles.statusRowTitle}>
                    <Text style={styles.statusRowName} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>
                      {isMe ? 'You' : s.name || s.username || 'Crewmate'}
                    </Text>
                    <Text style={styles.statusRowState} numberOfLines={1}>
                      {crewStatusLabel(s)}
                    </Text>
                  </View>
                  {targetLabel ? (
                    <Text style={styles.statusRowTarget} numberOfLines={1}>
                      → {targetLabel}
                      {typeof s.eta_minutes === 'number' ? ` · ETA ~${s.eta_minutes} min` : ''}
                    </Text>
                  ) : typeof s.eta_minutes === 'number' ? (
                    <Text style={styles.statusRowTarget}>ETA ~{s.eta_minutes} min</Text>
                  ) : null}
                  {statusNoteLine(s) ? (
                    <Text style={styles.statusRowNote} numberOfLines={2}>
                      {statusNoteLine(s)}
                    </Text>
                  ) : null}
                  {/* Honest staleness — the cardinal rule. */}
                  <Text style={styles.staleness}>{formatStaleness(s.updated_at)}</Text>
                  {/* 055: last-known OFFLINE breadcrumb (NOT live). Staleness is
                      derived from location_captured_at, with an open-in-maps tap. */}
                  {typeof s.latitude === 'number' && typeof s.longitude === 'number' ? (
                    <TouchableOpacity
                      style={styles.lastSeenRow}
                      onPress={() => openBreadcrumb(s.latitude as number, s.longitude as number)}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityLabel={`Open ${isMe ? 'your' : s.name || s.username || 'crewmate'} last seen location in maps`}
                    >
                      <Ionicons name="location-outline" size={12} color={t.colors.accent.aqua} />
                      <Text style={styles.lastSeenText} numberOfLines={1}>
                        Last seen {formatStaleness(s.location_captured_at ?? s.updated_at).replace(/^as of /, '~')}
                      </Text>
                      <Ionicons name="open-outline" size={12} color={t.colors.accent.aqua} />
                    </TouchableOpacity>
                  ) : null}
                </View>
                {isMe ? (
                  <TouchableOpacity
                    onPress={clearMine}
                    disabled={busy}
                    hitSlop={{ top: 15, bottom: 15, left: 8, right: 8 }}
                    accessibilityRole="button"
                    accessibilityLabel="Clear my status"
                  >
                    <Text style={styles.clearText}>Clear</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            );
          })}
        </View>
      ) : members.length > 0 ? (
        // C3 — nobody has shared a status: a compact roster beats an empty block.
        <View
          style={styles.emptyRow}
          accessibilityRole="text"
          accessibilityLabel={`No one has shared a status yet, ${members.length} member${members.length === 1 ? '' : 's'}`}
        >
          <View style={styles.emptyAvatars} accessible={false}>
            {members.slice(0, 6).map((m) => (
              <Avatar key={m.userId} name={m.name || m.username || 'Crew'} size="xs" borderColor={t.colors.bg.card} />
            ))}
          </View>
          <Text style={styles.emptyText}>
            No one has shared a status yet · {members.length} member{members.length === 1 ? '' : 's'}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  container: {
    gap: t.spacing[3],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    rowGap: t.spacing[2],
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
  },
  headerTitle: {
    ...typeStyle('label'),
    color: t.colors.text.primary,
  },
  headerButton: {
    justifyContent: 'center',
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[2],
    minHeight: 44, // WCAG 2.5.5 / Apple HIG minimum touch target
    borderRadius: t.radii.pill,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.input,
  },
  headerButtonText: {
    ...typeStyle('caption'),
    color: t.colors.accent.aqua,
  },
  banner: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
  },
  formBox: {
    gap: t.spacing[2],
    padding: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
  },
  formHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  formTitle: {
    ...typeStyle('label'),
    color: t.colors.text.primary,
    flex: 1,
  },
  statusGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: t.spacing[2],
  },
  statusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[1],
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[2],
    minHeight: 44,
    justifyContent: 'center',
    borderRadius: t.radii.pill,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.input,
  },
  statusChipActive: {
    borderColor: t.colors.accent.aqua,
    backgroundColor: t.colors.ring.aqua,
  },
  statusChipText: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  statusChipTextActive: {
    color: t.colors.accent.aqua,
  },
  fieldLabel: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  typeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: t.spacing[2],
  },
  targetChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[1],
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[2],
    minHeight: 44,
    justifyContent: 'center',
    borderRadius: t.radii.pill,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.input,
  },
  targetChipActive: {
    borderColor: t.colors.accent.aqua,
    backgroundColor: t.colors.ring.aqua,
  },
  targetChipText: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  targetChipTextActive: {
    color: t.colors.accent.aqua,
  },
  captureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: t.spacing[2],
  },
  etaText: {
    ...typeStyle('caption'),
    color: t.colors.accent.aqua,
  },
  etaInput: {
    width: 96,
    backgroundColor: t.colors.bg.input,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    borderRadius: t.radii.default,
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[2],
    ...typeStyle('body'),
    color: t.colors.text.primary,
  },
  input: {
    backgroundColor: t.colors.bg.input,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    borderRadius: t.radii.default,
    paddingHorizontal: t.spacing[4],
    paddingVertical: t.spacing[3],
    ...typeStyle('body'),
    color: t.colors.text.primary,
  },
  inputFocused: {
    borderColor: t.colors.accent.aqua,
    backgroundColor: t.colors.ring.aqua,
  },
  sendHint: {
    ...typeStyle('micro'),
    color: t.colors.text.muted,
    textAlign: 'center',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  iconButton: {
    padding: t.spacing[1],
    // WCAG 2.5.5 / Apple HIG >=44pt touch target for these small (16-18px)
    // icon-only controls — padding alone can't reach it.
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: {
    gap: t.spacing[2],
  },
  emptyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
  },
  emptyAvatars: {
    flexDirection: 'row',
  },
  emptyText: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
    flexShrink: 1,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: t.spacing[2],
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    // R2 hairline: neutral white 0.08 separator (was border.light 0.1).
    borderColor: t.colors.glass.border,
    backgroundColor: t.colors.bg.secondary,
  },
  statusRowIcon: {
    marginTop: 1,
  },
  statusRowBody: {
    flex: 1,
    gap: t.spacing[1],
  },
  statusRowTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    flexWrap: 'wrap',
  },
  statusRowName: {
    ...typeStyle('label'),
    color: t.colors.text.primary,
    flexShrink: 1,
  },
  statusRowState: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
    flexShrink: 1,
  },
  statusRowTarget: {
    ...typeStyle('caption'),
    color: t.colors.accent.aqua,
  },
  statusRowNote: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  staleness: {
    ...typeStyle('micro'),
    color: t.colors.text.muted,
  },
  lastSeenRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[1],
    minHeight: 44, // WCAG 2.5.5 / Apple HIG tap target for the open-in-maps affordance
  },
  lastSeenText: {
    ...typeStyle('micro'),
    color: t.colors.accent.aqua,
    flexShrink: 1,
  },
  clearText: {
    ...typeStyle('micro'),
    color: t.colors.text.muted,
  },
}));
