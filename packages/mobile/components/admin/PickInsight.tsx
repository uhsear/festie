import { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Alert } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { fetchAdminPickInsight } from '@festie/shared/services';
import {
  pickClashRows,
  picksPerSetCsv,
  picksCsvFileName,
  type PickInsight as PickInsightData,
} from '@festie/shared/utils';
import { makeStyles, typeStyle, MAX_FONT_SCALE } from '../../hooks/useTokens';
import SectionLabel from '../SectionLabel';

/**
 * Admin Analytics: clashing picks for one festival, plus a per-set picks CSV.
 * Counts only; the server enforces the minimum pair size. A failed load shows
 * the error and a Retry inside the card, never in place of the screen.
 */
export default function PickInsight({ festivalId, refreshToken }: { festivalId: string; refreshToken: number }) {
  const styles = useStyles();
  const [data, setData] = useState<PickInsightData | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    /* eslint-disable react-hooks/set-state-in-effect -- reset to the loading state when the festival, refresh token or retry changes; tied to the fetch lifecycle. */
    setError(false);
    setData(null);
    /* eslint-enable react-hooks/set-state-in-effect */
    fetchAdminPickInsight(festivalId)
      .then((next) => {
        if (!cancelled) setData(next);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [festivalId, refreshToken, retry]);

  const handleExport = useCallback(async () => {
    if (exporting || !data) return;
    setExporting(true);
    try {
      const file = new File(Paths.cache, picksCsvFileName(festivalId));
      file.create({ overwrite: true });
      file.write(picksPerSetCsv(data));
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri, {
          mimeType: 'text/csv',
          UTI: 'public.comma-separated-values-text',
          dialogTitle: 'Export picks per set',
        });
        Alert.alert('Picks exported', `Exported ${data.sets.length} sets.`);
      } else {
        Alert.alert('Sharing unavailable', 'File sharing is not available on this device.');
      }
    } catch {
      Alert.alert("Couldn't export picks. Try again.");
    } finally {
      setExporting(false);
    }
  }, [exporting, data, festivalId]);

  const rows = data ? pickClashRows(data) : [];

  return (
    <>
      <SectionLabel>Clashing picks</SectionLabel>
      {data ? (
        <Text style={styles.rowHint}>
          {`Sets that overlap in time, ranked by how many people picked both. Pairs picked by fewer than ${data.minPairPeople} people are hidden.`}
        </Text>
      ) : null}
      <View style={styles.card}>
        {error ? (
          <View style={styles.row}>
            <View style={styles.rowBody}>
              <Text style={styles.rowTitle} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                {"Couldn't load clashing picks."}
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => setRetry((n) => n + 1)}
              style={styles.retryBtn}
              accessibilityRole="button"
              accessibilityLabel="Retry"
            >
              <Text style={styles.retryText} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                Retry
              </Text>
            </TouchableOpacity>
          </View>
        ) : !data ? (
          <View style={styles.row}>
            <Text style={styles.rowHint}>Loading…</Text>
          </View>
        ) : rows.length === 0 ? (
          <View style={styles.row}>
            <Text style={styles.rowHint}>{`No clash was picked by ${data.minPairPeople} or more people yet.`}</Text>
          </View>
        ) : (
          rows.map((row, i) => (
            <View
              key={row.key}
              style={[styles.row, i < rows.length - 1 && styles.rowDivider]}
              accessible
              accessibilityRole="text"
              accessibilityLabel={row.a11y}
            >
              <View style={styles.rowBody}>
                <Text style={styles.rowTitle} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                  {row.title}
                </Text>
                <Text style={styles.rowHint} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                  {row.detail}
                </Text>
                <Text style={styles.rowHint} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                  {row.peopleText}
                </Text>
                <View style={styles.barTrack} importantForAccessibility="no-hide-descendants">
                  <View style={[styles.barFill, { width: `${row.barPct}%` }]} />
                </View>
              </View>
            </View>
          ))
        )}
      </View>
      <TouchableOpacity
        onPress={handleExport}
        disabled={!data || exporting}
        style={[styles.exportBtn, (!data || exporting) && styles.exportBtnDisabled]}
        accessibilityRole="button"
        accessibilityLabel="Export picks per set"
        accessibilityHint="One row per set, with counts only. No names or user IDs."
        accessibilityState={{ busy: exporting, disabled: !data }}
      >
        <Text style={styles.exportText} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          {exporting ? 'Exporting…' : 'Export picks per set'}
        </Text>
      </TouchableOpacity>
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
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[3],
    paddingHorizontal: t.spacing[4],
    paddingVertical: t.spacing[3],
    minHeight: 56,
  },
  rowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: t.colors.border.default,
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
  barTrack: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
    backgroundColor: t.colors.bg.primary,
  },
  barFill: {
    height: 6,
    backgroundColor: t.colors.accent.aqua,
  },
  retryBtn: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: t.spacing[3],
  },
  retryText: {
    ...typeStyle('label', 600),
    color: t.colors.accent.aqua,
  },
  exportBtn: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.accent.aqua,
    paddingHorizontal: t.spacing[4],
  },
  exportBtnDisabled: {
    opacity: 0.5,
  },
  exportText: {
    ...typeStyle('label', 600),
    color: t.colors.accent.aqua,
  },
}));
