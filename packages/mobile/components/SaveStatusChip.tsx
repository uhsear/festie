import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSaveStatus } from '@festie/shared/hooks';
import type { SaveStatusKind } from '@festie/shared/utils';
import { useTokens, makeStyles, typeStyle, MAX_FONT_SCALE } from '../hooks/useTokens';

const ICONS: Record<SaveStatusKind, keyof typeof Ionicons.glyphMap> = {
  saved: 'checkmark',
  saving: 'sync',
  syncing: 'sync',
  offline: 'cloud-offline-outline',
  failed: 'alert-circle',
};

/** Lineup header save state: Saving, Saved, Syncing, Offline or Not saved. Renders nothing when idle. */
export default function SaveStatusChip() {
  const status = useSaveStatus();
  const t = useTokens();
  const styles = useStyles();
  if (!status) return null;

  // Amber for offline and failed; coral is reserved for danger and SOS.
  const warn = status.kind === 'offline' || status.kind === 'failed';
  const color = warn ? t.colors.accent.amber : t.colors.text.muted;

  return (
    <View
      style={[styles.chip, warn && styles.chipWarn]}
      accessibilityRole="text"
      accessibilityLabel={status.label}
      accessibilityLiveRegion="polite"
    >
      <Ionicons name={ICONS[status.kind]} size={12} color={color} />
      <Text style={[styles.text, { color }]} maxFontSizeMultiplier={MAX_FONT_SCALE}>
        {status.label}
      </Text>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[1],
    paddingHorizontal: t.spacing[2],
    paddingVertical: t.spacing[1],
    borderRadius: t.radii.pill,
  },
  chipWarn: {
    backgroundColor: t.colors.amberAlpha[12],
  },
  text: {
    ...typeStyle('caption'),
  },
}));
