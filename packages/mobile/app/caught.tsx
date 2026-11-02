import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, SectionList, Text, TextInput, View } from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { api, markCaught, mapErrorToUserMessage } from '@festie/shared/services';
import { useAuthStore, useFestivalDataStore } from '@festie/shared/stores';
import {
  applyCaughtMark,
  artistDisplayName,
  buildCaughtChecklist,
  caughtSetFromLineup,
  checklistCountLine,
  findSetsToAdd,
  formatTime,
  isWrapUnlocked,
  lineupFromDays,
  resolveFestivalTimeZone,
} from '@festie/shared/utils';
import type { ChecklistRow } from '@festie/shared/utils';
import type { FestivalDay, FestivalSet, Stage, WrapCaughtSet, WrapResponse } from '@festie/shared/types';
import EmptyState from '../components/EmptyState';
import Button from '../components/Button';
import RatingButtons from '../components/RatingButtons';
import { makeStyles, typeStyle, useLargeText, useTokens, MAX_FONT_SCALE } from '../hooks/useTokens';
import { useHaptics } from '../hooks/useHaptics';

interface FestivalDetail {
  days: (FestivalDay & { sets?: FestivalSet[] })[];
  stages?: Stage[];
  b2bSeparator?: string;
}

const SAVE_ERROR = "Couldn't save that. Try again.";

/**
 * "What you caught": every pick for a festival plus sets the user added,
 * grouped by day, with Saw it / Skipped marks and the rating row. All marks go
 * through markCaught so they queue offline. Ratings stay online-only on mobile.
 */
export default function CaughtScreen() {
  const styles = useStyles();
  const t = useTokens();
  const largeText = useLargeText();
  const haptics = useHaptics();
  const { festival: festivalParam } = useLocalSearchParams<{ festival?: string }>();
  const currentFestival = useFestivalDataStore((s) => s.currentFestival);
  const storeSets = useFestivalDataStore((s) => s.sets) as FestivalSet[];
  const storeDays = useFestivalDataStore((s) => s.days);
  const storeStages = useFestivalDataStore((s) => s.stages);
  const userId = useAuthStore((s) => s.user?.id);
  const festivalId = festivalParam || currentFestival?.id;
  const isCurrent = !!festivalId && festivalId === currentFestival?.id;

  const [data, setData] = useState<WrapResponse | null>(null);
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState('');
  const [detail, setDetail] = useState<FestivalDetail | null>(null);
  const [detailError, setDetailError] = useState(false);
  const [detailTry, setDetailTry] = useState(0);
  const errorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!festivalId) return;
      let cancelled = false;
      api
        .get<WrapResponse>(`/ratings/wrap/${festivalId}`)
        .then((res) => {
          if (cancelled) return;
          setData(res);
          setError(false);
        })
        .catch(() => {
          if (!cancelled) setError(true);
        });
      return () => {
        cancelled = true;
      };
    }, [festivalId, reload]),
  );

  // A past festival's lineup is fetched once, when the add section first opens.
  useEffect(() => {
    if (!adding || isCurrent || !festivalId || detail) return;
    let cancelled = false;
    api
      .get<FestivalDetail>(`/festivals/${festivalId}`)
      .then((res) => {
        if (cancelled) return;
        setDetail(res);
        setDetailError(false);
      })
      .catch(() => {
        if (!cancelled) setDetailError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [adding, isCurrent, festivalId, detail, detailTry]);

  useEffect(
    () => () => {
      if (errorTimer.current) clearTimeout(errorTimer.current);
    },
    [],
  );

  const showError = useCallback((e: unknown) => {
    setSaveError(mapErrorToUserMessage(e, SAVE_ERROR));
    if (errorTimer.current) clearTimeout(errorTimer.current);
    errorTimer.current = setTimeout(() => setSaveError(null), 3000);
  }, []);

  const mark = useCallback(
    (setId: string, next: boolean | null, announce: string, added?: WrapCaughtSet) => {
      if (!userId) return;
      setData((w) => (w ? applyCaughtMark(w, setId, next, added) : w));
      AccessibilityInfo.announceForAccessibility(announce);
      markCaught(setId, next, userId).catch((e) => {
        haptics.warning();
        showError(e);
        setReload((n) => n + 1);
      });
    },
    [userId, haptics, showError],
  );

  const checklist = useMemo(() => (data ? buildCaughtChecklist(data) : null), [data]);
  const countLine = checklist ? checklistCountLine(checklist.counts) : '';
  const sections = useMemo(
    () => (checklist ? checklist.days.map((d) => ({ title: d.label, data: d.rows })) : []),
    [checklist],
  );

  const lineup = useMemo(
    () => (isCurrent ? storeSets : detail ? lineupFromDays(detail.days) : []),
    [isCurrent, storeSets, detail],
  );
  const lineupDays = (isCurrent ? storeDays : (detail?.days ?? [])) as FestivalDay[];
  const stages = useMemo(
    () => (isCurrent ? storeStages : (detail?.stages ?? [])) as Stage[],
    [isCurrent, storeStages, detail],
  );
  const b2bSeparator = isCurrent ? currentFestival?.b2bSeparator : detail?.b2bSeparator;
  const stageName = useCallback((id?: string | null) => stages.find((s) => s.id === id)?.name ?? null, [stages]);

  const results = useMemo(() => {
    if (!data) return [];
    return findSetsToAdd({
      lineup,
      days: lineupDays,
      excludeIds: new Set([...data.planned, ...(data.caughtExtra ?? [])].map((s) => s.setId)),
      query,
      stages,
      nowMs: Date.now(),
      timeZone: resolveFestivalTimeZone(data.festival),
      festivalOver: isWrapUnlocked(data.festival),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- lineupDays follows lineup
  }, [data, lineup, query, stages]);

  const header = <Stack.Screen options={{ title: 'What you caught', headerShown: true }} />;

  if (!festivalId) {
    return (
      <View style={styles.screen}>
        {header}
        <EmptyState icon="musical-notes-outline" title="Nothing to check off yet" message="Choose a festival first." />
      </View>
    );
  }

  if (error && !data) {
    return (
      <View style={styles.screen}>
        {header}
        <EmptyState
          icon="cloud-offline-outline"
          title="Couldn't load your sets"
          action={{
            label: 'Try again',
            onPress: () => {
              setError(false);
              setReload((n) => n + 1);
            },
          }}
        />
      </View>
    );
  }

  if (!data || !checklist) {
    return (
      <View style={[styles.screen, styles.centered]}>
        {header}
        <ActivityIndicator color={t.colors.accent.aqua} />
      </View>
    );
  }

  const renderRow = ({ item }: { item: ChecklistRow }) => {
    const artist = item.artist || 'Unknown artist';
    const meta = [item.stageName, item.startTime ? formatTime(item.startTime) : null].filter(Boolean).join(' · ');
    const toggle = (value: boolean, done: string) =>
      item.caught === value ? mark(item.setId, null, 'Mark removed') : mark(item.setId, value, done);
    return (
      <View style={styles.row}>
        <View style={styles.rowHead}>
          <View style={styles.rowText}>
            <Text style={styles.artist} maxFontSizeMultiplier={MAX_FONT_SCALE}>
              {artist}
            </Text>
            {meta ? (
              <Text style={styles.meta} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                {meta}
              </Text>
            ) : null}
            {item.added ? (
              <Text style={styles.tag} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                Added
              </Text>
            ) : null}
          </View>
          {!item.started ? (
            <Text style={styles.meta} maxFontSizeMultiplier={MAX_FONT_SCALE}>
              Not played yet
            </Text>
          ) : null}
        </View>
        {item.started ? (
          <>
            <View style={[styles.buttons, largeText && styles.buttonsStacked]}>
              {item.added ? (
                <Button
                  label="Remove"
                  variant="ghost"
                  accessibilityLabel={`Remove ${artist}`}
                  onPress={() => mark(item.setId, null, 'Mark removed')}
                />
              ) : (
                <>
                  <Button
                    label="Saw it"
                    variant={item.caught === true ? 'primary' : 'secondary'}
                    accessibilityLabel={`Saw ${artist}`}
                    accessibilityState={{ selected: item.caught === true }}
                    onPress={() => toggle(true, 'Marked as seen')}
                    style={styles.button}
                  />
                  <Button
                    label="Skipped"
                    variant={item.caught === false ? 'primary' : 'secondary'}
                    accessibilityLabel={`Skipped ${artist}`}
                    accessibilityState={{ selected: item.caught === false }}
                    onPress={() => toggle(false, 'Marked as skipped')}
                    style={styles.button}
                  />
                </>
              )}
            </View>
            <RatingButtons
              key={item.setId}
              setId={item.setId}
              festivalId={festivalId}
              initial={{ rating: item.rating, note: null }}
              compact
              showMemory={false}
              onRated={() => {
                if (item.caught !== true) mark(item.setId, true, 'Marked as seen');
              }}
            />
          </>
        ) : null}
      </View>
    );
  };

  const footer = (
    <View style={styles.addSection}>
      <Button
        label="Add a set I caught"
        variant="secondary"
        accessibilityState={{ expanded: adding }}
        onPress={() => setAdding((v) => !v)}
      />
      {adding ? (
        <View style={styles.addBody}>
          <TextInput
            style={styles.input}
            value={query}
            onChangeText={setQuery}
            placeholder="Search the lineup"
            placeholderTextColor={t.colors.text.muted}
            accessibilityLabel="Search the lineup"
            maxFontSizeMultiplier={MAX_FONT_SCALE}
            returnKeyType="search"
            autoFocus
          />
          <Text style={styles.meta} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            Your picks are already in the list.
          </Text>
          {detailError ? (
            <EmptyState
              icon="cloud-offline-outline"
              title="Couldn't load the lineup."
              action={{
                label: 'Try again',
                onPress: () => {
                  setDetailError(false);
                  setDetailTry((n) => n + 1);
                },
              }}
            />
          ) : null}
          {query.trim() && !detailError && results.length === 0 && (isCurrent || detail) ? (
            <Text style={styles.meta} maxFontSizeMultiplier={MAX_FONT_SCALE}>
              {`No sets match "${query.trim()}".`}
            </Text>
          ) : null}
          {results.map((set) => {
            const artist = artistDisplayName(set, b2bSeparator);
            const dayLabel =
              set.dayIndex == null ? null : (lineupDays[set.dayIndex]?.label ?? `Day ${set.dayIndex + 1}`);
            const meta = [stageName(set.stageId), dayLabel, set.startTime ? formatTime(set.startTime) : null]
              .filter(Boolean)
              .join(' · ');
            return (
              <View key={set.id} style={styles.result}>
                <View style={styles.rowText}>
                  <Text style={styles.artist} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                    {artist}
                  </Text>
                  {meta ? (
                    <Text style={styles.meta} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                      {meta}
                    </Text>
                  ) : null}
                </View>
                <Button
                  label="Add"
                  variant="secondary"
                  size="sm"
                  accessibilityLabel={`Add ${artist}`}
                  onPress={() => {
                    mark(set.id, true, `Added ${artist}`, caughtSetFromLineup(set, stageName(set.stageId), b2bSeparator));
                    setQuery('');
                  }}
                />
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
  );

  return (
    <View style={styles.screen}>
      {header}
      <SectionList
        sections={sections}
        keyExtractor={(r) => r.setId}
        renderItem={renderRow}
        renderSectionHeader={({ section }) => (
          <Text style={styles.dayHeader} accessibilityRole="header" maxFontSizeMultiplier={MAX_FONT_SCALE}>
            {section.title}
          </Text>
        )}
        stickySectionHeadersEnabled={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <View style={styles.top}>
            <Text style={styles.subtitle} maxFontSizeMultiplier={MAX_FONT_SCALE}>
              {data.festival.name}
            </Text>
            {countLine ? (
              <Text style={styles.meta} maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityLiveRegion="polite">
                {countLine}
              </Text>
            ) : null}
            {checklist.days.length === 0 ? (
              <EmptyState
                icon="musical-notes-outline"
                title="Nothing to check off yet"
                message="Pick sets from the lineup, or add a set you caught."
              />
            ) : null}
          </View>
        }
        ListFooterComponent={
          <>
            {saveError ? (
              <Text style={styles.error} maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityLiveRegion="polite">
                {saveError}
              </Text>
            ) : null}
            {footer}
          </>
        }
      />
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  screen: { flex: 1, backgroundColor: t.colors.bg.primary },
  centered: { alignItems: 'center', justifyContent: 'center' },
  content: { padding: t.spacing[4], gap: t.spacing[2] },
  top: { gap: t.spacing[1], marginBottom: t.spacing[2] },
  subtitle: { ...typeStyle('body'), color: t.colors.text.secondary },
  dayHeader: {
    ...typeStyle('heading'),
    color: t.colors.text.primary,
    marginTop: t.spacing[3],
    marginBottom: t.spacing[1],
  },
  row: {
    gap: t.spacing[2],
    padding: t.spacing[3],
    marginBottom: t.spacing[2],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.card,
  },
  rowHead: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: t.spacing[2] },
  rowText: { flex: 1, gap: 2 },
  artist: { ...typeStyle('body'), color: t.colors.text.primary },
  meta: { ...typeStyle('caption'), color: t.colors.text.secondary },
  tag: { ...typeStyle('caption'), color: t.colors.accent.aqua },
  buttons: { flexDirection: 'row', gap: t.spacing[2] },
  buttonsStacked: { flexDirection: 'column' },
  button: { flex: 1 },
  error: { ...typeStyle('caption'), color: t.colors.accent.coral, marginTop: t.spacing[2] },
  addSection: { marginTop: t.spacing[4], gap: t.spacing[2] },
  addBody: { gap: t.spacing[2] },
  input: {
    ...typeStyle('body'),
    color: t.colors.text.primary,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    borderRadius: t.radii.default,
    backgroundColor: t.colors.bg.card,
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[2],
  },
  result: { flexDirection: 'row', alignItems: 'center', gap: t.spacing[2] },
}));
