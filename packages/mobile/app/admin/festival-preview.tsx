import { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fetchFestivalPreview } from '@festie/shared/services';
import { useAuthStore } from '@festie/shared/stores';
import { resolveStageColor, type FestivalPreview } from '@festie/shared/utils';
import SectionLabel from '../../components/SectionLabel';
import EmptyState from '../../components/EmptyState';
import LoadingState from '../../components/LoadingState';
import { makeStyles, typeStyle, useTokens } from '../../hooks/useTokens';

/**
 * Admin festival preview — a read-only view of what attendees see for one
 * festival: day-by-day sets, data warnings, and the stage list.
 *
 * Reached from the Festivals card on /admin (?id=). Reads GET /festivals/:id
 * through fetchFestivalPreview and never touches the festival store, so the
 * admin's own active festival does not change.
 *
 * Gated on useAuthStore isAdmin; a non-admin sees an "Admins only" EmptyState.
 */

export default function AdminFestivalPreviewScreen() {
  const t = useTokens();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const isAdmin = useAuthStore((s) => s.isAdmin);

  const [preview, setPreview] = useState<FestivalPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [dayKey, setDayKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setError(false);
    try {
      const next = await fetchFestivalPreview(id);
      setPreview(next);
      setDayKey((prev) => (prev && next.days.some((d) => d.key === prev) ? prev : (next.days[0]?.key ?? null)));
    } catch {
      setError(true);
    }
  }, [id]);

  useEffect(() => {
    if (!isAdmin || !id) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- load-once guard: nothing to fetch, so clear the initial loading flag. Tied to the fetch lifecycle, not derivable from render inputs.
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    load().finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [isAdmin, id, load]);

  if (!isAdmin) {
    return (
      <View style={styles.screen}>
        <Stack.Screen options={{ headerShown: true, title: 'Preview' }} />
        <EmptyState
          icon="lock-closed-outline"
          title="Admins only"
          message="This area is restricted to festival administrators."
        />
      </View>
    );
  }

  const day = preview?.days.find((d) => d.key === dayKey) ?? null;

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ headerShown: true, title: 'Preview' }} />
      {loading ? (
        <LoadingState label="Loading preview" />
      ) : error || !id || !preview ? (
        <EmptyState
          icon="cloud-offline-outline"
          title="Couldn't load the preview"
          message="Something went wrong reaching the server."
          action={id ? { label: 'Try again', onPress: () => void load() } : undefined}
        />
      ) : (
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            { paddingBottom: Math.max(t.spacing[6], insets.bottom + t.spacing[2]) },
          ]}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.title} accessibilityRole="header">
            Preview: {preview.name}
          </Text>
          <Text style={styles.hint}>
            What attendees see. Read-only. Your own festival does not change.
          </Text>
          {preview.dateRange || preview.location ? (
            <Text style={styles.hint}>{[preview.dateRange, preview.location].filter(Boolean).join(' · ')}</Text>
          ) : null}

          {preview.warnings.length > 0 ? (
            <View style={styles.warnCard} accessibilityRole="alert">
              {preview.warnings.map((w) => (
                <Text key={w} style={styles.warnText}>
                  {w}
                </Text>
              ))}
            </View>
          ) : null}

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {preview.days.map((d) => {
              const selected = d.key === dayKey;
              return (
                <TouchableOpacity
                  key={d.key}
                  style={[styles.chip, selected && styles.chipActive]}
                  onPress={() => setDayKey(d.key)}
                  accessibilityRole="button"
                  accessibilityLabel={d.label}
                  accessibilityState={{ selected }}
                >
                  <Text style={[styles.chipLabel, selected && styles.chipLabelActive]}>{d.label}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <View style={styles.card}>
            {day && day.sets.length > 0 ? (
              day.sets.map((s, i) => (
                <View key={s.id} style={[styles.row, i < day.sets.length - 1 && styles.rowDivider]}>
                  <View
                    style={[styles.dot, { backgroundColor: resolveStageColor(s.stageColor, t.colors.text.muted) }]}
                  />
                  <View style={styles.rowBody}>
                    <Text style={styles.rowTitle}>{s.artist}</Text>
                    <Text style={styles.hint}>
                      {s.time}
                      {s.stageName ? ` · ${s.stageName}` : ''}
                    </Text>
                  </View>
                </View>
              ))
            ) : (
              <View style={styles.row}>
                <Text style={styles.hint}>No sets on this day.</Text>
              </View>
            )}
          </View>

          <SectionLabel>Stages</SectionLabel>
          <View style={styles.card}>
            {preview.stages.length > 0 ? (
              preview.stages.map((s, i) => (
                <View key={s.id} style={[styles.row, i < preview.stages.length - 1 && styles.rowDivider]}>
                  <View
                    style={[styles.dot, { backgroundColor: resolveStageColor(s.color, t.colors.text.muted) }]}
                  />
                  <View style={styles.rowBody}>
                    <Text style={styles.rowTitle}>{s.name}</Text>
                  </View>
                  <Text style={styles.hint}>{s.pinned ? 'On map' : 'No map pin'}</Text>
                </View>
              ))
            ) : (
              <View style={styles.row}>
                <Text style={styles.hint}>No stages</Text>
              </View>
            )}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  screen: {
    flex: 1,
    backgroundColor: t.colors.bg.primary,
  },
  scroll: {
    width: '100%',
    maxWidth: 600,
    alignSelf: 'center',
    paddingHorizontal: t.spacing[4],
    paddingTop: t.spacing[3],
    gap: t.spacing[2],
  },
  title: {
    ...typeStyle('heading'),
    color: t.colors.text.primary,
  },
  hint: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  warnCard: {
    backgroundColor: t.colors.bg.secondary,
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    padding: t.spacing[3],
    gap: t.spacing[1],
  },
  warnText: {
    ...typeStyle('caption'),
    color: t.colors.text.primary,
  },
  chips: {
    gap: t.spacing[2],
    paddingVertical: t.spacing[2],
  },
  chip: {
    minHeight: 44,
    paddingHorizontal: t.spacing[4],
    borderRadius: t.radii.default,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
  },
  chipActive: {
    borderColor: t.colors.accent.aqua,
    backgroundColor: t.colors.ring.aqua,
  },
  chipLabel: {
    ...typeStyle('label', 600),
    color: t.colors.text.secondary,
  },
  chipLabelActive: {
    color: t.colors.accent.aqua,
  },
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
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
}));
