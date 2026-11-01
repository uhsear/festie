import React, { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  api,
  meetingTimeDisplay,
  meetAtFromWallInput,
  meetAtToWallInput,
  resolveFestivalTimeZone,
  writeOutcomeOf,
  writeOutcomeMessage,
  isPending,
} from '@festie/shared';
import type { CrewMeetingPoint } from '@festie/shared/types';
import { useFestivalStore } from '@festie/shared/stores';
import { useCurrentPosition } from '@festie/shared/hooks';
import { useLiveLocationStore } from '@festie/shared/stores/liveLocationStore';
import { useToast } from '../../lib/toastContext';
import SyncMarker from './SyncMarker';
import { useUndoableRemove } from './useUndoableRemove';
import Button from '../ui/Button';
import EmptyState from '../ui/EmptyState';
import Skeleton from '../ui/Skeleton';
import {
  MapPin,
  Plus,
  Trash2,
  X,
  Navigation,
  Pencil,
  LocateFixed,
  Check,
  Map as MapIcon,
  List,
  Repeat,
  Clock,
} from 'lucide-react';
import { COPY, MEETING_POINT_KINDS, meetingPointKind } from '@festie/shared/constants';
import { CONCEPT_ICON } from '../../lib/conceptIcons';
import IconButton from '../ui/IconButton';
import { inputBase } from '../../lib/styles';
import CrewStatus from './CrewStatus';
import LiveLocationControls from './LiveLocationControls';
import { useRovingTabs } from '@/hooks/useRovingTabs';

// Lazy: CrewMap pulls in maplibre-gl (~200 kB gzip) at runtime. Keeping it behind
// lazy() puts it in its own chunk so it never lands in the main bundle (mirrors
// the router's lazy() pattern for heavy views) and only loads when Map is opened.
const CrewMap = lazy(() => import('./CrewMap'));

// How often we sweep stale peers off the map while it's mounted (defense in
// depth alongside the server's 120s Redis TTL + peer-stopped broadcasts).
const SWEEP_INTERVAL_MS = 15_000;

interface MeetingPointPayload {
  label: string;
  location: string;
  type: string;
  meetAt?: string | null;
  stageReference?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  recursDaily?: boolean;
}

interface Props {
  crewId: string;
  currentUserId: string;
  /** Raiser to aim the map at; opens Map view. */
  focusSosUserId?: string;
}

export default function MeetingPointsTab({ crewId, currentUserId, focusSosUserId }: Props) {
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
  const { locating, getCurrentPosition } = useCurrentPosition();
  // List vs Map view. Map is lazy + reveals <CrewMap/> only when chosen.
  const [view, setView] = useState<'list' | 'map'>(focusSosUserId ? 'map' : 'list');
  useEffect(() => {
    if (focusSosUserId) setView('map');
  }, [focusSosUserId]);
  const viewTablistRef = useRef<HTMLDivElement>(null);
  useRovingTabs(viewTablistRef);

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
  useEffect(() => {
    useLiveLocationStore.getState().setActiveCrew(crewId);
    return () => {
      // Leaving the tab stops local sharing bookkeeping (re-opt-in on return). The
      // crew scope stays: useLiveLocationCrewSync owns it app-wide, and clearing it
      // here wiped active SOS from the app-wide banner.
      useLiveLocationStore.getState().stopSharing();
    };
  }, [crewId]);

  useEffect(() => {
    const id = setInterval(() => useLiveLocationStore.getState().sweepStale(Date.now()), SWEEP_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  const {
    data: points = [],
    isLoading,
    isError,
    refetch,
  } = useQuery<CrewMeetingPoint[]>({
    queryKey: ['meeting-points', crewId],
    queryFn: async () => {
      const res = await api.get<CrewMeetingPoint[] | { meetingPoints: CrewMeetingPoint[] }>(`/crews/${crewId}/meeting-points`);
      return Array.isArray(res) ? res : res?.meetingPoints || [];
    },
    enabled: !!crewId,
  });

  const createPoint = useMutation({
    mutationFn: (payload: MeetingPointPayload) => api.post(`/crews/${crewId}/meeting-points`, payload),
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
    mutationFn: ({ id, payload }: { id: string; payload: MeetingPointPayload }) =>
      api.put(`/crews/${crewId}/meeting-points/${id}`, payload),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['meeting-points', crewId] });
      const outcome = writeOutcomeOf(result);
      toast(writeOutcomeMessage(outcome, 'Meeting point updated'), outcome === 'queued' ? 'info' : 'success');
      reset();
    },
    onError: (e) => toastError(e, "Couldn't update meeting point. Try again."),
  });

  const { hiddenIds, remove: removePoint } = useUndoableRemove(async (id) => {
    const result = await api.delete(`/crews/${crewId}/meeting-points/${id}`);
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

  function startEdit(p: CrewMeetingPoint) {
    setEditingId(p.id);
    setLabel(p.label);
    setLocation(p.location);
    setStageRef(p.stage_reference || '');
    setType(meetingPointKind(p.type).type);
    // datetime-local wants "YYYY-MM-DDTHH:mm", shown in the festival zone.
    setMeetAt(p.meet_at ? meetAtToWallInput(p.meet_at, festivalTimeZone) : '');
    setRecursDaily(!!p.recurs_daily);
    setCoords(
      typeof p.latitude === 'number' && typeof p.longitude === 'number' ? { lat: p.latitude, lng: p.longitude } : null,
    );
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

  function openDirections(loc: string) {
    window.open(`https://maps.google.com/?q=${encodeURIComponent(loc)}`, '_blank', 'noopener,noreferrer');
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim() || !location.trim()) return;
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
      updatePoint.mutate({ id: editingId, payload });
    } else {
      createPoint.mutate(payload);
    }
  }

  const submitting = createPoint.isPending || updatePoint.isPending;

  if (isLoading) {
    return (
      <div className="px-4 space-y-2">
        <Skeleton variant="card" />
        <Skeleton variant="card" />
      </div>
    );
  }
  if (isError) {
    return (
      <div className="px-4">
        <EmptyState
          icon={<MapPin className="w-12 h-12" aria-hidden="true" />}
          title="Couldn't load meeting points"
          description="Something went wrong loading meeting points."
          cta={{ label: 'Retry', onClick: () => refetch() }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-3 px-4">
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
      <CrewStatus crewId={crewId} currentUserId={currentUserId} meetingPoints={points} />

      {/* List/Map toggle. Map lazy-loads MapLibre only when selected. */}
      <div
        ref={viewTablistRef}
        className="inline-flex gap-1 p-1 rounded-lg bg-bg-card border border-border"
        role="tablist"
        aria-label="Meeting points view"
      >
        <button
          type="button"
          role="tab"
          aria-selected={view === 'list'}
          aria-controls="meeting-points-panel"
          onClick={() => setView('list')}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium min-h-11 ${
            view === 'list' ? 'bg-accent-aqua/15 text-accent-aqua' : 'text-text-secondary hover:text-text-primary'
          }`}
        >
          <List className="w-4 h-4" aria-hidden="true" /> List
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === 'map'}
          aria-controls="meeting-points-panel"
          onClick={() => setView('map')}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium min-h-11 ${
            view === 'map' ? 'bg-accent-aqua/15 text-accent-aqua' : 'text-text-secondary hover:text-text-primary'
          }`}
        >
          <MapIcon className="w-4 h-4" aria-hidden="true" /> Map
        </button>
      </div>

      <div id="meeting-points-panel">
      {view === 'map' && (
        <Suspense
          fallback={
            <div className="h-72 rounded-lg border border-border bg-bg-secondary flex items-center justify-center text-sm text-text-secondary">
              Loading map…
            </div>
          }
        >
          <CrewMap meetingPoints={points} peers={peers} activeSosList={sosList} festival={mapFestival} focusSosUserId={focusSosUserId} />
        </Suspense>
      )}

      {view === 'list' && (
        <>
          {!showForm ? (
            // With no points the empty state carries the only Add button.
            points.length > 0 && (
              <Button variant="primary" onClick={() => setShowForm(true)} className="w-full min-h-11">
                <Plus className="w-4 h-4" aria-hidden="true" /> Add Meeting Point
              </Button>
            )
          ) : (
            <form onSubmit={submit} className="p-3 rounded-lg bg-bg-card border border-border space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-text-primary">
                  {editingId ? COPY.meetingPoint.edit : COPY.meetingPoint.add}
                </h3>
                <IconButton label="Cancel" icon={<X className="w-5 h-5" />} onClick={reset} />
              </div>

              <div className="crew-type-grid grid grid-cols-2 gap-2" role="radiogroup" aria-label="Meeting point type">
                {MEETING_POINT_KINDS.map((k) => {
                  const KindIcon = CONCEPT_ICON[k.icon];
                  return (
                    <button
                      key={k.type}
                      type="button"
                      role="radio"
                      aria-checked={type === k.type}
                      onClick={() => setType(k.type)}
                      className={`px-2 py-2 rounded-lg border text-xs font-medium min-h-11 flex flex-col items-center gap-1 transition-colors ${
                        type === k.type
                          ? 'bg-accent-aqua/15 border-accent-aqua text-accent-aqua'
                          : 'bg-bg-card border-border text-text-secondary hover:border-border-light'
                      }`}
                    >
                      <KindIcon className="w-4 h-4" aria-hidden="true" />
                      <span>{k.label}</span>
                    </button>
                  );
                })}
              </div>

              <input
                className={`${inputBase} min-h-11`}
                placeholder="Label (e.g. 'Main entrance')"
                aria-label="Label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                maxLength={100}
                required
              />
              <input
                className={`${inputBase} min-h-11`}
                placeholder="Location (e.g. 'Near the food court')"
                aria-label="Location"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                maxLength={200}
                required
              />
              <input
                className={`${inputBase} min-h-11`}
                placeholder="Near stage (optional, e.g. 'Main Stage')"
                aria-label="Near stage"
                value={stageRef}
                onChange={(e) => setStageRef(e.target.value)}
                maxLength={100}
              />
              <input
                type="datetime-local"
                className={`${inputBase} min-h-11`}
                placeholder="Meet at (optional)"
                aria-label={festivalTimeZone ? 'Meet at time, festival time' : 'Meet at time'}
                value={meetAt}
                onChange={(e) => setMeetAt(e.target.value)}
              />
              {festivalTimeZone && <p className="text-xs text-text-muted -mt-1">Festival time</p>}

              {/* 055: daily-recurrence toggle — only meaningful for a timed point.
                  Aqua = selected (accent discipline); 44px target. */}
              {meetAt && (
                <button
                  type="button"
                  role="switch"
                  aria-checked={recursDaily}
                  onClick={() => setRecursDaily((v) => !v)}
                  className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium min-h-11 transition-colors ${
                    recursDaily
                      ? 'bg-accent-aqua/15 border-accent-aqua text-accent-aqua'
                      : 'bg-bg-card border-border text-text-secondary hover:border-border-light'
                  }`}
                >
                  <Repeat className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span className="flex-1 text-left">Repeats daily</span>
                  {recursDaily && <Check className="w-4 h-4 shrink-0" aria-hidden="true" />}
                </button>
              )}

              {/* F4: optional GPS capture. Falls back to free-text on denial. */}
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={captureLocation}
                  isLoading={locating}
                  className="min-h-11"
                >
                  <LocateFixed className="w-4 h-4" aria-hidden="true" /> Use my location
                </Button>
                {coords && (
                  <span
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-accent-aqua/15 text-accent-aqua text-xs font-medium"
                    title={`${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`}
                  >
                    <Check className="w-3 h-3" aria-hidden="true" />
                    {coords.lat.toFixed(4)}, {coords.lng.toFixed(4)}
                    <button
                      type="button"
                      aria-label="Clear captured location"
                      onClick={() => setCoords(null)}
                      className="ml-0.5 hover:text-accent-coral"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                )}
              </div>

              <Button
                type="submit"
                variant="primary"
                isLoading={submitting}
                className="w-full min-h-11"
                disabled={!label.trim() || !location.trim()}
              >
                {editingId ? 'Save' : 'Add'}
              </Button>
            </form>
          )}

          {points.length === 0 ? (
            !showForm && <EmptyState
              illustration="emptyList"
              title="No meeting points yet"
              description="Drop a pin so your crew knows where to meet."
              cta={{ label: 'Add meeting point', onClick: () => setShowForm(true) }}
            />
          ) : (
            <div className="space-y-2">
              {points.filter((p) => !hiddenIds.has(p.id)).map((p) => {
                const meta = meetingPointKind(p.type);
                const KindIcon = CONCEPT_ICON[meta.icon];
                // A queued create has no server id yet, so it cannot be edited or removed.
                const mine = p.created_by === currentUserId && !isPending(p);
                const isEmergency = p.type === 'emergency';
                return (
                  <div
                    key={p.id}
                    className={`p-3 rounded-lg bg-bg-card border animate-[card-in_220ms_var(--ease-out,ease-out)_both] motion-reduce:!animate-none ${isEmergency ? 'border-accent-coral' : 'border-border'}`}
                  >
                    <div className="flex items-start gap-3">
                      <KindIcon
                        className={`w-5 h-5 shrink-0 mt-0.5 ${isEmergency ? 'text-accent-coral-strong' : 'text-text-secondary'}`}
                        aria-hidden="true"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-text-primary">{p.label}</span>
                          <span className="text-xs text-text-muted uppercase tracking-wide">{meta.label}</span>
                        </div>
                        <div className="text-sm text-text-secondary mt-0.5">{p.location}</div>
                        <SyncMarker item={p} />
                        {p.stage_reference && (
                          <div className="text-xs text-accent-aqua mt-0.5">Near {p.stage_reference}</div>
                        )}
                        {p.meet_at &&
                          (p.recurs_daily ? (
                            // 055: recurring point — show the daily time-of-day badge
                            // ("Daily · 3:00 PM") from the shared meetingTime helper.
                            <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-accent-aqua/15 px-2 py-0.5 text-xs font-medium text-accent-aqua">
                              <Repeat className="w-3 h-3" aria-hidden="true" />
                              {`Daily · ${meetingTimeDisplay(p.meet_at, true, festivalDays, new Date(), festivalTimeZone).label.replace(/^daily /, '')}`}
                            </div>
                          ) : (
                            <div className="text-xs text-accent-aqua mt-1 inline-flex items-center gap-1">
                              <Clock className="w-3 h-3" aria-hidden="true" />
                              {meetingTimeDisplay(p.meet_at, false, festivalDays, new Date(), festivalTimeZone).label}
                            </div>
                          ))}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <IconButton
                          label={`Directions to ${p.label}`}
                          icon={<Navigation className="w-4 h-4" />}
                          onClick={() => openDirections(p.location)}
                        />
                        {mine && (
                          <>
                            <IconButton
                              label="Edit meeting point"
                              icon={<Pencil className="w-4 h-4" />}
                              onClick={() => startEdit(p)}
                            />
                            <IconButton
                              label={`Remove meeting point ${p.label}`}
                              variant="danger"
                              icon={<Trash2 className="w-4 h-4" />}
                              onClick={() => removePoint(p.id, `"${p.label}"`)}
                            />
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
      </div>
    </div>
  );
}
