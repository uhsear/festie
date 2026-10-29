import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useUIStore } from '@festie/shared/stores';
import { FAILED_ROW_LABEL, PENDING_ROW_LABEL, rowSyncState } from '@festie/shared/utils';
import { makeStyles, typeStyle, useTokens, MAX_FONT_SCALE } from '../hooks/useTokens';

/**
 * Row marker for a crew write that has not reached the server. A queued row
 * reads "Not sent yet"; a failed replay points at the PendingSyncSheet, which
 * the offline banner opens. Renders nothing for a synced row.
 */
export default function CrewSyncMarker({ item }: { item: { id: string; _optimistic?: boolean } }) {
  const t = useTokens();
  const styles = useStyles();
  const failedIds = useUIStore((s) => s.failedSync).map((f) => f.clientId);
  const state = rowSyncState(item, failedIds);
  if (!state) return null;
  const failed = state === 'failed';
  const color = failed ? t.colors.accent.amber : t.colors.text.secondary;
  return (
    <View style={styles.row} accessible accessibilityLabel={failed ? FAILED_ROW_LABEL : PENDING_ROW_LABEL}>
      <Ionicons name={failed ? 'alert-circle-outline' : 'cloud-offline-outline'} size={12} color={color} />
      <Text style={[styles.text, { color }]} maxFontSizeMultiplier={MAX_FONT_SCALE}>
        {failed ? FAILED_ROW_LABEL : PENDING_ROW_LABEL}
      </Text>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[1],
  },
  text: {
    ...typeStyle('caption'),
    flexShrink: 1,
  },
}));
