import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore, useFestivalDataStore } from '@festie/shared/stores';
import { offlineStatusLabel } from '@festie/shared/utils';
import { useTokens, makeStyles, typeStyle, MAX_FONT_SCALE } from '../hooks/useTokens';
import { useOfflineDownload } from '../hooks/useOfflineDownload';
import { useOfflinePackReminder } from '../hooks/useOfflinePackReminder';

/**
 * One-line offline status for a festival surface. "Available offline · synced
 * 5m ago" when saved, otherwise a button that starts the same download as the
 * My Picks card. Renders nothing for a guest, with no festival, or when the
 * festival is over and nothing was saved. With `remind`, it also schedules the
 * day-before offline reminder; pass it on one surface only.
 */
export default function OfflineStatusChip({ remind = false }: { remind?: boolean }) {
  const user = useAuthStore((s) => s.user);
  const festivalId = useFestivalDataStore((s) => s.currentFestival?.id ?? null);
  if (!user || !festivalId) return null;
  return <Chip festivalId={festivalId} remind={remind} />;
}

function Chip({ festivalId, remind }: { festivalId: string; remind: boolean }) {
  const t = useTokens();
  const styles = useStyles();
  const { summary, download, isDownloading, hasMap } = useOfflineDownload(festivalId);
  // Only one surface (the festival home) owns the day-before reminder.
  useOfflinePackReminder(festivalId, summary.overall === 'ready', remind, hasMap);

  if (summary.hidden) return null;

  const { overall } = summary;
  // Coral and "incomplete" only when a step failed; unsaved steps are neutral.
  const failed = overall === 'partial' && summary.hasError;
  const label = failed ? 'Offline download incomplete · Retry' : offlineStatusLabel(summary);
  const a11yLabel =
    overall === 'partial' && summary.pending.length ? `${label}. Not saved yet: ${summary.pending.join(', ')}` : label;
  const icon = overall === 'ready' ? 'checkmark-circle' : failed ? 'alert-circle' : 'download-outline';
  const iconColor = overall === 'ready' ? t.colors.accent.aqua : failed ? t.colors.accent.coral : t.colors.text.muted;

  const content = (
    <>
      <View style={styles.chipBg} pointerEvents="none" />
      <Ionicons name={icon} size={14} color={iconColor} />
      {/* Trailing NBSP absorbs Fabric's single-line under-measure (see FreshnessChip). */}
      <Text style={styles.chipText} maxFontSizeMultiplier={MAX_FONT_SCALE} textBreakStrategy="simple">
        {label + '\u00A0'}
      </Text>
    </>
  );

  if (overall === 'ready') {
    return (
      <View style={styles.row}>
        <View style={styles.chip} accessibilityRole="text" accessibilityLabel={label}>
          {content}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.row}>
      <TouchableOpacity
        style={[styles.chip, styles.chipButton]}
        onPress={download}
        disabled={isDownloading}
        accessibilityRole="button"
        accessibilityLabel={a11yLabel}
        accessibilityState={{ busy: isDownloading, disabled: isDownloading }}
        activeOpacity={0.8}
      >
        {content}
      </TouchableOpacity>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[1],
  },
  chipButton: {
    minHeight: 44,
  },
  // Bg lives on an absolutely-positioned sibling so the Text is never clipped
  // to the rounded bounds on Android (same pattern as FreshnessChip).
  chipBg: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderRadius: t.radii.pill,
    backgroundColor: t.colors.bg.secondary,
  },
  chipText: {
    ...typeStyle('caption'),
    color: t.colors.text.primary,
    flexShrink: 1,
  },
}));
