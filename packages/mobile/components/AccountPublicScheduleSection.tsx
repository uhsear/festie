import { useEffect, useState } from 'react';
import { Alert, Linking, Share, View, Text, Switch } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore, useUIStore } from '@festie/shared/stores';
import { api, fetchSharingStatus, resetShareLinks, type SharingStatus } from '@festie/shared/services';
import { buildPublicScheduleUrl } from '@festie/shared/utils';
import type { User } from '@festie/shared/types';
import { makeStyles, typeStyle, useTokens } from '../hooks/useTokens';
import { useHaptics } from '../hooks/useHaptics';
import Button from './Button';

const RESET_LABEL = 'Reset my share links';

/**
 * Opt-in switch for the public schedule page (PUT /account/public-schedule).
 * Off by default; when on, shows the link (selectable, with Share and Open buttons)
 * and names the festival the page shows. Also holds "Reset my share links", which
 * revokes every picks link and calendar feed the user has sent.
 */
export default function AccountPublicScheduleSection() {
  const t = useTokens();
  const styles = useStyles();
  const haptics = useHaptics();
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<SharingStatus | null>(null);
  const on = user?.publicSchedule === true;

  useEffect(() => {
    if (!on) return;
    let live = true;
    fetchSharingStatus()
      .then((s) => live && setStatus(s))
      .catch(() => live && setStatus(null));
    return () => {
      live = false;
    };
  }, [on]);

  if (!user) return null;

  const onChange = async (next: boolean) => {
    haptics.select();
    setSaving(true);
    setError(null);
    try {
      const res = await api.put<{ user: User }>('/account/public-schedule', { publicSchedule: next });
      setUser({ ...user, publicSchedule: res.user?.publicSchedule ?? next });
    } catch {
      setError("Couldn't update your public schedule page. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const url = buildPublicScheduleUrl(user.username);
  const festivalName = status?.publicFestival?.name;

  const doReset = async () => {
    try {
      await resetShareLinks();
      useUIStore
        .getState()
        .showToast('Done. Your old links no longer work. Share picks makes a new one.', { kind: 'success' });
    } catch {
      useUIStore
        .getState()
        .showToast("Couldn't reset your links. Check your connection and try again.", { kind: 'error' });
    }
  };

  const onReset = () => {
    haptics.warning();
    Alert.alert(
      'Reset all your share links?',
      "Every picks link and calendar subscription you've sent stops working right away. Anyone who has one will need a new link from you. Calendars you subscribed will stop updating; subscribe again from Picks › Add to calendar.",
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Reset links', style: 'destructive', onPress: () => void doReset() },
      ],
    );
  };

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <View style={styles.rowIcon}>
          <Ionicons name="globe-outline" size={20} color={t.colors.text.secondary} />
        </View>
        <View style={styles.rowBody}>
          <Text style={styles.rowTitle}>Public schedule page</Text>
          <Text style={styles.rowHint}>Anyone with the link can see your picks for your newest festival. Turning it off hides this page. Links you sent from Share picks keep working until you reset them below.</Text>
        </View>
        <Switch
          value={on}
          disabled={saving}
          onValueChange={(v) => void onChange(v)}
          trackColor={{ false: t.colors.text.muted, true: t.colors.accent.aqua }}
          ios_backgroundColor={t.colors.text.muted}
          thumbColor={t.colors.text.onAccent}
          accessibilityLabel="Public schedule page"
          accessibilityState={{ checked: on }}
          testID="public-schedule-switch"
        />
      </View>
      {on ? (
        <>
          <Text style={styles.link} selectable numberOfLines={1}>
            {url}
          </Text>
          {status ? (
            <Text style={styles.note}>
              {festivalName
                ? `Shows your picks for ${festivalName}. To share another festival, use Share picks on that festival's Picks.`
                : 'Join a festival and pick a set to fill this page.'}
            </Text>
          ) : null}
          <View style={styles.actions}>
            <Button
              label="Share"
              size="sm"
              variant="secondary"
              onPress={() => void Share.share({ message: url, url }).catch(() => undefined)}
            />
            <Button
              label="Open"
              size="sm"
              variant="secondary"
              onPress={() => void Linking.openURL(url).catch(() => undefined)}
            />
          </View>
        </>
      ) : null}
      <View style={styles.row}>
        <View style={styles.rowIcon}>
          <Ionicons name="refresh-outline" size={20} color={t.colors.text.secondary} />
        </View>
        <View style={styles.rowBody}>
          <Text style={styles.rowTitle}>{RESET_LABEL}</Text>
          <Text style={styles.rowHint}>
            Stops every picks link and calendar subscription you've shared. Your public schedule page is not affected; turn it off above.
          </Text>
        </View>
        <Button label={RESET_LABEL} size="sm" variant="danger" onPress={onReset} testID="reset-share-links" />
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
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
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[3],
    paddingHorizontal: t.spacing[4],
    paddingVertical: t.spacing[3],
    minHeight: 52,
  },
  rowIcon: { width: 22, alignItems: 'center' },
  rowBody: { flex: 1, gap: 2 },
  rowTitle: { ...typeStyle('body'), color: t.colors.text.primary },
  rowHint: { ...typeStyle('caption'), color: t.colors.text.secondary },
  link: {
    ...typeStyle('caption'),
    color: t.colors.accent.aqua,
    paddingHorizontal: t.spacing[4],
    paddingBottom: t.spacing[3],
  },
  note: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
    paddingHorizontal: t.spacing[4],
    paddingBottom: t.spacing[2],
  },
  actions: {
    flexDirection: 'row',
    gap: t.spacing[2],
    paddingHorizontal: t.spacing[4],
    paddingBottom: t.spacing[3],
  },
  error: {
    ...typeStyle('caption'),
    color: t.colors.text.danger,
    paddingHorizontal: t.spacing[4],
    paddingBottom: t.spacing[3],
  },
}));
