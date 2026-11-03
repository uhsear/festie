import { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, RefreshControl, TouchableOpacity } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fetchAdminAnalytics } from '@festie/shared/services';
import { useAuthStore } from '@festie/shared/stores';
import {
  timeAgoFromIso,
  analyticsQuestions,
  analyticsScopeLine,
  funnelSteps,
  formatDate,
  type AnalyticsData,
} from '@festie/shared/utils';
import { makeStyles, typeStyle, useTokens, MAX_FONT_SCALE } from '../../hooks/useTokens';
import DisplayWords from '../../components/DisplayWords';
import EmptyState from '../../components/EmptyState';
import LoadingState from '../../components/LoadingState';
import SectionLabel from '../../components/SectionLabel';
import PickInsight from '../../components/admin/PickInsight';

/**
 * Admin Analytics — mobile mirror of the web AdminAnalytics dashboard.
 *
 * Renders, for all festivals or one (festival pills):
 *   the scope line, named questions, the sign-up funnel, pick priority, top sets,
 *   clashing picks with a per-set CSV export (one festival only, PickInsight),
 *   festivals (tap to filter), recently active people and largest crews.
 *
 * Totals come from the server (GET /admin/analytics, via fetchAdminAnalytics);
 * the lists are samples and their headings say so. A failed load shows the
 * error state, never zeros.
 *
 * Gated on isAdmin; the AuthGate on the admin segment also enforces this.
 */

/** Simple inline bar: three segments sized by proportion. */
function PickBar({
  must,
  want,
  maybe,
}: {
  must: number;
  want: number;
  maybe: number;
}) {
  const t = useTokens();
  const total = must + want + maybe;
  if (total === 0) return null;
  const mustW = must / total;
  const wantW = want / total;
  const maybeW = maybe / total;
  return (
    <View
      style={{ flexDirection: 'row', height: 8, borderRadius: 4, overflow: 'hidden', marginTop: t.spacing[2] }}
      accessibilityLabel={`Pick distribution: must ${Math.round(mustW * 100)}%, want ${Math.round(wantW * 100)}%, maybe ${Math.round(maybeW * 100)}%`}
      accessibilityRole="image"
    >
      {mustW > 0 ? (
        <View style={{ flex: mustW, backgroundColor: t.colors.accent.coralStrong }} />
      ) : null}
      {wantW > 0 ? (
        <View style={{ flex: wantW, backgroundColor: t.colors.accent.aqua }} />
      ) : null}
      {maybeW > 0 ? (
        <View style={{ flex: maybeW, backgroundColor: t.colors.text.muted }} />
      ) : null}
    </View>
  );
}

export default function AdminAnalyticsScreen() {
  const t = useTokens();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const isAdmin = useAuthStore((s) => s.isAdmin);

  const [data, setData] = useState<AnalyticsData | null>(null);
  const [festivalId, setFestivalId] = useState<string | undefined>(undefined);
  // Pills come from the all-festivals load, so they stay put when a scoped load returns one festival.
  const [pills, setPills] = useState<{ id?: string; name: string }[]>([{ name: 'All festivals' }]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);

  const fetchAnalytics = useCallback(async () => {
    setError(false);
    try {
      const next = await fetchAdminAnalytics(festivalId);
      setData(next);
      if (!next.scope.festivalId) {
        setPills([{ name: 'All festivals' }, ...next.festivalStats.map((f) => ({ id: f.id, name: f.name }))]);
      }
    } catch {
      setError(true);
      setData(null);
    }
  }, [festivalId]);

  useEffect(() => {
    if (!isAdmin) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- load-once guard: non-admins have nothing to fetch, so clear the initial loading flag. Tied to the fetch lifecycle, not derivable from render inputs.
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchAnalytics().finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [isAdmin, fetchAnalytics]);

  const onRefresh = useCallback(() => {
    setRefreshToken((n) => n + 1);
    setRefreshing(true);
    void fetchAnalytics().finally(() => setRefreshing(false));
  }, [fetchAnalytics]);

  if (!isAdmin) {
    return (
      <View style={styles.screen}>
        <Stack.Screen options={{ headerShown: false }} />
        <EmptyState
          icon="lock-closed-outline"
          title="Admins only"
          message="This area is restricted to festival administrators."
        />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + t.spacing[4] }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backButton}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="chevron-back" size={t.iconSize.md} color={t.colors.accent.aqua} />
        </TouchableOpacity>
        <Text
          style={styles.headerTitle}
          numberOfLines={1}
          adjustsFontSizeToFit
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          accessibilityRole="header"
        >
          <DisplayWords text="Analytics" fontSize={styles.headerTitle.fontSize} />
        </Text>
        {!loading && !error ? (
          <TouchableOpacity
            onPress={onRefresh}
            style={styles.refreshBtn}
            accessibilityRole="button"
            accessibilityLabel="Refresh analytics"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="refresh-outline" size={t.iconSize.md} color={t.colors.text.secondary} />
          </TouchableOpacity>
        ) : (
          <View style={styles.refreshBtn} />
        )}
      </View>

      {loading ? (
        <LoadingState label="Loading analytics" />
      ) : error && !data ? (
        <EmptyState
          icon="cloud-offline-outline"
          title="Couldn't load analytics"
          message="Something went wrong reaching the server."
          action={{ label: 'Try again', onPress: onRefresh }}
        />
      ) : data ? (
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            { paddingBottom: Math.max(t.spacing[6], insets.bottom + t.spacing[2]) },
          ]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={t.colors.accent.aqua}
              colors={[t.colors.accent.aqua]}
            />
          }
        >
          {/* ── Festival filter ───────────────────────────────── */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.pillRow}
            style={styles.pillScroll}
          >
            {pills.map((f) => {
              const selected = f.id === festivalId;
              return (
                <TouchableOpacity
                  key={f.id ?? 'all'}
                  style={[styles.filterPill, selected && styles.filterPillActive]}
                  onPress={() => setFestivalId(f.id)}
                  accessibilityRole="button"
                  accessibilityLabel={f.name}
                  accessibilityState={{ selected }}
                >
                  <Text style={[styles.filterPillText, selected && styles.filterPillTextActive]} numberOfLines={1}>
                    {f.name}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <Text style={styles.scopeLine}>{analyticsScopeLine(data)}</Text>

          {/* ── Questions ─────────────────────────────────────── */}
          <SectionLabel>Questions</SectionLabel>
          <View style={styles.card}>
            {analyticsQuestions(data).map((q, i, arr) => (
              <View
                key={q.id}
                style={[styles.row, i < arr.length - 1 && styles.rowDivider]}
                accessibilityRole="text"
                accessibilityLabel={`${q.question} ${q.answer}`}
              >
                <View style={styles.rowBody}>
                  <Text style={styles.rowTitle}>{q.question}</Text>
                  <Text style={styles.rowHint}>{q.answer}</Text>
                </View>
              </View>
            ))}
          </View>

          {/* ── Funnel ────────────────────────────────────────── */}
          <SectionLabel>Where do people drop off?</SectionLabel>
          <Text style={styles.rowHint}>
            Each step counts people. A step can be larger than the one before it, for example when someone joins a crew
            before picking.
          </Text>
          <View style={styles.card}>
            {funnelSteps(data).map((step, i, arr) => (
              <View
                key={step.label}
                style={[styles.section, i < arr.length - 1 && styles.rowDivider]}
                accessibilityRole="text"
                accessibilityLabel={`${step.label}: ${step.count}, ${step.pctOfStart} of sign-ups`}
              >
                <Text style={styles.rowTitle}>{step.label}</Text>
                <View style={styles.barTrack}>
                  <View style={[styles.barFill, { width: `${Math.min(100, parseInt(step.pctOfStart, 10) || 0)}%` }]} />
                </View>
                <Text style={styles.rowHint}>
                  {step.count} · {step.pctOfStart} of sign-ups
                </Text>
              </View>
            ))}
          </View>

          {/* ── Pick priority ─────────────────────────────────── */}
          <SectionLabel>{`Pick priority across all ${data.totals.picks} picks`}</SectionLabel>
          <View style={styles.card}>
            <View style={styles.section}>
              <PickBar
                must={data.pickDistribution.must}
                want={data.pickDistribution.want}
                maybe={data.pickDistribution.maybe}
              />
              <View style={styles.legendRow}>
                <LegendDot color={t.colors.accent.coralStrong} label={`Must (${data.pickDistribution.must})`} />
                <LegendDot color={t.colors.accent.aqua} label={`Want (${data.pickDistribution.want})`} />
                <LegendDot color={t.colors.text.muted} label={`Maybe (${data.pickDistribution.maybe})`} />
              </View>
            </View>
          </View>

          {/* ── Top sets ──────────────────────────────────────── */}
          {data.topSets.length > 0 ? (
            <>
              <SectionLabel>Most-picked sets (top 20)</SectionLabel>
              <View style={styles.card}>
                {data.topSets.slice(0, 20).map((s, i, arr) => (
                  <View
                    key={`${s.artist}-${s.festivalId}-${i}`}
                    style={[styles.row, i < arr.length - 1 && styles.rowDivider]}
                    accessibilityRole="text"
                    accessibilityLabel={`${s.artist}, ${s.festivalName}${s.dayLabel ? `, ${s.dayLabel}` : ''}: ${s.pickCount} picks`}
                  >
                    <View style={styles.rowBody}>
                      <Text style={styles.rowTitle} numberOfLines={1}>
                        {s.artist}
                      </Text>
                      <Text style={styles.rowHint} numberOfLines={1}>
                        {[s.festivalName, s.dayLabel].filter(Boolean).join(' · ')}
                      </Text>
                      <Text style={styles.rowHint} numberOfLines={1}>
                        {s.mustCount} must · {s.wantCount} want · {s.maybeCount} maybe
                      </Text>
                    </View>
                    <View style={styles.pill}>
                      <Text style={styles.pillText}>{s.pickCount}</Text>
                    </View>
                  </View>
                ))}
              </View>
            </>
          ) : null}

          {/* ── Clashing picks ────────────────────────────────── */}
          {festivalId ? (
            <PickInsight festivalId={festivalId} refreshToken={refreshToken} />
          ) : (
            <Text style={styles.rowHint}>Choose a festival to see clashing picks and export picks per set.</Text>
          )}

          {/* ── Festivals ─────────────────────────────────────── */}
          {data.festivalStats.length > 0 ? (
            <>
              <SectionLabel>Festivals</SectionLabel>
              <View style={styles.card}>
                {data.festivalStats.map((f, i) => (
                  <TouchableOpacity
                    key={f.id}
                    style={[styles.row, i < data.festivalStats.length - 1 && styles.rowDivider]}
                    onPress={() => setFestivalId(f.id)}
                    accessibilityRole="button"
                    accessibilityLabel={`${f.name}: ${f.profileCount} festival plans, ${f.totalPicks} picks. Show only this festival.`}
                  >
                    <View style={styles.rowBody}>
                      <Text style={styles.rowTitle} numberOfLines={1}>
                        {f.name}
                      </Text>
                      <Text style={styles.rowHint} numberOfLines={1}>
                        {f.profileCount} plans · {f.uniqueSetsPicked} sets · {f.totalPicks} picks
                      </Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          ) : null}

          {/* ── Recently active people ────────────────────────── */}
          {data.activeUsers.length > 0 ? (
            <>
              <SectionLabel>Most recently active people (latest 50)</SectionLabel>
              <View style={styles.card}>
                {data.activeUsers.map((u, i, arr) => (
                  <View
                    key={u.id}
                    style={[styles.row, i < arr.length - 1 && styles.rowDivider]}
                    accessibilityRole="text"
                    accessibilityLabel={`${u.username}: ${u.totalPicks} picks, last active ${timeAgoFromIso(u.lastActive)}`}
                  >
                    <View style={styles.rowBody}>
                      <Text style={styles.rowTitle} numberOfLines={1}>
                        {u.username}
                      </Text>
                      <Text style={styles.rowHint} numberOfLines={1}>
                        {u.profileCount} plan{u.profileCount !== 1 ? 's' : ''} · {u.totalPicks} picks · {timeAgoFromIso(u.lastActive)}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            </>
          ) : null}

          {/* ── Largest crews ─────────────────────────────────── */}
          {data.crews.length > 0 ? (
            <>
              <SectionLabel>Largest crews (top 20)</SectionLabel>
              <View style={styles.card}>
                {data.crews.map((c, i) => (
                  <View
                    key={c.id}
                    style={[styles.row, i < data.crews.length - 1 && styles.rowDivider]}
                    accessibilityRole="text"
                    accessibilityLabel={`${c.name}: ${c.memberCount} members`}
                  >
                    <View style={styles.rowBody}>
                      <Text style={styles.rowTitle} numberOfLines={1}>
                        {c.name}
                      </Text>
                      <Text style={styles.rowHint} numberOfLines={1}>
                        {c.festivalName ? `${c.festivalName} · ` : ''}
                        {c.memberCount} member{c.memberCount !== 1 ? 's' : ''} · created {formatDate(c.createdAt)}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            </>
          ) : null}

          {data.generatedAt ? (
            <Text style={styles.generatedAt}>
              Generated {new Date(data.generatedAt).toLocaleString()}
            </Text>
          ) : null}
        </ScrollView>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Local sub-components
// ---------------------------------------------------------------------------

function LegendDot({ color, label }: { color: string; label: string }) {
  const styles = useLegendStyles();
  return (
    <View style={styles.item} accessibilityRole="text" accessibilityLabel={label}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const useLegendStyles = makeStyles((t) => ({
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[1],
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  label: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
}));

const useStyles = makeStyles((t) => ({
  screen: {
    flex: 1,
    backgroundColor: t.colors.bg.primary,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[3],
    paddingHorizontal: t.spacing[4],
    paddingBottom: t.spacing[4],
  },
  backButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  headerTitle: {
    ...typeStyle('heading'),
    lineHeight: undefined,
    color: t.colors.text.primary,
    flex: 1,
  },
  refreshBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  scroll: {
    width: '100%',
    maxWidth: 600,
    alignSelf: 'center',
    paddingHorizontal: t.spacing[4],
    paddingBottom: t.spacing[6],
    gap: t.spacing[2],
  },
  card: {
    backgroundColor: t.colors.bg.secondary,
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    overflow: 'hidden',
  },
  section: {
    paddingHorizontal: t.spacing[4],
    paddingVertical: t.spacing[4],
    gap: t.spacing[3],
  },
  legendRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: t.spacing[3],
    marginTop: t.spacing[1],
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
  pill: {
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[1],
    borderRadius: t.radii.pill,
    backgroundColor: t.colors.bg.primary,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    minWidth: 48,
    alignItems: 'center',
  },
  pillText: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  pillScroll: {
    flexGrow: 0,
  },
  pillRow: {
    gap: t.spacing[2],
  },
  filterPill: {
    minHeight: 44,
    paddingHorizontal: t.spacing[4],
    borderRadius: t.radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
  },
  filterPillActive: {
    borderColor: t.colors.accent.aqua,
    backgroundColor: t.colors.ring.aqua,
  },
  filterPillText: {
    ...typeStyle('label', 600),
    color: t.colors.text.secondary,
  },
  filterPillTextActive: {
    color: t.colors.accent.aqua,
  },
  scopeLine: {
    ...typeStyle('body'),
    color: t.colors.text.primary,
  },
  barTrack: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: t.colors.bg.primary,
  },
  barFill: {
    height: 8,
    backgroundColor: t.colors.accent.aqua,
  },
  generatedAt: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
    textAlign: 'right',
    marginTop: t.spacing[2],
  },
}));
