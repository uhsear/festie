import { View, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { useFestivalReady } from '@festie/shared/hooks';
import { FESTIVAL_READY_COPY } from '@festie/shared/constants';
import type { FestivalReadyKey } from '@festie/shared/utils';
import { makeStyles, typeStyle, useTokens, MAX_FONT_SCALE } from '../hooks/useTokens';
import AppPressable from './AppPressable';

type Route = '/(tabs)/crew' | '/(tabs)/account' | '/(tabs)/picks';

// `picks` has no destination: the sets are right below the card.
const DESTINATION: Partial<Record<FestivalReadyKey, Route>> = {
  crew: '/(tabs)/crew',
  reminders: '/(tabs)/account',
  offline: '/(tabs)/picks',
};

interface Props {
  ready: ReturnType<typeof useFestivalReady>;
}

/**
 * First-run checklist shown on home before the festival starts. The rules live
 * in shared (`useFestivalReady`); this only renders them. The caller owns the hook.
 */
export default function FestivalReadyCard({ ready }: Props) {
  const t = useTokens();
  const styles = useStyles();
  const router = useRouter();

  if (!ready.visible) return null;

  const { items, doneCount, total, progressLabel } = ready;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.title} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            {FESTIVAL_READY_COPY.title}
          </Text>
          <Text style={styles.progressText} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            {progressLabel}
          </Text>
        </View>
        <AppPressable
          style={styles.hideButton}
          onPress={ready.hide}
          accessibilityRole="button"
          accessibilityLabel={FESTIVAL_READY_COPY.hideA11y}
        >
          <Text style={styles.hideText} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            {FESTIVAL_READY_COPY.hide}
          </Text>
        </AppPressable>
      </View>

      <View
        style={styles.barTrack}
        accessibilityRole="progressbar"
        accessibilityLabel={progressLabel}
        accessibilityValue={{ min: 0, max: total, now: doneCount }}
      >
        <View style={[styles.barFill, { width: `${(doneCount / total) * 100}%` }]} />
      </View>

      <View style={styles.rows}>
        {items.map((item) => {
          const destination = item.done ? undefined : DESTINATION[item.key];
          const body = (
            <>
              <Ionicons
                name={item.done ? 'checkmark-circle' : 'ellipse-outline'}
                size={20}
                color={item.done ? t.colors.accent.aqua : t.colors.text.muted}
              />
              <View style={styles.rowText}>
                <Text
                  style={[styles.rowLabel, !item.done && styles.rowLabelPending]}
                  maxFontSizeMultiplier={MAX_FONT_SCALE}
                >
                  {item.label}
                </Text>
                {item.done ? null : (
                  <Text style={styles.rowHint} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                    {item.hint}
                  </Text>
                )}
              </View>
              {destination ? <Ionicons name="chevron-forward" size={16} color={t.colors.text.muted} /> : null}
            </>
          );
          return destination ? (
            <AppPressable
              key={item.key}
              style={styles.row}
              onPress={() => router.push(destination)}
              accessibilityRole="button"
              accessibilityLabel={item.a11y}
            >
              {body}
            </AppPressable>
          ) : (
            <View key={item.key} style={styles.row} accessibilityLabel={item.a11y}>
              {body}
            </View>
          );
        })}
      </View>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  card: {
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
    padding: t.spacing[4],
    marginBottom: t.spacing[3],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: t.spacing[3],
  },
  headerText: {
    flex: 1,
    gap: t.spacing[1],
  },
  title: {
    ...typeStyle('title'),
    color: t.colors.text.primary,
  },
  progressText: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
  },
  hideButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hideText: {
    ...typeStyle('label', 600),
    color: t.colors.text.secondary,
  },
  barTrack: {
    height: 4,
    borderRadius: 9999,
    backgroundColor: t.colors.border.default,
    overflow: 'hidden',
    marginTop: t.spacing[2],
  },
  barFill: {
    height: '100%',
    borderRadius: 9999,
    backgroundColor: t.colors.accent.aqua,
  },
  rows: {
    marginTop: t.spacing[2],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[3],
    minHeight: 44,
    paddingVertical: t.spacing[2],
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  rowLabel: {
    ...typeStyle('label'),
    color: t.colors.text.primary,
  },
  rowLabelPending: {
    ...typeStyle('label', 600),
  },
  rowHint: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
  },
}));
