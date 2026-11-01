import { lazy, Suspense, useEffect, useMemo } from 'react';
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '@festie/shared';
import type { CrewMeetingPoint } from '@festie/shared/types';
import { useAuthStore, useCrewStore, useFestivalStore } from '@festie/shared/stores';
import { useLiveLocationStore } from '@festie/shared/stores/liveLocationStore';
import { Map as MapIcon } from 'lucide-react';
import EmptyState from '../components/ui/EmptyState';
import { RenderErrorBoundary } from '../components/layout/RouteErrorBoundary';

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
  const currentFestival = useFestivalStore((s) => s.currentFestival);
  const festivalStages = useFestivalStore((s) => s.stages);
  const mapFestival = useMemo(
    () => (currentFestival ? { ...currentFestival, stages: festivalStages } : null),
    [currentFestival, festivalStages],
  );
  const user = useAuthStore((s) => s.user);
  const activeCrew = useCrewStore((s) => s.activeCrew);
  const crewId = user && activeCrew ? activeCrew.id : '';
  const hasCrew = crewId !== '';

  const peersMap = useLiveLocationStore((s) => s.peers);
  const activeSosList = useLiveLocationStore((s) => s.activeSosList);
  const peers = useMemo(() => (hasCrew ? Object.values(peersMap) : []), [hasCrew, peersMap]);
  const sosList = useMemo(() => activeSosList.filter((e) => e.crewId === crewId), [activeSosList, crewId]);

  // Scope live peers and SOS to this crew. No stopSharing() on unmount: that
  // cleanup belongs to the crew tab, and leaving the map must not stop sharing.
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
  const { data: points = NO_POINTS } = useQuery<CrewMeetingPoint[]>({
    queryKey: ['meeting-points', crewId],
    queryFn: async () => {
      const res = await api.get<CrewMeetingPoint[] | { meetingPoints: CrewMeetingPoint[] }>(
        `/crews/${crewId}/meeting-points`,
      );
      return Array.isArray(res) ? res : res?.meetingPoints || [];
    },
    enabled: hasCrew,
  });

  if (!currentFestival) {
    return (
      <div className="px-4">
        <EmptyState
          icon={<MapIcon className="w-12 h-12" aria-hidden="true" />}
          title="No festival selected"
          description="Pick a festival on the Lineup tab to see its map."
        />
      </div>
    );
  }

  return (
    <div className="space-y-2 px-4 py-2">
      <h1 className="sr-only">Map</h1>
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
          canvasClassName="h-[calc(100dvh-var(--bottom-nav-h,0px)-11rem)] min-h-[320px]"
        />
      </Suspense>
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
