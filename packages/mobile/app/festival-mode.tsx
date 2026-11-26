import { useCallback, useEffect, useMemo } from 'react';
import { View, Text, ScrollView, BackHandler } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter, Stack } from 'expo-router';
import { selectMyPicks, useAuthStore, useCrewStore, useFestivalDataStore } from '@festie/shared/stores';
import { useCrewDayOf, useFestival } from '@festie/shared/hooks';
import { COPY } from '@festie/shared/constants';
import type { FestivalSet } from '@festie/shared/types';
import {
  festivalLoadState,
  festivalTimeLabel,
  fmtZonedClock,
  isFixRecent,
  resolveFestivalTimeZone,
  selectNowNext,
  showsFestivalWeather,
  stageCoord,
  walkToStage,
} from '@festie/shared/utils';
import { makeStyles, typeScaleCap, typeStyle, useLargeText, useTokens } from '../hooks/useTokens';
import { useNow } from '../hooks/useNow';
import { useLastKnownFix } from '../hooks/useLastKnownFix';
import { setReturnTo } from '../lib/returnTo';
import { safeStageColor } from '../lib/stageColor';
import SosControl, { SOS_CONTROL_SIZE } from '../components/SosControl';
import EmptyState from '../components/EmptyState';
import LoadErrorState from '../components/LoadErrorState';
import LoadingState from '../components/LoadingState';
import FreshnessChip from '../components/FreshnessChip';
import OfflineStatusChip from '../components/OfflineStatusChip';
import WeatherStrip from '../components/WeatherStrip';
import CaughtNowCard from '../components/CaughtNowCard';
import { DaylightToggle, LowPowerIndicator } from '../components/LowPowerControls';
import { CrewNow, CrewPrompt, CrewWrapUp, MeetNow, NowHero, UpNext } from '../components/NowSurface';
import { CREW_MEET_HREF, SCHEDULE_HREF, meetHref } from '../lib/dayOfRoutes';

/**
 * Now & Next: the day-of surface (a.k.a. festival mode), mirroring the web
 * /festival-mode route. Top to bottom: what is on now (or next, with where to
 * walk), where the crew is, where to meet, the rest of Up Next, then the
 * low-power and Daylight switches. Guests get NOW/NEXT from the whole lineup
 * and a sign-in prompt in the crew slot. Reads only cached stores, so it works
 * offline; the selectors live in @festie/shared (utils/dayOf.ts).
 */
export default function FestivalModeScreen() {
  const t = useTokens();
  const styles = useStyles();
  const largeText = useLargeText();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const user = useAuthStore((s) => s.user);
  const currentFestival = useFestivalDataStore((s) => s.currentFestival);
  const festivals = useFestivalDataStore((s) => s.festivals);
  const festivalsLoading = useFestivalDataStore((s) => s.isLoading);
  const festivalsError = useFestivalDataStore((s) => s.error);
  const loadFestivals = useFestivalDataStore((s) => s.loadFestivals);
  // A cold start lands here before any screen has loaded the catalogue; without this the empty state never resolves.
  useEffect(() => {
    const { isLoading, error } = useFestivalDataStore.getState();
    if (!currentFestival && festivals.length === 0 && !isLoading && !error) {
      loadFestivals().catch(() => {});
    }
  }, [currentFestival, festivals.length, loadFestivals]);
  const loadState = festivalLoadState({ currentFestival, festivals, isLoading: festivalsLoading, error: festivalsError });
  const sets = useFestivalDataStore((s) => s.sets) as FestivalSet[];
  const days = useFestivalDataStore((s) => s.days);
  const picks = useFestivalDataStore(selectMyPicks) ?? undefined;
  const meetingPoints = useCrewStore((s) => s.meetingPoints);
  const expenseBalances = useCrewStore((s) => s.expenseBalances);
  const { getStageName, getStageColor } = useFestival();
  const nowMs = useNow(60_000);

  const timeZone = resolveFestivalTimeZone(currentFestival);
  const timeLabel = festivalTimeLabel(timeZone, nowMs);
  const lineupMode = !user;
  const selection = useMemo(
    () => selectNowNext({ sets, days, picks: lineupMode ? undefined : (picks ?? {}), nowMs, timeZone }),
    [sets, days, picks, lineupMode, nowMs, timeZone],
  );
  const stages = useFestivalDataStore((s) => s.stages);
  const fix = useLastKnownFix();
  const next = selection.upcoming[0];
  const walk =
    next && isFixRecent(fix.at, nowMs)
      ? walkToStage(fix.coord, stageCoord(stages, next.set.stageId), next.start, nowMs)
      : null;
  const { crew, whereabouts, meet } = useCrewDayOf(nowMs, days, timeZone);
  const after = selection.phase === 'after';
  const crewId = crew?.id;
  const balance = expenseBalances.find((b) => b.userId === user?.id)?.balance ?? 0;

  // The wrap-up card shows my balance, so refresh it once the festival is over.
  useEffect(() => {
    if (after && crewId) useCrewStore.getState().loadExpenses(crewId).catch(() => {});
  }, [after, crewId]);

  // Native tabs can leave this pushed stack screen without an Android history
  // entry. Always return hardware Back to Schedule instead of exiting the app.
  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        if (router.canGoBack()) router.back();
        else router.replace('/(tabs)');
        return true;
      });
      return () => subscription.remove();
    }, [router]),
  );

  const openSet = (set: FestivalSet) => router.push(`/set/${set.id}`);
  const heroShowsNext =
    selection.current.length === 0 && selection.phase === 'during' && (lineupMode || selection.todayCount > 0);

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: 'Now & Next', headerShown: true }} />
      {!currentFestival && loadState === 'error' ? (
        <LoadErrorState
          title={COPY.festivalLoad.errorTitle}
          message={festivalsError ?? COPY.festivalLoad.errorBody}
          action={{ label: COPY.festivalLoad.retry, onPress: () => void loadFestivals().catch(() => {}) }}
        />
      ) : !currentFestival && loadState === 'loading' ? (
        <LoadingState />
      ) : !currentFestival ? (
        <EmptyState
          icon="calendar-outline"
          title="No festival selected"
          message="Pick a festival to see what's on now, where your crew is, and where you meet."
          action={{ label: 'Choose a festival', onPress: () => router.navigate(SCHEDULE_HREF) }}
        />
      ) : (
        <ScrollView
          contentContainerStyle={[
            styles.content,
            { paddingBottom: Math.max(t.spacing[4], insets.bottom + t.spacing[2]) + (crewId && !after ? SOS_CONTROL_SIZE : 0) },
          ]}
        >
          <View style={[styles.headerRow, largeText && { flexDirection: 'column', alignItems: 'flex-start' }]}>
            <Text style={styles.festivalName} numberOfLines={2} maxFontSizeMultiplier={typeScaleCap('title')}>
              {currentFestival.name}
            </Text>
            <View style={styles.headerEnd}>
              <View style={[styles.clockWrap, largeText && { alignItems: 'flex-start' }]}>
                <Text style={styles.clock} accessibilityLabel={`Festival time ${fmtZonedClock(nowMs, timeZone)}`}>
                  {fmtZonedClock(nowMs, timeZone)}
                </Text>
                {timeLabel ? <Text style={styles.clockCaption}>{timeLabel}</Text> : null}
              </View>
            </View>
          </View>
          <View style={styles.metaRow}>
            <FreshnessChip surface="schedule" />
            {user ? <OfflineStatusChip /> : null}
            <LowPowerIndicator />
          </View>

          <NowHero
            selection={selection}
            nowMs={nowMs}
            timeZone={timeZone}
            b2bSeparator={currentFestival.b2bSeparator}
            lineupMode={lineupMode}
            getStageName={getStageName}
            getStageColor={(stageId) => safeStageColor(getStageColor(stageId), t.colors.text.primary)}
            festivalName={currentFestival.name}
            onOpenSet={openSet}
            onBrowse={() => router.navigate(SCHEDULE_HREF)}
            onWrap={user ? () => router.push('/wrap') : undefined}
            walk={walk}
          />

          {showsFestivalWeather(selection, nowMs) ? <WeatherStrip festivalId={currentFestival.id} nowMs={nowMs} /> : null}

          {user ? (
            <CaughtNowCard
              key={currentFestival.id}
              festivalId={currentFestival.id}
              nowMs={nowMs}
              timeZone={timeZone}
              getStageName={getStageName}
              b2bSeparator={currentFestival.b2bSeparator}
            />
          ) : null}

          {!user ? (
            <CrewPrompt
              title="Find your crew here"
              body="Sign in to see where your friends are and where you're meeting."
              cta="Sign in"
              onPress={() => {
                setReturnTo('/festival-mode');
                router.push('/(auth)/login');
              }}
            />
          ) : after && crew ? (
            <CrewWrapUp
              crewName={crew.name}
              balance={balance}
              onSettle={() => router.push({ pathname: '/(tabs)/crew', params: { tab: 'money' } })}
              onReform={() => router.push({ pathname: '/(tabs)/crew', params: { tab: 'members' } })}
            />
          ) : crew ? (
            <>
              <CrewNow crewName={crew.name} rows={whereabouts} onOpenCrew={() => router.navigate('/(tabs)/map')} />
              <MeetNow
                meet={meet}
                nowMs={nowMs}
                timeZone={timeZone}
                onOpen={() => router.push(meetHref(meet, meetingPoints))}
              />
            </>
          ) : (
            <CrewPrompt
              title="No crew yet"
              body="Start a crew or join one with an invite code to see each other here."
              cta="Start or join a crew"
              onPress={() => router.push(CREW_MEET_HREF)}
            />
          )}

          <UpNext
            items={heroShowsNext ? selection.upcoming.slice(1) : selection.upcoming}
            nowMs={nowMs}
            timeZone={timeZone}
            b2bSeparator={currentFestival.b2bSeparator}
            getStageName={getStageName}
            onOpenSet={openSet}
          />

          {/* Settings sit below the content: NOW comes first on this screen. */}
          <View style={styles.settings}>
            <DaylightToggle />
          </View>
        </ScrollView>
      )}
      {currentFestival && !after ? <SosControl crewId={crewId} bottomInset={insets.bottom} /> : null}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  screen: {
    flex: 1,
    backgroundColor: t.colors.bg.primary,
  },
  content: {
    paddingHorizontal: t.spacing[4],
    paddingVertical: t.spacing[4],
    gap: t.spacing[6],
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: t.spacing[3],
    marginBottom: -t.spacing[4],
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: t.spacing[2],
    marginBottom: -t.spacing[2],
  },
  festivalName: {
    ...typeStyle('title'),
    color: t.colors.text.primary,
    flex: 1,
  },
  headerEnd: { flexDirection: 'row', alignItems: 'center', gap: t.spacing[3] },
  clockWrap: { alignItems: 'flex-end' },
  clockCaption: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
  },
  clock: {
    ...typeStyle('numeral'),
    color: t.colors.text.secondary,
  },
  settings: {
    gap: t.spacing[2],
  },
}));
