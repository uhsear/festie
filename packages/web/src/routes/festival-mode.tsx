import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useAuthStore, useCrewStore, useFestivalStore } from '@festie/shared/stores';
import { useUIStore } from '@festie/shared/stores/uiStore';
import { useCrewDayOf, useFestival } from '@festie/shared/hooks';
import { festivalTimeLabel, fmtZonedClock, resolveFestivalTimeZone, selectNowNext } from '@festie/shared/utils';
import LowPowerToggle from '../components/features/LowPowerToggle';
import LowPowerIndicator from '../components/features/LowPowerIndicator';
import EmptyState from '../components/ui/EmptyState';
import { RenderErrorBoundary } from '../components/layout/RouteErrorBoundary';
import NowHero from '../components/festival-mode/NowHero';
import UpNextList from '../components/festival-mode/UpNextList';
import SosRaiseButton from '../components/crew/SosRaiseButton';
import { CrewNowSection, CrewPrompt, CrewWrapUpCard, MeetNowCard } from '../components/festival-mode/CrewNow';
import { CalendarX } from 'lucide-react';

export default function FestivalModeView() {
  return (
    <RenderErrorBoundary name="festival-mode">
      <FestivalModeViewInner />
    </RenderErrorBoundary>
  );
}

// `w-full` matters: an auto-margined item in the shell's flex column otherwise
// shrinks to its content width and clips at 320 px.
const PAGE = 'w-full min-w-0 max-w-[560px] lg:max-w-5xl mx-auto pb-[calc(20px+env(safe-area-inset-bottom,0px))]';

/**
 * The day-of Now surface. Phone order, top to bottom: what is on now (or
 * next), where the crew is, where to meet, the rest of Up Next, then
 * settings. Desktop puts the crew column beside the schedule column.
 */
function FestivalModeViewInner() {
  const user = useAuthStore((s) => s.user);
  const currentFestival = useFestivalStore((s) => s.currentFestival);
  const sets = useFestivalStore((s) => s.sets);
  const days = useFestivalStore((s) => s.days);
  const picks = useFestivalStore((s) => s.currentProfile?.picks);
  const setDetailSet = useUIStore((s) => s.setDetailSet);
  const { getStageName } = useFestival();
  const navigate = useNavigate();

  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const timeZone = resolveFestivalTimeZone(currentFestival);
  const timeLabel = festivalTimeLabel(timeZone, nowMs);
  const lineupMode = !user;
  const selection = useMemo(
    () => selectNowNext({ sets, days, picks: lineupMode ? undefined : (picks ?? {}), nowMs, timeZone }),
    [sets, days, picks, lineupMode, nowMs, timeZone],
  );
  const { crew, whereabouts, meet } = useCrewDayOf(nowMs, days, timeZone);
  const after = selection.phase === 'after';
  const crewId = crew?.id;
  const expenseBalances = useCrewStore((s) => s.expenseBalances);
  const balance = expenseBalances.find((b) => b.userId === user?.id)?.balance ?? 0;

  useEffect(() => {
    if (after && crewId) useCrewStore.getState().loadExpenses(crewId).catch(() => {});
  }, [after, crewId]);

  if (!currentFestival) {
    return (
      <div className={PAGE}>
        <EmptyState
          icon={<CalendarX className="w-12 h-12" aria-hidden="true" />}
          title="No festival selected"
          description="Pick a festival to see what's on now, where your crew is, and where you meet."
          cta={{ label: 'Choose a festival', onClick: () => navigate({ to: '/cards' }) }}
        />
      </div>
    );
  }

  // The hero shows the next set when nothing is live, so the list skips it.
  const heroShowsNext = selection.current.length === 0 && selection.phase === 'during' && (lineupMode || selection.todayCount > 0);
  const upNext = heroShowsNext ? selection.upcoming.slice(1) : selection.upcoming;
  const goCrew = () => navigate({ to: '/crew' });

  return (
    <div className={PAGE} data-testid="festival-mode-view">
      <div className="flex items-baseline justify-between gap-3 mb-4 min-w-0">
        <h1 className="type-display-lg text-text-primary min-w-0 [overflow-wrap:anywhere]">{currentFestival.name}</h1>
        <div className="flex items-center gap-2 shrink-0">
          {user && crew && <SosRaiseButton crewId={crew.id} compact />}
          <LowPowerIndicator />
          <div className="flex flex-col items-end">
            <span className="type-numeral text-text-secondary" aria-label="Festival time">
              {fmtZonedClock(nowMs, timeZone)}
            </span>
            {timeLabel && <span className="type-label text-text-muted">{timeLabel}</span>}
          </div>
        </div>
      </div>

      {/* Phone: one column in priority order (order-*). Desktop: two columns;
          `contents` lets the children join the phone column directly. */}
      <div className="flex flex-col gap-6 lg:grid lg:grid-cols-2 lg:gap-8 lg:items-start">
        <div className="contents lg:flex lg:flex-col lg:gap-6">
          <div className="order-1">
            <NowHero
              selection={selection}
              nowMs={nowMs}
              timeZone={timeZone}
              b2bSeparator={currentFestival.b2bSeparator}
              lineupMode={lineupMode}
              getStageName={getStageName}
              onOpenSet={setDetailSet}
              onBrowse={() => navigate({ to: '/cards' })}
              onWrap={user ? () => navigate({ to: '/wrap' }) : undefined}
            />
          </div>
          <div className="order-4">
            <UpNextList
              items={upNext}
              nowMs={nowMs}
              timeZone={timeZone}
              b2bSeparator={currentFestival.b2bSeparator}
              getStageName={getStageName}
              onOpenSet={setDetailSet}
            />
          </div>
        </div>
        <div className="contents lg:flex lg:flex-col lg:gap-6">
          <div className="order-2">
            {!user ? (
              <CrewPrompt
                title="Find your crew here"
                body="Sign in to see where your friends are and where you're meeting."
                cta="Sign in"
                onAction={() => navigate({ to: '/login', search: { next: '/festival-mode' } })}
              />
            ) : crew && after ? (
              <CrewWrapUpCard
                crewName={crew.name}
                balance={balance}
                crewId={crew.id}
                festivalId={currentFestival.id}
                onSettle={() => navigate({ to: '/crew', search: { tab: 'money' } })}
              />
            ) : crew ? (
              <CrewNowSection crewName={crew.name} rows={whereabouts} onOpenCrew={goCrew} />
            ) : (
              <CrewPrompt
                title="No crew yet"
                body="Start a crew or join one with an invite code to see each other here."
                cta="Start or join a crew"
                onAction={goCrew}
              />
            )}
          </div>
          {crew && !after && (
            <div className="order-3">
              <MeetNowCard meet={meet} nowMs={nowMs} timeZone={timeZone} onOpenMeet={goCrew} />
            </div>
          )}
          <div className="order-5">
            <LowPowerToggle />
          </div>
        </div>
      </div>
    </div>
  );
}
