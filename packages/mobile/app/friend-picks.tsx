import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useAuthStore, useFestivalDataStore, useUIStore } from '@festie/shared/stores';
import { fetchSharedPicks, mapErrorToUserMessage, type SharedPicksPayload } from '@festie/shared/services';
import {
  compareSharedPicks,
  parseSharedPicksRef,
  planSharedPicksAdd,
  type ComparedSet,
} from '@festie/shared/utils';
import { COPY, PRIORITY_LABEL, signInTo } from '@festie/shared/constants';
import type { Priority } from '@festie/shared/types';
import { makeStyles, typeStyle, useTokens, MAX_FONT_SCALE } from '../hooks/useTokens';
import { useHaptics } from '../hooks/useHaptics';
import { safeStageColor } from '../lib/stageColor';
import { priorityIconName } from '../lib/prioritySymbol';
import Button from '../components/Button';
import EmptyState from '../components/EmptyState';
import LoadingState from '../components/LoadingState';

const BAD_LINK = "This link can't be read. Ask your friend to send it again.";
const NOT_FOUND = 'This link no longer works. Ask your friend for a new one.';
const OFFLINE = 'Connect to the internet to see these picks.';

type Item = { kind: 'day'; key: string; label: string } | { kind: 'row'; key: string; row: ComparedSet };

// A bad or dead link never fixes itself; offline and generic failures can.
function isRetryable(err: unknown): boolean {
  const e = err as { status?: number; code?: string } | null;
  return e?.status !== 404 && !(e?.status === 0 && e.code === 'INVALID_INPUT');
}

function errorText(err: unknown): string {
  const e = err as { status?: number; code?: string } | null;
  if (e?.status === 404) return NOT_FOUND;
  if (e?.status === 0 && e.code === 'INVALID_INPUT') return BAD_LINK;
  if (e?.status === 0) return OFFLINE;
  return mapErrorToUserMessage(err, BAD_LINK);
}

export default function FriendPicksScreen() {
  const t = useTokens();
  const styles = useStyles();
  const router = useRouter();
  const haptics = useHaptics();
  const { from } = useLocalSearchParams<{ from?: string }>();
  const ref = parseSharedPicksRef(from);

  const user = useAuthStore((s) => s.user);
  const currentFestivalId = useFestivalDataStore((s) => s.currentFestivalId);
  const currentProfile = useFestivalDataStore((s) => s.currentProfile);

  const [payload, setPayload] = useState<SharedPicksPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!ref);
  const [retryable, setRetryable] = useState(false);
  const [reload, setReload] = useState(0);
  // null until the first toggle, so the default ticks follow the comparison instead of being re-seeded.
  const [userTicks, setUserTicks] = useState<Set<string> | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!ref) return;
    let cancelled = false;
    fetchSharedPicks(ref)
      .then((data) => {
        if (cancelled) return;
        setPayload(data);
        setError(null);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(errorText(err));
        setRetryable(isRetryable(err));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ref, reload]);

  const sameFestival = !!payload && currentFestivalId === payload.festivalId;
  const mine = sameFestival ? currentProfile?.picks : undefined;
  const comparison = useMemo(() => (payload ? compareSharedPicks(payload, mine) : null), [payload, mine]);

  const items = useMemo<Item[]>(
    () =>
      (comparison?.days ?? []).flatMap((d) => [
        { kind: 'day' as const, key: `day-${d.dayIndex}`, label: d.label },
        ...d.rows.map((row) => ({ kind: 'row' as const, key: row.setId, row })),
      ]),
    [comparison],
  );

  // Their Must See picks start ticked.
  const ticked = useMemo(() => {
    if (userTicks) return userTicks;
    return new Set(
      (comparison?.days ?? []).flatMap((d) => d.rows.filter((r) => r.addable && r.theirs === 'must').map((r) => r.setId)),
    );
  }, [userTicks, comparison]);

  const toggle = useCallback(
    (setId: string) => {
      const next = new Set(ticked);
      if (!next.delete(setId)) next.add(setId);
      setUserTicks(next);
    },
    [ticked],
  );

  const canAdd = !!user && !!mine;
  const addableCount = items.filter((i) => i.kind === 'row' && i.row.addable).length;
  const plan = useMemo(() => (comparison ? planSharedPicksAdd(comparison, ticked) : null), [comparison, ticked]);

  const handleAdd = useCallback(async () => {
    if (!plan || !plan.total || busy) return;
    setBusy(true);
    try {
      const store = useFestivalDataStore.getState();
      let added = 0;
      for (const priority of Object.keys(plan.byPriority) as Priority[]) {
        added += await store.bulkSavePicks(plan.byPriority[priority] ?? [], priority);
      }
      setUserTicks(new Set());
      haptics.success();
      useUIStore.getState().showToast(`Added ${added} ${added === 1 ? 'pick' : 'picks'} to your plan.`, {
        kind: 'success',
        onUndo: () => {
          void store
            .restorePicks(plan.previous)
            .then(() =>
              useUIStore.getState().showToast('Undone. Your plan is back to how it was.', { kind: 'success' }),
            )
            .catch((err) => {
              haptics.warning();
              useUIStore
                .getState()
                .showToast(mapErrorToUserMessage(err, "Couldn't undo. Try again."), { kind: 'error' });
            });
        },
      });
    } catch (err) {
      haptics.warning();
      useUIStore.getState().showToast(mapErrorToUserMessage(err, "Couldn't add the picks. Try again."), { kind: 'error' });
    } finally {
      setBusy(false);
    }
  }, [plan, busy, haptics]);

  const screen = <Stack.Screen options={{ title: "Friend's picks", headerShown: true }} />;

  if (!ref) {
    return (
      <>
        {screen}
        <EmptyState icon="link-outline" title={BAD_LINK} />
      </>
    );
  }
  if (loading) {
    return (
      <>
        {screen}
        <LoadingState label="Loading picks" />
      </>
    );
  }
  if (error || !payload || !comparison) {
    return (
      <>
        {screen}
        <EmptyState
          icon="cloud-offline-outline"
          title={error ?? BAD_LINK}
          action={
            error && retryable
              ? {
                  label: 'Try again',
                  onPress: () => {
                    setError(null);
                    setLoading(true);
                    setReload((n) => n + 1);
                  },
                }
              : undefined
          }
        />
      </>
    );
  }

  const { username, festivalName } = payload;

  const banner = !user ? (
    <View style={styles.banner}>
      <Text style={styles.bannerText} maxFontSizeMultiplier={MAX_FONT_SCALE}>
        {signInTo('compare these picks with yours')}
      </Text>
      <View style={styles.bannerActions}>
        <Button label={COPY.auth.signIn} size="sm" onPress={() => router.push('/(auth)/login')} />
        <Button label={COPY.auth.createAccount} size="sm" variant="secondary" onPress={() => router.push('/(auth)/register')} />
      </View>
    </View>
  ) : !sameFestival ? (
    <View style={styles.banner}>
      <Text style={styles.bannerText} maxFontSizeMultiplier={MAX_FONT_SCALE}>
        These picks are for {festivalName}.
      </Text>
      <Button
        label={`Switch to ${festivalName}`}
        size="sm"
        onPress={() => void useFestivalDataStore.getState().selectFestival(payload.festivalId)}
      />
    </View>
  ) : !currentProfile ? (
    <View style={styles.banner}>
      <Text style={styles.bannerText} maxFontSizeMultiplier={MAX_FONT_SCALE}>
        You haven't joined {festivalName} yet. Join it to compare and add picks.
      </Text>
      <Button label={`Open ${festivalName}`} size="sm" onPress={() => router.replace('/(tabs)')} />
    </View>
  ) : null;

  const header = (
    <View style={styles.header}>
      <Text style={styles.title} maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header">
        {`${username}'s ${festivalName} picks`}
      </Text>
      {mine ? (
        <Text style={styles.body} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          {`${comparison.counts.both} in common · ${comparison.counts.theirsOnly} only ${username} · ${comparison.counts.mineOnly} only you`}
        </Text>
      ) : null}
      {banner}
    </View>
  );

  const footer = (
    <View style={styles.footer}>
      {comparison.missing > 0 ? (
        <Text style={styles.body} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          {`${comparison.missing} of their picks are no longer in the lineup.`}
        </Text>
      ) : null}
      {canAdd ? (
        <View style={styles.addSection}>
          <Text style={styles.sectionTitle} maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header">
            Add their picks to your plan
          </Text>
          {addableCount === 0 ? (
            <Text style={styles.body} maxFontSizeMultiplier={MAX_FONT_SCALE}>
              You already have all of their picks.
            </Text>
          ) : (
            <>
              <Text style={styles.hint} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                Their Must See picks are ticked. Nothing changes until you tap Add. A pick you already rated higher
                stays as it is.
              </Text>
              {plan && plan.total > 0 ? (
                <Button
                  label={`Add ${plan.total} to my plan`}
                  onPress={() => void handleAdd()}
                  loading={busy}
                />
              ) : (
                <Text style={styles.body} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                  Tick the sets you want to add.
                </Text>
              )}
            </>
          )}
        </View>
      ) : null}
    </View>
  );

  const renderItem = ({ item }: { item: Item }) => {
    if (item.kind === 'day') {
      return (
        <Text style={styles.dayHeader} maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header">
          {item.label}
        </Text>
      );
    }
    const { row } = item;
    const mark = row.bucket === 'both' ? 'Both' : row.bucket === 'theirs' ? `Only ${username}` : 'Only you';
    const checked = ticked.has(row.setId);
    const stageColor = safeStageColor(row.stageColor ?? undefined, t.colors.text.secondary);
    const marks = [
      row.theirs ? `Them: ${PRIORITY_LABEL[row.theirs]}` : null,
      row.mine ? `You: ${PRIORITY_LABEL[row.mine]}` : null,
    ].filter(Boolean);
    return (
      <View style={styles.row}>
        {canAdd && row.addable ? (
          <TouchableOpacity
            onPress={() => toggle(row.setId)}
            style={styles.checkbox}
            accessibilityRole="checkbox"
            accessibilityState={{ checked }}
            accessibilityLabel={`${row.artist}, ${row.time}`}
          >
            <Ionicons
              name={checked ? 'checkbox' : 'square-outline'}
              size={24}
              color={checked ? t.colors.accent.aqua : t.colors.text.secondary}
            />
          </TouchableOpacity>
        ) : null}
        <View style={styles.rowBody}>
          <Text style={styles.artist} maxFontSizeMultiplier={MAX_FONT_SCALE} numberOfLines={2}>
            {row.artist}
          </Text>
          <View style={styles.meta}>
            <Text style={styles.body} maxFontSizeMultiplier={MAX_FONT_SCALE}>
              {row.time}
            </Text>
            {row.stage ? (
              <View style={[styles.stageBadge, { borderColor: stageColor }]}>
                <Text style={[styles.stageText, { color: stageColor }]} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                  {row.stage}
                </Text>
              </View>
            ) : null}
            <Text style={styles.markText} maxFontSizeMultiplier={MAX_FONT_SCALE}>
              {mark}
            </Text>
          </View>
          <View style={styles.meta}>
            {row.theirs ? <Ionicons name={priorityIconName(row.theirs)} size={14} color={t.colors.text.secondary} /> : null}
            {row.mine && !row.theirs ? (
              <Ionicons name={priorityIconName(row.mine)} size={14} color={t.colors.text.secondary} />
            ) : null}
            <Text style={styles.hint} maxFontSizeMultiplier={MAX_FONT_SCALE}>
              {marks.join(' · ')}
            </Text>
          </View>
        </View>
      </View>
    );
  };

  return (
    <>
      {screen}
      <FlatList
        style={styles.container}
        contentContainerStyle={styles.content}
        data={items}
        keyExtractor={(i) => i.key}
        renderItem={renderItem}
        ListHeaderComponent={header}
        ListFooterComponent={footer}
        extraData={ticked}
      />
    </>
  );
}

const useStyles = makeStyles((t) => ({
  container: { flex: 1, backgroundColor: t.colors.bg.primary },
  content: { padding: t.spacing[4], gap: t.spacing[2], paddingBottom: t.spacing[8] },
  header: { gap: t.spacing[2], marginBottom: t.spacing[2] },
  footer: { gap: t.spacing[3], marginTop: t.spacing[3] },
  title: { ...typeStyle('title'), color: t.colors.text.primary },
  sectionTitle: { ...typeStyle('label'), color: t.colors.text.primary },
  body: { ...typeStyle('body'), color: t.colors.text.secondary },
  hint: { ...typeStyle('caption'), color: t.colors.text.secondary },
  banner: {
    gap: t.spacing[2],
    padding: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.light,
    backgroundColor: t.colors.bg.card,
  },
  bannerText: { ...typeStyle('body'), color: t.colors.text.primary },
  bannerActions: { flexDirection: 'row', gap: t.spacing[2] },
  addSection: { gap: t.spacing[2] },
  dayHeader: { ...typeStyle('label'), color: t.colors.text.primary, marginTop: t.spacing[3] },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    padding: t.spacing[3],
    borderRadius: t.radii.default,
    backgroundColor: t.colors.bg.card,
  },
  checkbox: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  rowBody: { flex: 1, gap: t.spacing[1] },
  artist: { ...typeStyle('label'), color: t.colors.text.primary },
  meta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: t.spacing[2] },
  stageBadge: {
    paddingHorizontal: t.spacing[2],
    borderRadius: t.radii.pill,
    borderWidth: 1,
  },
  stageText: { ...typeStyle('caption') },
  markText: { ...typeStyle('caption', 700), color: t.colors.text.primary },
}));
