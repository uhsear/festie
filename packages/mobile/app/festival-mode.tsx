import { useCallback, useMemo } from 'react';
import { View, Text, ScrollView, BackHandler } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter, Stack } from 'expo-router';
import { useAuthStore, useCrewStore, useFestivalDataStore } from '@festie/shared/stores';
import { useCrewDayOf, useFestival } from '@festie/shared/hooks';
import type { FestivalSet } from '@festie/shared/types';
import { festivalTimeLabel, fmtZonedClock, resolveFestivalTimeZone, selectNowNext } from '@festie/shared/utils';
import { makeStyles, typeScaleCap, typeStyle, useLargeText, useTokens } from '../hooks/useTokens';
import { useNow } from '../hooks/useNow';
import EmptyState from '../components/EmptyState';
import FreshnessChip from '../components/FreshnessChip';
import OfflineStatusChip from '../components/OfflineStatusChip';
import WeatherStrip from '../components/WeatherStrip';
import { DaylightToggle, LowPowerToggle, LowPowerIndicator } from '../components/LowPowerControls';
import { CrewNow, CrewPrompt, MeetNow, NowHero, UpNext } from '../components/NowSurface';
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
  const sets = useFestivalDataStore((s) => s.sets) as FestivalSet[];
  const days = useFestivalDataStore((s) => s.days);
  const picks = useFestivalDataStore((s) => s.currentProfile?.picks);
  const meetingPoints = useCrewStore((s) => s.meetingPoints);
  const { getStageName } = useFestival();
  const nowMs = useNow(60_000);

  const timeZone = resolveFestivalTimeZone(currentFestival);
  const lineupMode = !user;
  const selection = useMemo(
    () => selectNowNext({ sets, days, picks: lineupMode ? undefined : (picks ?? {}), nowMs, timeZone }),
    [sets, days, picks, lineupMode, nowMs, timeZone],
  );
  const { crew, whereabouts, meet } = useCrewDayOf(nowMs, days, timeZone);

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
      {!currentFestival ? (
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
            { paddingBottom: Math.max(t.spacing[4], insets.bottom + t.spacing[2]) },
          ]}
        >
          <View style={[styles.headerRow, largeText && { flexDirection: 'column', alignItems: 'flex-start' }]}>
            <Text style={styles.festivalName} numberOfLines={2} maxFontSizeMultiplier={typeScaleCap('title')}>
              {currentFestival.name}
            </Text>
            <View style={[styles.clockWrap, largeText && { alignItems: 'flex-start' }]}>
              <Text style={styles.clock} accessibilityLabel={`Festival time ${fmtZonedClock(nowMs, timeZone)}`}>
                {fmtZonedClock(nowMs, timeZone)}
              </Text>
              {festivalTimeLabel(timeZone, nowMs) ? <Text style={styles.clockCaption}>Festival time</Text> : null}
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
            onOpenSet={openSet}
            onBrowse={() => router.navigate(SCHEDULE_HREF)}
            onWrap={user ? () => router.push('/wrap') : undefined}
          />

          <WeatherStrip festivalId={currentFestival.id} nowMs={nowMs} />

          {!user ? (
            <CrewPrompt
              title="Find your crew here"
              body="Sign in to see where your friends are and where you're meeting."
              cta="Sign in"
              onPress={() => router.push('/(auth)/login')}
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
            <LowPowerToggle />
            <DaylightToggle />
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
