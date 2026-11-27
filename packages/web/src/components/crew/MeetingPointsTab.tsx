import React, { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  createMeetingPoint,
  updateMeetingPoint,
  deleteMeetingPoint,
  meetAtFromWallInput,
  meetAtToWallInput,
  resolveFestivalTimeZone,
  writeOutcomeOf,
  writeOutcomeMessage,
  fetchPastMeetingPoints,
  splitMeetingPoints,
  meetingPointDirectionsUrl,
} from '@festie/shared';
import type { CrewMeetingPoint } from '@festie/shared/types';
import type { MeetingPointPayload } from '@festie/shared/services';
import { useFestivalStore } from '@festie/shared/stores';
import { useCrewStore } from '@festie/shared/stores/crewStore';
import { MEETING_POINT_PAST_ERROR, meetAtIsPast, meetingPointPrefill, type MapPlace } from '@festie/shared/utils';
import { useCurrentPosition } from '@festie/shared/hooks';
import { useLiveLocationStore } from '@festie/shared/stores/liveLocationStore';
import { useToast } from '../../lib/toastContext';
import MeetingPointCard from './MeetingPointCard';
import MeetingPointForm from './MeetingPointForm';
import PastMeetingPointCard from './PastMeetingPointCard';
import { useUndoableRemove } from './useUndoableRemove';
import Button from '../ui/Button';
import EmptyState from '../ui/EmptyState';
import StaleNote from './StaleNote';
import Skeleton, { SkeletonGroup } from '../ui/Skeleton';
import { loadErrorMessage } from './loadErrorMessage';
import {
  MapPin,
  Plus,
  Map as MapIcon,
  List,
  Maximize2,
} from 'lucide-react';
import { Link } from '@tanstack/react-router';
import { meetingPointKind } from '@festie/shared/constants';
import { meetingPointsQuery } from '../../lib/queryPersist';
import CrewStatus from './CrewStatus';
import LiveLocationControls from './LiveLocationControls';
import SegmentedTablist from '@/components/ui/SegmentedTablist';

// Lazy: CrewMap pulls in maplibre-gl (~200 kB gzip) at runtime. Keeping it behind
// lazy() puts it in its own chunk so it never lands in the main bundle (mirrors
// the router's lazy() pattern for heavy views) and only loads when Map is opened.
const CrewMap = lazy(() => import('./CrewMap'));

// How often we sweep stale peers off the map while it's mounted (defense in
// depth alongside the server's 120s Redis TTL + peer-stopped broadcasts).
const SWEEP_INTERVAL_MS = 15_000;

interface Props {
  crewId: string;
  currentUserId: string;
  /** Raiser to aim the map at; opens Map view. */
  focusSosUserId?: string;
  /** Crew owner may edit and remove any point. */
  isOwner?: boolean;
}

export default function MeetingPointsTab({ crewId, currentUserId, focusSosUserId, isOwner = false }: Props) {
  const { toast, toastError } = useToast();
  const qc = useQueryClient();
  // Festival timezone + days so recurring-point badges render the meet time in
  // the FESTIVAL frame (matching mobile), not the viewer's device zone.
  const currentFestival = useFestivalStore((s) => s.currentFestival);
  const festivalDays = useFestivalStore((s) => s.days);
  // Stages live as a separate top-level array in the store; fold them onto the
  // festival so CrewMap can plot stage pins (+ amenities/camera from mapConfig).
  const festivalStages = useFestivalStore((s) => s.stages);
  const festivalTimeZone = resolveFestivalTimeZone(currentFestival);
  const mapFestival = useMemo(
    () => (currentFestival ? { ...currentFestival, stages: festivalStages } : null),
    [currentFestival, festivalStages],
  );
  const [showForm, setShowForm] = useState(false);
  const [placing, setPlacing] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const labelInputRef = useRef<HTMLInputElement>(null);
  // Minute tick so a point moves to Past without a reload.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [location, setLocation] = useState('');
  const [stageRef, setStageRef] = useState('');
  const [type, setType] = useState<string>('during');
  const [meetAt, setMeetAt] = useState('');
  // 055: repeat this timed point every festival day at meet_at's time-of-day.
  const [recursDaily, setRecursDaily] = useState(false);
  // F4: optional captured GPS coords. null = no coord (free-text only).
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  // Form values when an edit began, so submit sends only what the user changed.
  const editBaseline = useRef<{
    label: string;
    location: string;
    type: string;
    stageRef: string;
    meetAt: string;
    recursDaily: boolean;
    coords: { lat: number; lng: number } | null;
  } | null>(null);
  const { locating, getCurrentPosition } = useCurrentPosition();
  // List vs Map view. Map is lazy + reveals <CrewMap/> only when chosen.
  const [view, setView] = useState<'list' | 'map'>(focusSosUserId ? 'map' : 'list');
  useEffect(() => {
    if (focusSosUserId) setView('map');
  }, [focusSosUserId]);

  // ── Live Location + SOS (ephemeral) ─────────────────────────────────────────
  // Scope the (non-persisted) liveLocationStore to this crew so peer markers and
  // SOS never bleed across crews. Subscribe to the peers RECORD (stable ref) and
  // derive the array via useMemo — returning a fresh array from the selector
  // would loop useSyncExternalStore.
  const peersMap = useLiveLocationStore((s) => s.peers);
  // Full active-SOS list (crew-filtered as defense in depth) so a second
  // concurrent SOS gets its own map marker — not just the newest one.
  const activeSosList = useLiveLocationStore((s) => s.activeSosList);
  const peers = useMemo(() => Object.values(peersMap), [peersMap]);
  const sosList = useMemo(() => activeSosList.filter((e) => e.crewId === crewId), [activeSosList, crewId]);

  // Scopes the store to the open crew — the peer/SOS guards in liveLocationStore
  // fall open while crewId is null, so this must stay unconditional.
  // No cleanup: the crew scope stays (useLiveLocationCrewSync owns it app-wide),
  // and sharing outlives this tab (LiveLocationSharing in AppShell owns it).
  useEffect(() => {
    useLiveLocationStore.getState().setActiveCrew(crewId);
  }, [crewId]);

  useEffect(() => {
    const id = setInterval(() => useLiveLocationStore.getState().sweepStale(Date.now()), SWEEP_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  const {
    data: points = [],
    error,
    isLoading,
    isError,
    refetch,
  } = useQuery({ ...meetingPointsQuery(crewId), enabled: !!crewId });

  // A failed past query shows nothing; the active list owns the error state.
  const { data: pastPoints = [] } = useQuery<CrewMeetingPoint[]>({
    queryKey: ['meeting-points-past', crewId],
    queryFn: () => fetchPastMeetingPoints(crewId) as Promise<CrewMeetingPoint[]>,
    enabled: !!crewId,
  });
  const { current, past } = splitMeetingPoints(points, pastPoints, nowMs);

  const createPoint = useMutation({
    mutationFn: (payload: MeetingPointPayload) => createMeetingPoint(crewId, payload),
    onSuccess: (result, payload) => {
      const outcome = writeOutcomeOf(result);
      if (outcome === 'queued') {
        // Queued offline: show the point now, marked "Not sent yet".
        const placeholder: CrewMeetingPoint = {
          id: (result as { id: string }).id,
          crew_id: crewId,
          created_by: currentUserId,
          label: payload.label,
          location: payload.location,
          type: payload.type,
          meet_at: payload.meetAt ?? null,
          stage_reference: payload.stageReference ?? null,
          latitude: payload.latitude ?? null,
          longitude: payload.longitude ?? null,
          recurs_daily: payload.recursDaily ?? false,
          active: true,
          created_at: new Date().toISOString(),
          _optimistic: true,
        };
        qc.setQueryData<CrewMeetingPoint[]>(['meeting-points', crewId], (old = []) => [placeholder, ...old]);
      } else {
        qc.invalidateQueries({ queryKey: ['meeting-points', crewId] });
      }
      toast(writeOutcomeMessage(outcome, 'Meeting point added'), outcome === 'queued' ? 'info' : 'success');
      reset();
    },
    onError: (e) => toastError(e, "Couldn't add meeting point. Try again."),
  });

  const updatePoint = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<MeetingPointPayload> }) =>
      updateMeetingPoint(crewId, id, payload),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['meeting-points', crewId] });
      const outcome = writeOutcomeOf(result);
      toast(writeOutcomeMessage(outcome, 'Meeting point updated'), outcome === 'queued' ? 'info' : 'success');
      reset();
    },
    onError: (e) => toastError(e, "Couldn't update meeting point. Try again."),
  });

  const { hiddenIds, remove: removePoint } = useUndoableRemove(async (id) => {
    const result = await deleteMeetingPoint(crewId, id);
    const outcome = writeOutcomeOf(result);
    if (outcome === 'queued') {
      qc.setQueryData<CrewMeetingPoint[]>(['meeting-points', crewId], (old = []) => old.filter((p) => p.id !== id));
    } else {
      qc.invalidateQueries({ queryKey: ['meeting-points', crewId] });
    }
    return outcome;
  }, "Couldn't remove meeting point. Try again.");

  function reset() {
    setLabel('');
    setLocation('');
    setStageRef('');
    setType('during');
    setMeetAt('');
    setRecursDaily(false);
    setCoords(null);
    setEditingId(null);
    setShowForm(false);
  }

  function startCreateAt({ latitude, longitude }: { latitude: number; longitude: number }) {
    setLabel('');
    setLocation('');
    setStageRef('');
    setType('during');
    setMeetAt('');
    setRecursDaily(false);
    setEditingId(null);
    setCoords({ lat: latitude, lng: longitude });
    setShowForm(true);
    setPlacing(false);
    requestAnimationFrame(() => {
      formRef.current?.scrollIntoView({ block: 'nearest' });
      labelInputRef.current?.focus();
    });
  }

  function handleSetMeetingPoint(place: MapPlace) {
    startCreateAt(place.coord);
    const prefill = meetingPointPrefill(place);
    setLabel(prefill.label);
    setLocation(prefill.location);
    setStageRef(prefill.stageReference);
  }

  function startEdit(p: CrewMeetingPoint) {
    const startCoords =
      typeof p.latitude === 'number' && typeof p.longitude === 'number' ? { lat: p.latitude, lng: p.longitude } : null;
    const startMeetAt = p.meet_at ? meetAtToWallInput(p.meet_at, festivalTimeZone) : '';
    editBaseline.current = {
      label: p.label,
      location: p.location,
      type: meetingPointKind(p.type).type,
      stageRef: p.stage_reference || '',
      meetAt: startMeetAt,
      recursDaily: !!p.recurs_daily,
      coords: startCoords,
    };
    setEditingId(p.id);
    setLabel(p.label);
    setLocation(p.location);
    setStageRef(p.stage_reference || '');
    setType(meetingPointKind(p.type).type);
    // datetime-local wants "YYYY-MM-DDTHH:mm", shown in the festival zone.
    setMeetAt(startMeetAt);
    setRecursDaily(!!p.recurs_daily);
    setCoords(startCoords);
    setShowForm(true);
  }

  // F4: capture the device's current position via the browser Geolocation API.
  // Map-pick is deferred to the offline-map slice; denial gracefully falls back
  // to the existing free-text location field (coords stay null).
  async function captureLocation() {
    const pos = await getCurrentPosition((message) =>
      toast(
        message === 'Location is not available on this device' ? message : `${message} — using the typed location instead`,
        'error',
      ),
    );
    if (pos) {
      setCoords({ lat: pos.lat, lng: pos.lng });
      toast('Location captured', 'success');
    }
  }

  function toggleComing(p: CrewMeetingPoint) {
    const on = !(p.coming ?? []).includes(currentUserId);
    useCrewStore
      .getState()
      .setMeetingPointComing(crewId, p.id, currentUserId, on)
      .then(() => qc.invalidateQueries({ queryKey: ['meeting-points', crewId] }))
      .catch((e) => toastError(e, "Couldn't update I'll be there. Try again."));
  }

  function openDirections(p: CrewMeetingPoint) {
    window.open(meetingPointDirectionsUrl(p), '_blank', 'noopener,noreferrer');
  }

  // An edit that leaves the time alone may keep a time that has since passed.
  const meetAtError =
    meetAt && (!editingId || meetAt !== editBaseline.current?.meetAt)
      ? meetAtIsPast(meetAtFromWallInput(meetAt, festivalTimeZone), recursDaily, nowMs)
        ? MEETING_POINT_PAST_ERROR
        : undefined
      : undefined;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim() || !location.trim() || meetAtError) return;
    const payload: MeetingPointPayload = {
      label: label.trim(),
      location: location.trim(),
      type,
      meetAt: meetAt ? meetAtFromWallInput(meetAt, festivalTimeZone) : null,
      stageReference: stageRef.trim() || null,
      // F4: send captured coords, or null to clear them on edit.
      latitude: coords ? coords.lat : null,
      longitude: coords ? coords.lng : null,
      // 055: recurrence only applies to a timed point; clear it when no meet_at.
      recursDaily: meetAt ? recursDaily : false,
    };
    if (editingId) {
      const base = editBaseline.current;
      if (!base) return;
      // A re-sent minute-precision time can differ from the stored instant, so
      // untouched fields stay out of the body.
      const changed: Partial<MeetingPointPayload> = {};
      if (label.trim() !== base.label) changed.label = payload.label;
      if (location.trim() !== base.location) changed.location = payload.location;
      if (type !== base.type) changed.type = type;
      if (stageRef.trim() !== base.stageRef) changed.stageReference = payload.stageReference;
      if (meetAt !== base.meetAt) changed.meetAt = payload.meetAt;
      if ((meetAt ? recursDaily : false) !== base.recursDaily) changed.recursDaily = payload.recursDaily;
      if (coords?.lat !== base.coords?.lat || coords?.lng !== base.coords?.lng) {
        changed.latitude = payload.latitude;
        changed.longitude = payload.longitude;
      }
      if (Object.keys(changed).length === 0) {
        reset();
        return;
      }
      updatePoint.mutate({ id: editingId, payload: changed });
    } else {
      createPoint.mutate(payload);
    }
  }

  const submitting = createPoint.isPending || updatePoint.isPending;

  if (isLoading) {
    return (
      <SkeletonGroup className="space-y-2">
        <Skeleton variant="card" />
        <Skeleton variant="card" />
      </SkeletonGroup>
    );
  }
  if (isError && points.length === 0) {
    return (
      <div className="space-y-3">
        {/* The safety controls do not depend on the list, so a failed list never hides SOS. */}
        <LiveLocationControls crewId={crewId} currentUserId={currentUserId} />
        <div className="h-px bg-border" />
        <EmptyState
          icon={<MapPin className="w-12 h-12" aria-hidden="true" />}
          title="Couldn't load meeting points"
          description={loadErrorMessage(error, 'Something went wrong loading meeting points.')}
          cta={{ label: 'Retry', onClick: () => refetch() }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <StaleNote show={isError} onRetry={() => void refetch()} />
      {/* Live Location + SOS (ephemeral, always visible so the share toggle / SOS /
          active-SOS banner are reachable in both list & map views). First on the
          tab: an emergency control belongs above the status card. No build-time
          flag: the off-lever is server-side — LIVE_LOCATION_ENABLED / SOS_ENABLED
          in lib/config.ts (both default ON) disable it for every client, no rebuild. */}
      <LiveLocationControls crewId={crewId} currentUserId={currentUserId} />
      <div className="h-px bg-border" />

      {/* M5: last-synced "on my way / ETA to [point]" — honest staleness, never
          live. ETA targets are the meeting points below; coord-bearing points
          enable a geo-computed ETA. */}
      <CrewStatus crewId={crewId} currentUserId={currentUserId} meetingPoints={current} />

      {/* List/Map toggle. Map lazy-loads MapLibre only when selected. */}
      <div className="flex flex-wrap items-center gap-2">
      <SegmentedTablist
        label="Meeting points view"
        panelId="meeting-points-panel"
        options={[
          { value: 'list', label: <><List className="w-4 h-4" aria-hidden="true" /> List</> },
          { value: 'map', label: <><MapIcon className="w-4 h-4" aria-hidden="true" /> Map</> },
        ]}
        value={view}
        onChange={setView}
        className="inline-flex gap-1 rounded-xl bg-bg-card"
        tabClassName="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md"
      />
      <Link
        to="/map"
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium min-h-11 text-text-secondary hover:text-text-primary"
      >
        <Maximize2 className="w-4 h-4" aria-hidden="true" /> Open full map
      </Link>
      </div>

      {showForm && (
        <MeetingPointForm
          formRef={formRef}
          labelInputRef={labelInputRef}
          editing={!!editingId}
          type={type}
          label={label}
          location={location}
          stageRef={stageRef}
          meetAt={meetAt}
          meetAtError={meetAtError}
          recursDaily={recursDaily}
          coords={coords}
          festivalTimeZone={festivalTimeZone}
          locating={locating}
          submitting={submitting}
          onTypeChange={setType}
          onLabelChange={setLabel}
          onLocationChange={setLocation}
          onStageRefChange={setStageRef}
          onMeetAtChange={setMeetAt}
          onRecursDailyChange={setRecursDaily}
          onCoordsChange={setCoords}
          onSubmit={submit}
          onReset={reset}
          onCapture={captureLocation}
        />
      )}

      <div id="meeting-points-panel">
      {view === 'map' && (
        <>
        <Button
          variant="secondary"
          aria-pressed={placing}
          onClick={() => setPlacing((v) => !v)}
          className="w-full min-h-11"
        >
          {placing ? (
            'Cancel'
          ) : (
            <>
              <MapPin className="w-4 h-4" aria-hidden="true" /> Add meeting point here
            </>
          )}
        </Button>
        {placing && (
          <p role="status" className="text-xs text-text-secondary">
            Tap or click the map where you want to meet.
          </p>
        )}
        <Suspense
          fallback={
            <div className="h-72 rounded-xl border border-border bg-bg-secondary flex items-center justify-center text-sm text-text-secondary">
              Loading map…
            </div>
          }
        >
          <CrewMap hasList meetingPoints={current} peers={peers} activeSosList={sosList} festival={mapFestival} focusSosUserId={focusSosUserId}
            onMapClick={placing ? startCreateAt : undefined}
            onSetMeetingPoint={handleSetMeetingPoint}
            authoring={placing}
            draftPoints={showForm && !editingId && coords ? [{ latitude: coords.lat, longitude: coords.lng }] : undefined}
          />
        </Suspense>
        </>
      )}

      {view === 'list' && (
        <>
          {/* With no points the empty state carries the only Add button. */}
          {!showForm && (current.length > 0 || past.length > 0) && (
            <Button variant="primary" onClick={() => setShowForm(true)} className="w-full min-h-11">
              <Plus className="w-4 h-4" aria-hidden="true" /> Add meeting point
            </Button>
          )}

          {current.length === 0 && past.length === 0 ? (
            !showForm && <EmptyState
              illustration="emptyList"
              title="No meeting points yet"
              description="Drop a pin so your crew knows where to meet."
              cta={{ label: 'Add meeting point', onClick: () => setShowForm(true) }}
            />
          ) : (
            <>
            <div className="space-y-2">
              {current.filter((p) => !hiddenIds.has(p.id)).map((p) => (
                <MeetingPointCard
                  key={p.id}
                  point={p}
                  currentUserId={currentUserId}
                  isOwner={isOwner}
                  festivalDays={festivalDays}
                  festivalTimeZone={festivalTimeZone}
                  nowMs={nowMs}
                  onToggleComing={toggleComing}
                  onDirections={openDirections}
                  onEdit={startEdit}
                  onRemove={removePoint}
                />
              ))}
            </div>
            {past.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-text-muted">Past</h4>
                {past.map((p) => (
                  <PastMeetingPointCard key={p.id} point={p} onDirections={openDirections} />
                ))}
              </div>
            )}
            </>
          )}
        </>
      )}
      </div>
    </div>
  );
}
