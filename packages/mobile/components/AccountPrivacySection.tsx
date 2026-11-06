import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { PRIVACY_COPY } from '@festie/shared/constants';
import { fetchSharingStatus, stopAllSharing } from '@festie/shared/services';
import type { SharingStatus } from '@festie/shared/services';
import { useAuthStore, useCrewStore, useLiveLocationStore, useUIStore } from '@festie/shared/stores';
import { buildPrivacySummary } from '@festie/shared/utils';
import { makeStyles, typeStyle, useTokens } from '../hooks/useTokens';
import { useHaptics } from '../hooks/useHaptics';

const formatClock = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/**
 * "Who can see what" card: one row per thing Festie shares, plus "Stop all sharing".
 * The status-location row comes from GET /account/sharing so it covers every crew,
 * not only the open one; it falls back to local data when that call fails.
 */
export default function AccountPrivacySection() {
  const t = useTokens();
  const styles = useStyles();
  const haptics = useHaptics();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const shareIntent = useLiveLocationStore((s) => s.shareIntent);
  const crews = useCrewStore((s) => s.crews);
  const activeCrew = useCrewStore((s) => s.activeCrew);
  const crewStatuses = useCrewStore((s) => s.crewStatuses);
  const offlineMode = useUIStore((s) => s.offlineMode);
  const [statusLocations, setStatusLocations] = useState<SharingStatus['statusLocations'] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    fetchSharingStatus()
      .then((s) => setStatusLocations(s.statusLocations ?? null))
      .catch((err) => {
        console.error('Could not load sharing status', err);
        setStatusLocations(null);
      });
  }, []);

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  const summary = useMemo(
    () =>
      buildPrivacySummary({
        user,
        shareIntent,
        statusLocations: statusLocations ?? null,
        myStatus: crewStatuses.find((s) => s.user_id === user?.id) ?? null,
        crewNameById: (id) => crews.find((c) => c.id === id)?.name ?? null,
        activeCrewName: activeCrew?.name ?? null,
        formatClock,
      }),
    [user, shareIntent, statusLocations, crewStatuses, crews, activeCrew],
  );

  if (!user) return null;

  const stop = async () => {
    setBusy(true);
    try {
      await stopAllSharing();
      setStatusLocations([]);
      haptics.success();
      useUIStore.getState().showToast(PRIVACY_COPY.done);
    } catch {
      haptics.warning();
      useUIStore.getState().showToast(PRIVACY_COPY.error, { kind: 'error' });
      load();
    } finally {
      setBusy(false);
    }
  };

  const confirmStop = () => {
    haptics.warning();
    Alert.alert(PRIVACY_COPY.confirmTitle, PRIVACY_COPY.confirmBody, [
      { text: PRIVACY_COPY.cancel, style: 'cancel' },
      { text: PRIVACY_COPY.confirmButton, style: 'destructive', onPress: () => void stop() },
    ]);
  };

  const stopDisabled = !summary.canStop || busy || offlineMode;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Ionicons name="shield-checkmark-outline" size={20} color={t.colors.text.secondary} />
        <Text style={styles.title} accessibilityRole="header">
          {PRIVACY_COPY.title}
        </Text>
      </View>
      {summary.rows.map((row) => (
        <View key={row.key} style={styles.item} accessible accessibilityLabel={`${row.label}: ${row.value}`}>
          <View style={styles.dotSlot}>{row.active ? <View style={styles.dot} /> : null}</View>
          <View style={styles.itemBody}>
            <Text style={styles.label}>{row.label}</Text>
            <Text style={styles.value}>{row.value}</Text>
          </View>
        </View>
      ))}
      <Text style={styles.guarantee}>{PRIVACY_COPY.noFriendGraph}</Text>
      <Text style={styles.guarantee}>{PRIVACY_COPY.freeOffline}</Text>
      <TouchableOpacity
        style={[styles.stop, stopDisabled && styles.disabled]}
        onPress={confirmStop}
        disabled={stopDisabled}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={PRIVACY_COPY.stopButton}
        accessibilityState={{ disabled: stopDisabled, busy }}
        accessibilityHint={!summary.canStop ? PRIVACY_COPY.stopHintNone : undefined}
      >
        <Text style={styles.stopText}>{PRIVACY_COPY.stopButton}</Text>
      </TouchableOpacity>
      {!summary.canStop ? <Text style={styles.guarantee}>{PRIVACY_COPY.stopHintNone}</Text> : null}
      <TouchableOpacity
        style={styles.policy}
        onPress={() => router.push('/privacy')}
        activeOpacity={0.7}
        accessibilityRole="link"
        accessibilityLabel={PRIVACY_COPY.policyLink}
      >
        <Ionicons name="document-text-outline" size={18} color={t.colors.text.secondary} />
        <Text style={styles.policyText}>{PRIVACY_COPY.policyLink}</Text>
      </TouchableOpacity>
    </View>
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[3],
    paddingHorizontal: t.spacing[4],
    paddingVertical: t.spacing[3],
  },
  title: { ...typeStyle('body'), fontWeight: '700', color: t.colors.text.primary, flex: 1 },
  item: {
    flexDirection: 'row',
    gap: t.spacing[3],
    paddingHorizontal: t.spacing[4],
    paddingVertical: t.spacing[2],
  },
  dotSlot: { width: 20, alignItems: 'center', paddingTop: 6 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: t.colors.accent.aqua },
  itemBody: { flex: 1, gap: 2 },
  label: { ...typeStyle('body'), color: t.colors.text.primary },
  value: { ...typeStyle('caption'), color: t.colors.text.secondary },
  guarantee: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
    paddingHorizontal: t.spacing[4],
    paddingVertical: t.spacing[1],
  },
  stop: {
    minHeight: 44,
    justifyContent: 'center',
    marginHorizontal: t.spacing[4],
    marginTop: t.spacing[2],
  },
  disabled: { opacity: 0.5 },
  stopText: { ...typeStyle('body'), color: t.colors.text.danger },
  policy: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    minHeight: 44,
    paddingHorizontal: t.spacing[4],
  },
  policyText: { ...typeStyle('body'), color: t.colors.text.secondary },
}));
