import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, RefreshControl, TouchableOpacity, Alert, useWindowDimensions } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  bulkArchiveFestivals,
  fetchAdminCrews,
  fetchAdminDashboard,
  fetchAdminFestivals,
  fetchAdminEnv,
  fetchArchivedFestivals,
  restoreFestival,
  withReauth,
} from '@festie/shared/services';
import type {
  AdminCrewRow,
  AdminDashboardData,
  AdminFestivalSummary,
  ArchivedFestival,
} from '@festie/shared/services';
import { useAuthStore } from '@festie/shared/stores';
import {
  timeAgoFromIso,
  auditActionLabel,
  dashboardStatRows,
  describeHealth,
  healthDetailRows,
  searchAdminTargets,
  toggleSelection,
  bulkConfirmCopy,
  summarizeBulkResults,
  SELECTION_LIMIT_MESSAGE,
} from '@festie/shared/utils';
import SectionLabel from '../../components/SectionLabel';
import EmptyState from '../../components/EmptyState';
import LoadingState from '../../components/LoadingState';
import { ConfirmDialog, LabeledTextInput, SelectionBar, useReauthPrompt } from '../../components/admin';
import { makeStyles, typeStyle, useTokens } from '../../hooks/useTokens';

/**
 * Admin home — the hub of the mobile admin console
 * (packages/web/src/components/admin). Top to bottom: a Find box (festivals,
 * users, crews, invite codes), the festival list (GET /admin/festivals, drafts
 * included, with an Archived view), the Admin actions links, five rows of
 * recent admin activity with a "See all" link to the audit screen, a one-line
 * stats summary that expands to the four counts, and a one-sentence health
 * line with a Details toggle. The full audit list lives on /admin/audit only.
 * This screen itself stays read-only; every destructive write
 * lives behind a dedicated, ConfirmDialog-gated sub-screen reached from the
 * "Admin actions" section or the per-festival row actions.
 *
 * Navigation (router.push, exact route strings — the screens exist so
 * expo-router typed routes resolve):
 *   /admin/users          — manage users
 *   /admin/crews          — manage crews
 *   /admin/analytics      — analytics
 *   /admin/audit          — full audit log
 *   /admin/festival-edit  — create (no id) or edit (?id=) a festival
 *   /admin/lineup-import?id=  — CSV lineup import for a festival
 *   /admin/festival-preview?id=  — read-only attendee schedule preview
 *   /admin/festival-map?id=   — festival map editor
 *   /admin/festival-links?id= — Spotify links for a festival's artists
 *
 * Gated on useAuthStore isAdmin; a non-admin sees an "Admins only" EmptyState.
 * The Festivals card has a Select mode: tick festivals, then Archive them through
 * a ConfirmDialog and a re-auth-wrapped POST /admin/bulk/archive-festivals.
 * Pull-to-refresh re-runs the GETs. Endpoints resolve under /api/v1:
 *   GET /admin/dashboard → { stats, health, recentActivity (enriched) }
 *   GET /admin/festivals → AdminFestivalSummary[] (drafts included)
 *   GET /admin/crews     → crew rows for the Find box (loaded once, on first text)
 *   GET /admin/env       → { label } (staging band; a failure hides the band)
 *   GET /admin/festivals/archived → deleted festivals, each with Restore
 */

const RECENT_ACTIVITY_ROWS = 5;
const LARGE_FONT_SCALE = 1.3;
const HEALTH_DETAILS_HEADING = 'This server process. A restart resets these numbers.';
const HEALTH_ICONS = {
  ok: 'checkmark-circle-outline',
  warn: 'warning-outline',
  unknown: 'help-circle-outline',
} as const;

export default function AdminScreen() {
  const t = useTokens();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const stacked = useWindowDimensions().fontScale > LARGE_FONT_SCALE;

  const [stats, setStats] = useState<AdminDashboardData['stats'] | null>(null);
  const [health, setHealth] = useState<AdminDashboardData['health'] | null>(null);
  const [activity, setActivity] = useState<AdminDashboardData['recentActivity']>([]);
  const [findText, setFindText] = useState('');
  const [crews, setCrews] = useState<AdminCrewRow[] | null>(null);
  const [crewsFailed, setCrewsFailed] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [healthOpen, setHealthOpen] = useState(false);
  const [festivals, setFestivals] = useState<AdminFestivalSummary[]>([]);
  const [envLabel, setEnvLabel] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [archived, setArchived] = useState<ArchivedFestival[]>([]);
  const [restoreStatus, setRestoreStatus] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectNote, setSelectNote] = useState<string | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const { askPassword, reauthDialog } = useReauthPrompt();

  const load = useCallback(async () => {
    setError(false);
    try {
      const [dashboard, festivalList, env] = await Promise.all([
        fetchAdminDashboard(),
        fetchAdminFestivals(),
        fetchAdminEnv().catch(() => null),
      ]);
      setCrews(null);
      setCrewsFailed(false);
      setEnvLabel(env?.label ?? null);
      setStats(dashboard?.stats ?? null);
      setHealth(dashboard?.health ?? null);
      setActivity(Array.isArray(dashboard?.recentActivity) ? dashboard.recentActivity : []);
      setFestivals(Array.isArray(festivalList) ? festivalList : []);
    } catch {
      setError(true);
    }
  }, []);

  const loadArchived = useCallback(async () => {
    try {
      const rows = await fetchArchivedFestivals();
      setArchived(Array.isArray(rows) ? rows : []);
    } catch {
      setRestoreStatus("Couldn't load archived festivals. Pull to refresh and try again.");
    }
  }, []);

  const toggleArchived = useCallback(() => {
    const next = !showArchived;
    setShowArchived(next);
    if (next) void loadArchived();
  }, [showArchived, loadArchived]);

  const onRestore = useCallback(
    async (f: ArchivedFestival) => {
      setRestoringId(f.id);
      try {
        await restoreFestival(f.id);
        setRestoreStatus(`Restored ${f.name}. It is back in the festival list.`);
        await Promise.all([load(), loadArchived()]);
      } catch {
        setRestoreStatus(`Couldn't restore ${f.name}. Try again.`);
      } finally {
        setRestoringId(null);
      }
    },
    [load, loadArchived],
  );

  useEffect(() => {
    if (!isAdmin) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- load-once guard: non-admins have nothing to fetch, so clear the initial loading flag. Tied to the fetch lifecycle, not derivable from render inputs.
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
  }, [isAdmin, load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void load().finally(() => setRefreshing(false));
  }, [load]);

  // Crews load once, on the first non-empty Find text; a failure is retried on the next keystroke.
  const onFindChange = useCallback(
    (text: string) => {
      setFindText(text);
      if (!text.trim() || crews) return;
      fetchAdminCrews()
        .then((rows) => {
          setCrews(Array.isArray(rows) ? rows : []);
          setCrewsFailed(false);
        })
        .catch(() => setCrewsFailed(true));
    },
    [crews],
  );

  const findResults = useMemo(
    () => searchAdminTargets(findText, { festivals, crews: crews ?? [] }),
    [findText, festivals, crews],
  );

  const openTarget = useCallback(
    (target: { kind: 'festival' | 'crew' | 'user'; id: string; label: string }) => {
      if (target.kind === 'festival') {
        router.push(`/admin/festival-edit?id=${encodeURIComponent(target.id)}`);
      } else if (target.kind === 'crew') {
        const crew = crews?.find((c) => c.id === target.id);
        router.push(`/admin/crews?q=${encodeURIComponent(crew?.inviteCode || target.label)}`);
      } else {
        router.push(`/admin/users?q=${encodeURIComponent(target.id)}`);
      }
    },
    [router, crews],
  );

  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelected(new Set());
    setSelectNote(null);
  }, []);

  const onToggleFestival = useCallback(
    (id: string) => {
      const { next, limited } = toggleSelection(selected, id);
      setSelected(next);
      setSelectNote(limited ? SELECTION_LIMIT_MESSAGE : null);
    },
    [selected],
  );

  const runArchive = useCallback(async () => {
    setConfirmArchive(false);
    setArchiving(true);
    try {
      const ids = [...selected];
      const res = await withReauth(() => bulkArchiveFestivals(ids), askPassword);
      if (!res) return;
      const archived = new Set(res.results.filter((r) => r.status === 'archived').map((r) => r.festivalId));
      setFestivals((prev) => prev.filter((f) => !archived.has(f.id)));
      Alert.alert('Archive festivals', summarizeBulkResults('archive', res.results));
      exitSelectMode();
    } catch (err: unknown) {
      Alert.alert('Archive festivals', err instanceof Error ? err.message : 'Action failed. Try again.');
    } finally {
      setArchiving(false);
    }
  }, [selected, askPassword, exitSelectMode]);

  // Non-admins never see the data — bounce them with a clear empty state.
  if (!isAdmin) {
    return (
      <View style={styles.screen}>
        <Stack.Screen options={{ headerShown: true, title: 'Admin' }} />
        <EmptyState
          icon="lock-closed-outline"
          title="Admins only"
          message="This area is restricted to festival administrators."
        />
      </View>
    );
  }

  const statRows = stats ? dashboardStatRows(stats) : [];
  const statsSummary = stats
    ? `${stats.users} users · ${stats.festivals} festivals · ${stats.profiles} festival plans · ${stats.picks} picks`
    : '';
  const healthSummary = describeHealth(health);
  const healthRows = health ? healthDetailRows(health) : [];

  // Admin actions — read-only home links into the destructive sub-screens.
  // Each sub-screen exists under app/admin/, so AuthGate (seg[0]==='admin')
  // already guards them and expo-router typed routes resolve.
  const adminActions: { label: string; icon: keyof typeof Ionicons.glyphMap; route: string }[] = [
    { label: 'Manage users', icon: 'people-outline', route: '/admin/users' },
    { label: 'Manage crews', icon: 'people-circle-outline', route: '/admin/crews' },
    { label: 'Audit log', icon: 'document-text-outline', route: '/admin/audit' },
    { label: 'Analytics', icon: 'bar-chart-outline', route: '/admin/analytics' },
  ];

  return (
    <View style={styles.screen}>
      {loading ? (
        <LoadingState label="Loading admin data" />
      ) : error ? (
        <EmptyState
          icon="cloud-offline-outline"
          title="Couldn't load admin data"
          message="Something went wrong reaching the server."
          action={{ label: 'Try again', onPress: () => void onRefresh() }}
        />
      ) : (
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            { paddingBottom: Math.max(t.spacing[6], insets.bottom + t.spacing[2]) + (selected.size > 0 ? 96 : 0) },
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
          {envLabel ? (
            <View style={styles.envBand} accessibilityRole="text">
              <Text style={styles.envBandText}>
                {envLabel} environment. Changes here do not reach festie.us.
              </Text>
            </View>
          ) : null}

          {/* Find — festivals, users, crews and invite codes */}
          <LabeledTextInput
            label="Find"
            value={findText}
            onChangeText={onFindChange}
            placeholder="Festival, user, crew or invite code"
            autoCapitalize="none"
          />
          {findResults.length > 0 ? (
            <View style={styles.card}>
              {findResults.map((r, i) => (
                <TouchableOpacity
                  key={`${r.kind}:${r.id}`}
                  style={[styles.row, i < findResults.length - 1 && styles.rowDivider]}
                  activeOpacity={0.7}
                  onPress={() => openTarget(r)}
                  accessibilityRole="button"
                  accessibilityLabel={`${r.label}, ${r.hint}`}
                >
                  <View style={styles.rowBody}>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {r.label}
                    </Text>
                    {r.hint ? (
                      <Text style={styles.rowHint} numberOfLines={1}>
                        {r.hint}
                      </Text>
                    ) : null}
                  </View>
                  <Ionicons name="chevron-forward" size={t.iconSize.sm} color={t.colors.text.secondary} />
                </TouchableOpacity>
              ))}
            </View>
          ) : null}
          {crewsFailed && findText.trim() ? (
            <Text style={styles.rowHint} accessibilityLiveRegion="polite">
              Couldn't load crews. Pull to refresh.
            </Text>
          ) : null}

          {/* Festivals — each row links to edit, lineup import, map, links and preview; Select mode bulk-archives. */}
          <View style={styles.sectionHeader}>
            <View style={styles.rowBody}>
              <SectionLabel>Festivals</SectionLabel>
            </View>
            {festivals.length > 0 ? (
              <TouchableOpacity
                style={styles.textBtn}
                activeOpacity={0.7}
                onPress={selectMode ? exitSelectMode : () => setSelectMode(true)}
                accessibilityRole="button"
                accessibilityLabel={selectMode ? 'Done selecting festivals' : 'Select festivals'}
              >
                <Text style={styles.textBtnLabel}>{selectMode ? 'Done' : 'Select'}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
          <View style={styles.card}>
            <TouchableOpacity
              style={[styles.row, styles.rowDivider]}
              activeOpacity={0.7}
              onPress={() => router.push('/admin/festival-edit')}
              accessibilityRole="button"
              accessibilityLabel="New festival"
            >
              <Ionicons name="add-circle-outline" size={t.iconSize.md} color={t.colors.accent.aqua} />
              <View style={styles.rowBody}>
                <Text style={styles.rowTitle}>New festival</Text>
              </View>
              <Ionicons name="chevron-forward" size={t.iconSize.sm} color={t.colors.text.secondary} />
            </TouchableOpacity>
            {festivals.length > 0 ? (
              festivals.map((f, i) => (
                <TouchableOpacity
                  key={f.id}
                  style={[selectMode ? styles.row : styles.festivalRow, i < festivals.length - 1 && styles.rowDivider]}
                  activeOpacity={0.7}
                  disabled={!selectMode}
                  onPress={() => onToggleFestival(f.id)}
                  accessibilityRole={selectMode ? 'checkbox' : undefined}
                  accessibilityState={selectMode ? { checked: selected.has(f.id) } : undefined}
                  accessibilityLabel={selectMode ? `Select ${f.name}` : `Festival: ${f.name}`}
                >
                  {selectMode ? (
                    <Ionicons
                      name={selected.has(f.id) ? 'checkbox' : 'square-outline'}
                      size={t.iconSize.md}
                      color={selected.has(f.id) ? t.colors.accent.aqua : t.colors.text.secondary}
                    />
                  ) : null}
                  <View style={styles.rowBody}>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {f.name}
                    </Text>
                    {!f.published ? <Text style={styles.draftCaption}>Draft</Text> : null}
                    {f.location ? (
                      <Text style={styles.rowHint} numberOfLines={1}>
                        {f.location}
                      </Text>
                    ) : null}
                  </View>
                  {selectMode ? null : (
                  <View style={styles.rowActions}>
                    {(
                      [
                        { label: 'Edit', icon: 'create-outline', path: 'festival-edit', a11y: `Edit ${f.name}` },
                        {
                          label: 'Import',
                          icon: 'cloud-upload-outline',
                          path: 'lineup-import',
                          a11y: `Import lineup for ${f.name}`,
                        },
                        { label: 'Map', icon: 'map-outline', path: 'festival-map', a11y: `Edit map for ${f.name}` },
                        {
                          label: 'Links',
                          icon: 'musical-notes-outline',
                          path: 'festival-links',
                          a11y: `Spotify links for ${f.name}`,
                        },
                        { label: 'Preview', icon: 'eye-outline', path: 'festival-preview', a11y: `Preview ${f.name}` },
                      ] as const
                    ).map((b) => (
                      <TouchableOpacity
                        key={b.label}
                        style={styles.actionBtn}
                        activeOpacity={0.7}
                        onPress={() => router.push(`/admin/${b.path}?id=${f.id}`)}
                        accessibilityRole="button"
                        accessibilityLabel={b.a11y}
                      >
                        <Ionicons name={b.icon} size={t.iconSize.md} color={t.colors.accent.aqua} />
                        <Text style={styles.actionText}>{b.label}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  )}
                </TouchableOpacity>
              ))
            ) : (
              <View style={styles.row}>
                <Text style={styles.rowHint}>No festivals</Text>
              </View>
            )}
            <TouchableOpacity
              style={[styles.row, styles.rowTopDivider]}
              activeOpacity={0.7}
              onPress={toggleArchived}
              accessibilityRole="button"
              accessibilityLabel={showArchived ? 'Hide archived' : 'Show archived'}
            >
              <View style={styles.rowBody}>
                <Text style={styles.rowTitle}>{showArchived ? 'Hide archived' : 'Show archived'}</Text>
              </View>
            </TouchableOpacity>
          </View>

          {restoreStatus ? (
            <Text style={styles.rowHint} accessibilityRole="text" accessibilityLiveRegion="polite">
              {restoreStatus}
            </Text>
          ) : null}

          {showArchived ? (
            <View style={styles.card}>
              {archived.length > 0 ? (
                archived.map((f, i) => (
                  <View
                    key={f.id}
                    style={[styles.row, i < archived.length - 1 && styles.rowDivider]}
                    accessibilityLabel={`Archived festival: ${f.name}`}
                  >
                    <View style={styles.rowBody}>
                      <Text style={styles.rowTitle} numberOfLines={1}>
                        {f.name}
                      </Text>
                      <Text style={styles.rowHint}>Deleted {timeAgoFromIso(f.deletedAt)}</Text>
                    </View>
                    <TouchableOpacity
                      style={styles.restoreBtn}
                      activeOpacity={0.7}
                      disabled={restoringId === f.id}
                      onPress={() => void onRestore(f)}
                      accessibilityRole="button"
                      accessibilityLabel={`Restore ${f.name}`}
                    >
                      <Text style={styles.restoreText}>Restore</Text>
                    </TouchableOpacity>
                  </View>
                ))
              ) : (
                <View style={styles.row}>
                  <Text style={styles.rowHint}>No archived festivals.</Text>
                </View>
              )}
            </View>
          ) : null}

          {/* Admin actions — navigation into the destructive sub-screens. */}
          <SectionLabel>Admin actions</SectionLabel>
          <View style={styles.card}>
            {adminActions.map((act, i) => (
              <TouchableOpacity
                key={act.route}
                style={[styles.row, i < adminActions.length - 1 && styles.rowDivider]}
                activeOpacity={0.7}
                onPress={() => router.push(act.route)}
                accessibilityRole="button"
                accessibilityLabel={act.label}
              >
                <Ionicons name={act.icon} size={t.iconSize.md} color={t.colors.accent.aqua} />
                <View style={styles.rowBody}>
                  <Text style={styles.rowTitle}>{act.label}</Text>
                </View>
                <Ionicons name="chevron-forward" size={t.iconSize.sm} color={t.colors.text.secondary} />
              </TouchableOpacity>
            ))}
          </View>

          {/* Recent admin activity — five rows, the rest on the audit screen */}
          <SectionLabel>Recent admin activity</SectionLabel>
          <View style={styles.card}>
            {activity.length > 0 ? (
              activity.slice(0, RECENT_ACTIVITY_ROWS).map((a, i) => (
                <View
                  key={a.id ?? i}
                  style={[styles.row, styles.rowDivider]}
                  accessibilityRole="text"
                  accessibilityLabel={`${auditActionLabel(a.action)} by ${a.actorUsername ?? 'System'}, ${timeAgoFromIso(a.createdAt)}`}
                >
                  <View style={styles.rowBody}>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {auditActionLabel(a.action)}
                    </Text>
                    <Text style={styles.rowHint} numberOfLines={1}>
                      {a.actorUsername ?? 'System'} · {timeAgoFromIso(a.createdAt)}
                    </Text>
                  </View>
                </View>
              ))
            ) : (
              <View style={[styles.row, styles.rowDivider]}>
                <Text style={styles.rowHint}>No recent activity</Text>
              </View>
            )}
            <TouchableOpacity
              style={styles.row}
              activeOpacity={0.7}
              onPress={() => router.push('/admin/audit')}
              accessibilityRole="button"
              accessibilityLabel="See all audit log entries"
            >
              <View style={styles.rowBody}>
                <Text style={styles.rowTitle}>See all</Text>
              </View>
              <Ionicons name="chevron-forward" size={t.iconSize.sm} color={t.colors.text.secondary} />
            </TouchableOpacity>
          </View>

          {/* Stats — one summary row that expands to the four counts */}
          <SectionLabel>Stats</SectionLabel>
          <View style={styles.card}>
            {stats ? (
              <TouchableOpacity
                style={[styles.row, statsOpen && styles.rowDivider]}
                activeOpacity={0.7}
                onPress={() => setStatsOpen((v) => !v)}
                accessibilityRole="button"
                accessibilityState={{ expanded: statsOpen }}
                accessibilityLabel={statsSummary}
              >
                <View style={styles.rowBody}>
                  <Text style={styles.rowTitle}>{statsSummary}</Text>
                </View>
                <Ionicons
                  name={statsOpen ? 'chevron-up' : 'chevron-down'}
                  size={t.iconSize.sm}
                  color={t.colors.text.secondary}
                />
              </TouchableOpacity>
            ) : (
              <View style={styles.row}>
                <Text style={styles.rowHint}>No stats available</Text>
              </View>
            )}
            {statsOpen
              ? statRows.map((row, i) => {
                  const route =
                    row.target === 'users' ? '/admin/users' : row.target === 'analytics' ? '/admin/analytics' : null;
                  return (
                    <TouchableOpacity
                      key={row.key}
                      style={[
                        styles.row,
                        stacked && styles.rowStacked,
                        i < statRows.length - 1 && styles.rowDivider,
                      ]}
                      activeOpacity={0.7}
                      disabled={!route}
                      onPress={() => route && router.push(route)}
                      accessibilityRole={route ? 'button' : 'text'}
                      accessibilityLabel={`${row.label}: ${row.value}. ${row.hint}`}
                    >
                      <View style={styles.rowBody}>
                        <Text style={styles.rowTitle}>{row.label}</Text>
                        <Text style={styles.rowHint}>{row.hint}</Text>
                      </View>
                      <View style={styles.statusPill}>
                        <Text style={styles.statusText}>{row.value}</Text>
                      </View>
                    </TouchableOpacity>
                  );
                })
              : null}
          </View>

          {/* Health — one sentence; the raw numbers sit behind Details */}
          <SectionLabel>Health</SectionLabel>
          <View style={styles.card}>
            <View
              style={[styles.row, healthRows.length > 0 && styles.rowDivider]}
              accessibilityRole="text"
              accessibilityLabel={healthSummary.text}
            >
              <Ionicons
                name={HEALTH_ICONS[healthSummary.tone]}
                size={t.iconSize.md}
                color={healthSummary.tone === 'warn' ? t.colors.accent.amber : t.colors.accent.aqua}
              />
              <View style={styles.rowBody}>
                <Text style={styles.rowTitle}>{healthSummary.text}</Text>
              </View>
            </View>
            {healthRows.length > 0 ? (
              <TouchableOpacity
                style={[styles.row, healthOpen && styles.rowDivider]}
                activeOpacity={0.7}
                onPress={() => setHealthOpen((v) => !v)}
                accessibilityRole="button"
                accessibilityState={{ expanded: healthOpen }}
                accessibilityLabel="Details"
              >
                <View style={styles.rowBody}>
                  <Text style={styles.rowTitle}>Details</Text>
                </View>
                <Ionicons
                  name={healthOpen ? 'chevron-up' : 'chevron-down'}
                  size={t.iconSize.sm}
                  color={t.colors.text.secondary}
                />
              </TouchableOpacity>
            ) : null}
            {healthOpen ? (
              <>
                <View style={[styles.row, styles.rowDivider]}>
                  <Text style={styles.rowHint}>{HEALTH_DETAILS_HEADING}</Text>
                </View>
                {healthRows.map((row, i) => (
                  <View
                    key={row.label}
                    style={[styles.row, stacked && styles.rowStacked, i < healthRows.length - 1 && styles.rowDivider]}
                    accessibilityRole="text"
                    accessibilityLabel={`${row.label}: ${row.value}`}
                  >
                    <View style={styles.rowBody}>
                      <Text style={styles.rowTitle}>{row.label}</Text>
                    </View>
                    <View style={styles.statusPill}>
                      <Text style={styles.statusText}>{row.value}</Text>
                    </View>
                  </View>
                ))}
              </>
            ) : null}
          </View>
        </ScrollView>
      )}

      <SelectionBar
        count={selected.size}
        actionLabel="Archive"
        onAction={() => setConfirmArchive(true)}
        onClear={() => {
          setSelected(new Set());
          setSelectNote(null);
        }}
        busy={archiving}
        note={selectNote}
      />
      <ConfirmDialog
        visible={confirmArchive}
        {...bulkConfirmCopy('archive', selected.size)}
        destructive
        onConfirm={() => void runArchive()}
        onCancel={() => setConfirmArchive(false)}
      />
      {reauthDialog}

      <Stack.Screen options={{ headerShown: true, title: 'Admin' }} />
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[3],
    paddingHorizontal: t.spacing[4],
    paddingVertical: t.spacing[3],
    minHeight: 56,
  },
  rowStacked: {
    flexDirection: 'column',
    alignItems: 'flex-start',
  },
  rowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: t.colors.border.default,
  },
  rowBody: {
    flex: 1,
    gap: t.spacing[1],
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  textBtn: {
    minHeight: 44,
    paddingHorizontal: t.spacing[3],
    alignItems: 'center',
    justifyContent: 'center',
  },
  textBtnLabel: {
    ...typeStyle('label', 600),
    color: t.colors.accent.aqua,
  },
  festivalRow: {
    paddingHorizontal: t.spacing[4],
    paddingVertical: t.spacing[3],
    gap: t.spacing[2],
  },
  rowActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: t.spacing[2],
  },
  actionBtn: {
    flexDirection: 'row',
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: t.spacing[3],
    gap: t.spacing[1],
    borderRadius: t.radii.default,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.colors.bg.primary,
    borderWidth: 1,
    borderColor: t.colors.border.default,
  },
  actionText: {
    ...typeStyle('caption'),
    color: t.colors.text.primary,
  },
  rowTitle: {
    ...typeStyle('body'),
    color: t.colors.text.primary,
  },
  rowHint: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  statusPill: {
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[1],
    borderRadius: t.radii.pill,
    backgroundColor: t.colors.bg.primary,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    minWidth: 48,
    alignItems: 'center',
  },
  rowTopDivider: {
    borderTopWidth: 1,
    borderTopColor: t.colors.border.default,
  },
  draftCaption: {
    ...typeStyle('caption'),
    color: t.colors.accent.amber,
  },
  envBand: {
    backgroundColor: t.colors.amberAlpha[12],
    borderWidth: 1,
    borderColor: t.colors.amberAlpha[30],
    borderRadius: t.radii.default,
    paddingHorizontal: t.spacing[4],
    paddingVertical: t.spacing[3],
  },
  envBandText: {
    ...typeStyle('caption'),
    color: t.colors.accent.amber,
  },
  restoreBtn: {
    minHeight: 40,
    paddingHorizontal: t.spacing[3],
    borderRadius: t.radii.default,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.colors.bg.primary,
    borderWidth: 1,
    borderColor: t.colors.border.default,
  },
  restoreText: {
    ...typeStyle('caption'),
    color: t.colors.accent.aqua,
  },
  statusText: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
}));
