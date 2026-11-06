import { lazy, Suspense, useEffect, useMemo } from 'react';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '@festie/shared';
import type { CrewMeetingPoint } from '@festie/shared/types';
import { useAuthStore, useFestivalStore } from '@festie/shared/stores';
import { useActiveCrew } from '@festie/shared/hooks';
import { useLiveLocationStore } from '@festie/shared/stores/liveLocationStore';
import { Map as MapIcon } from 'lucide-react';
import { COPY } from '@festie/shared/constants';
import { festivalLoadState } from '@festie/shared/utils';
import EmptyState from '../components/ui/EmptyState';
import FestivalLoadError from '../components/features/FestivalLoadError';
import { RenderErrorBoundary } from '../components/layout/RouteErrorBoundary';
import SosRaiseButton from '../components/crew/SosRaiseButton';

// Lazy: CrewMap pulls in maplibre-gl, so it stays out of the main bundle.
const CrewMap = lazy(() => import('../components/crew/CrewMap'));

// Same cadence as MeetingPointsTab: sweep stale peers while the map is mounted.
const SWEEP_INTERVAL_MS = 15_000;

const NO_POINTS: CrewMeetingPoint[] = [];

export default function MapView() {
  return (
    <RenderErrorBoundary name="map">
      <MapViewInner />
    </RenderErrorBoundary>
  );
}

function MapViewInner() {
  const { focusStage } = useSearch({ from: '/map' });
  const navigate = useNavigate();
  const currentFestival = useFestivalStore((s) => s.currentFestival);
  const festivalStages = useFestivalStore((s) => s.stages);
  const mapFestival = useMemo(
    () => (currentFestival ? { ...currentFestival, stages: festivalStages } : null),
    [currentFestival, festivalStages],
  );
  const user = useAuthStore((s) => s.user);
  // Also selects the first crew, so a hard load of /map joins the crew room without a visit to /crew.
  const { crew: activeCrew } = useActiveCrew();
  const crewId = user && activeCrew ? activeCrew.id : '';
  const hasCrew = crewId !== '';

  const peersMap = useLiveLocationStore((s) => s.peers);
  const activeSosList = useLiveLocationStore((s) => s.activeSosList);
  const peers = useMemo(() => (hasCrew ? Object.values(peersMap) : []), [hasCrew, peersMap]);
  const sosList = useMemo(() => activeSosList.filter((e) => e.crewId === crewId), [activeSosList, crewId]);

  // Scope live peers and SOS to this crew. No cleanup: sharing is owned app-wide
  // by LiveLocationSharing, so leaving the map must not stop it.
  useEffect(() => {
    if (!hasCrew) return;
    useLiveLocationStore.getState().setActiveCrew(crewId);
  }, [hasCrew, crewId]);

  useEffect(() => {
    if (!hasCrew) return;
    const id = setInterval(() => useLiveLocationStore.getState().sweepStale(Date.now()), SWEEP_INTERVAL_MS);
    return () => clearInterval(id);
  }, [hasCrew]);

  // Same key and fetcher as MeetingPointsTab, so both share one cache entry.
  const { data: points = NO_POINTS, isError: pointsFailed, refetch: refetchPoints } = useQuery<CrewMeetingPoint[]>({
    queryKey: ['meeting-points', crewId],
    queryFn: async () => {
      const res = await api.get<CrewMeetingPoint[] | { meetingPoints: CrewMeetingPoint[] }>(
        `/crews/${crewId}/meeting-points`,
      );
      return Array.isArray(res) ? res : res?.meetingPoints || [];
    },
    enabled: hasCrew,
  });

  const loadState = useFestivalStore((s) => festivalLoadState(s));
  if (!currentFestival) {
    if (loadState === 'error') {
      return (
        <div className="px-4">
          <FestivalLoadError />
        </div>
      );
    }
    return (
      <div className="px-4">
        <EmptyState
          icon={<MapIcon className="w-12 h-12" aria-hidden="true" />}
          title={COPY.festivalLoad.noneTitle}
          description="Pick a festival on the Lineup tab to see its map."
        />
      </div>
    );
  }

  return (
    <div className="space-y-2 px-4 py-2">
      <h1 className="sr-only">Map</h1>
      {/* A row above the canvas, not an overlay, so it never fights the place card or pursue bar. */}
      {hasCrew && !sosList.some((e) => e.userId === user?.id) && (
        <div className="flex justify-end">
          <SosRaiseButton crewId={crewId} compact alerting={sosList.length > 0} />
        </div>
      )}
      <Suspense
        fallback={
          <div className="h-72 rounded-lg border border-border bg-bg-secondary flex items-center justify-center text-sm text-text-secondary">
            Loading map…
          </div>
        }
      >
        <CrewMap
          meetingPoints={hasCrew ? points : NO_POINTS}
          peers={peers}
          activeSosList={hasCrew ? sosList : []}
          festival={mapFestival}
          focusPinId={focusStage ?? null}
          onFocusHandled={() => navigate({ to: '/map', search: {}, replace: true })}
          canvasClassName="h-[calc(100dvh-var(--bottom-nav-h,0px)-11rem)] min-h-[320px]"
        />
      </Suspense>
      {hasCrew && pointsFailed && (
        <div className="flex flex-wrap items-center gap-3 text-sm text-text-secondary">
          <p role="alert">{COPY.meetingPoint.loadFailed}</p>
          <button type="button" className="min-h-11 underline" onClick={() => void refetchPoints()}>
            {COPY.festivalLoad.retry}
          </button>
        </div>
      )}
      {!hasCrew && (
        <p className="text-sm text-text-muted">
          {user ? (
            <>
              Join a <Link to="/crew" className="underline">crew</Link> to see friends and meeting points here.
            </>
          ) : (
            'Sign in and join a crew to see friends and meeting points here.'
          )}
        </p>
      )}
    </div>
  );
}
