import { useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { DATA_COPY } from '@festie/shared/constants';
import { exportErrorMessage } from '@festie/shared/services';
import { useUIStore } from '@festie/shared/stores';
import { makeStyles, typeStyle, useTokens } from '../hooks/useTokens';
import { useHaptics } from '../hooks/useHaptics';
import { shareAccountExport } from '../lib/exportData';

/**
 * Data download for the Account screen — the mobile analog of the web "Download my data"
 * card. shareAccountExport() fetches GET /account/export, writes a JSON file to the cache
 * directory and opens the OS share sheet. The server allows one export a day;
 * exportErrorMessage turns the 429 into plain words with a local time.
 */
export default function AccountDataSection() {
  const t = useTokens();
  const styles = useStyles();
  const haptics = useHaptics();
  const offlineMode = useUIStore((s) => s.offlineMode);
  const [busy, setBusy] = useState(false);

  const handleExport = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await shareAccountExport();
      haptics.success();
    } catch (err) {
      haptics.warning();
      Alert.alert(DATA_COPY.title, exportErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const disabled = busy || offlineMode;

  return (
    <View style={styles.card}>
      <TouchableOpacity
        style={styles.row}
        onPress={() => void handleExport()}
        disabled={disabled}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel="Download my data"
        accessibilityState={{ disabled, busy }}
      >
        <View style={styles.rowIcon}>
          <Ionicons name="download-outline" size={20} color={t.colors.text.secondary} />
        </View>
        <View style={styles.rowBody}>
          <Text style={styles.rowTitle}>{DATA_COPY.title}</Text>
          <Text style={styles.rowHint}>{busy ? DATA_COPY.busy : DATA_COPY.hint}</Text>
        </View>
        {busy ? (
          <ActivityIndicator size="small" color={t.colors.accent.aqua} />
        ) : (
          <Ionicons name="share-outline" size={18} color={t.colors.text.placeholder} />
        )}
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
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[3],
    paddingHorizontal: t.spacing[4],
    paddingVertical: t.spacing[3],
    minHeight: 56,
  },
  rowIcon: {
    width: 24,
    alignItems: 'center',
  },
  rowBody: {
    flex: 1,
    gap: t.spacing[1],
  },
  rowTitle: {
    ...typeStyle('body'),
    color: t.colors.text.primary,
  },
  rowHint: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
}));
