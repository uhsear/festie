import { useState } from 'react';
import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@festie/shared/stores';
import { buildPublicScheduleUrl } from '@festie/shared/utils';
import AppSwitch from './AppSwitch';
import { makeStyles, typeStyle, useTokens } from '../hooks/useTokens';
import { useHaptics } from '../hooks/useHaptics';

/**
 * Opt-in switch for the public schedule page (PUT /account/public-schedule).
 * Off by default; when on, shows the link so it can be long-pressed and copied.
 */
export default function AccountPublicScheduleSection() {
  const t = useTokens();
  const styles = useStyles();
  const haptics = useHaptics();
  const user = useAuthStore((s) => s.user);
  const setPublicSchedule = useAuthStore((s) => s.setPublicSchedule);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!user) return null;
  const on = user.publicSchedule === true;

  const onChange = async (next: boolean) => {
    haptics.select();
    setSaving(true);
    setError(null);
    try {
      await setPublicSchedule(next);
    } catch {
      setError("Couldn't update your public schedule page. Try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <View style={styles.rowIcon}>
          <Ionicons name="globe-outline" size={20} color={t.colors.text.secondary} />
        </View>
        <View style={styles.rowBody}>
          <Text style={styles.rowTitle}>Public schedule page</Text>
          <Text style={styles.rowHint}>Anyone with the link can see your picks. Turning it off hides this link; picks links you already shared keep working.</Text>
        </View>
        <AppSwitch
          value={on}
          disabled={saving}
          onValueChange={(v) => void onChange(v)}
          accessibilityLabel="Public schedule page"
          accessibilityState={{ checked: on }}
          testID="public-schedule-switch"
        />
      </View>
      {on ? (
        <Text style={styles.link} selectable numberOfLines={1}>
          {buildPublicScheduleUrl(user.username)}
        </Text>
      ) : null}
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
  error: {
    ...typeStyle('caption'),
    color: t.colors.text.danger,
    paddingHorizontal: t.spacing[4],
    paddingBottom: t.spacing[3],
  },
}));
