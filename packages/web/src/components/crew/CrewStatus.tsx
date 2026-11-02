import React, { useEffect, useMemo, useState } from 'react';
import {
  useCrewStore,
  formatStaleness,
  etaMinutes,
  writeOutcomeMessage,
  type CrewMemberStatus,
  type CrewMeetingPoint,
  type CrewStatusKey,
} from '@festie/shared';
import { useCurrentPosition, useAutoArrive, useFestival } from '@festie/shared/hooks';
import { useFestivalStore } from '@festie/shared/stores';
import {
  CREW_STATUS_PRESETS,
  arrivedMessage,
  crewStatusLabel,
  isStatusFresh,
  noStatusLine,
  presetStageName,
  resolveFestivalTimeZone,
  selectNowNext,
  statusNoteLine,
} from '@festie/shared/utils';
import { useToast } from '../../lib/toastContext';
import Button from '../ui/Button';
import EmptyState from '../ui/EmptyState';
import Skeleton from '../ui/Skeleton';
import Avatar from '../ui/Avatar';
import {
  Navigation,
  LocateFixed,
  X,
  MapPin,
  Footprints,
  CircleCheck,
  Hourglass,
  Tent,
  Music,
  Coffee,
  LifeBuoy,
} from 'lucide-react';
import { inputBase } from '../../lib/styles';

interface Props {
  crewId: string;
  currentUserId: string;
  festivalId?: string;
  /** Meeting points (for the ETA-target picker + coord-based ETA). */
  meetingPoints: CrewMeetingPoint[];
}

// Status key → lucide icon. Labels come from crewStatusLabel (shared).
// Icons (not emoji) keep the crew UI on the app's single icon vocabulary.
const STATUS_META: Record<CrewStatusKey, { Icon: React.ComponentType<{ className?: string }> }> = {
  'on-my-way': { Icon: Footprints },
  here: { Icon: CircleCheck },
  delayed: { Icon: Hourglass },
  'at-camp': { Icon: Tent },
  'at-stage': { Icon: Music },
  break: { Icon: Coffee },
  lost: { Icon: LifeBuoy },
};

/**
 * Crew member status (M5) — last-synced "On my way to [meeting point] · ETA ~N
 * min" action + a crew status list with HONEST staleness.
 *
 * CARDINAL RULE: this is offline-DEGRADED-SYNCS, NOT live GPS. Every row is a
 * snapshot the member set (often offline) that delivered on the next signal
 * blip. The copy ALWAYS says "as of N ago" (formatStaleness) and "sent when
 * signal returns" — it NEVER implies a live, moving position.
 *
 * Offline path: updateMyStatus queues the PUT with a deterministic clientId so
 * repeated toggles collapse, optimistically upserts my row, and reconciles on
 * reconnect. ETA is computed from the device's last captured position to the
 * target meeting point's saved coord (geo.ts) when both exist; otherwise the
 * member can type a manual estimate.
 */
export default function CrewStatus({ crewId, currentUserId, meetingPoints }: Props) {
  const { toast, toastError } = useToast();

  const statuses = useCrewStore((s) => s.crewStatuses);
  const loadStatuses = useCrewStore((s) => s.loadStatuses);
  const updateMyStatus = useCrewStore((s) => s.updateMyStatus);
  const crewMembers = useCrewStore((s) => s.crewMembers);

  const sets = useFestivalStore((s) => s.sets);
  const days = useFestivalStore((s) => s.days);
  const picks = useFestivalStore((s) => s.currentProfile?.picks);
  const currentFestival = useFestivalStore((s) => s.currentFestival);
  const { getStageName } = useFestival();

  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const [showPresets, setShowPresets] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [targetId, setTargetId] = useState<string>('');
  const [manualEta, setManualEta] = useState<string>('');
  const [note, setNote] = useState('');
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const { locating, getCurrentPosition } = useCurrentPosition();
  const [busy, setBusy] = useState(false);
  // Local load state around crewStore's loadStatuses: the store's crewLoading/error
  // aren't scoped per sub-resource (crewLoading never toggles for loadStatuses, and
  // error is shared across every crew tab), so real isLoading/isError needs to be
  // tracked here rather than pulled from the store.
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  // Load once per crew. Offline this resolves from the persisted read-cache.
  useEffect(() => {
    if (!crewId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadError(false);
    loadStatuses(crewId)
      .catch(() => {
        if (!cancelled) setLoadError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [crewId, loadStatuses]);

  // Realtime crew:status-updated patching is wired centrally in
  // useRealtimeSync (it owns the single shared socket), so this component just
  // reads crewStore.crewStatuses — no per-component socket here.

  // Meeting points that actually have a saved coord — only these can produce a
  // geo-computed ETA. The picker still lists all points (coordless ones just
  // fall back to the manual estimate).
  const target = useMemo(() => meetingPoints.find((m) => m.id === targetId) ?? null, [meetingPoints, targetId]);

  // Geo-computed ETA: device position → target coord. null when either is
  // missing (no coord target, or no captured position) — then the manual
  // estimate is used.
  const computedEta = useMemo(() => {
    if (!coords || !target || typeof target.latitude !== 'number' || typeof target.longitude !== 'number') {
      return null;
    }
    return etaMinutes(
      { latitude: coords.lat, longitude: coords.lng },
      { latitude: target.latitude, longitude: target.longitude },
    );
  }, [coords, target]);

  const effectiveEta = computedEta ?? (manualEta.trim() ? Number(manualEta.trim()) : null);

  const stageName = useMemo(
    () =>
      presetStageName(
        selectNowNext({ sets, days, picks: picks ?? {}, nowMs, timeZone: resolveFestivalTimeZone(currentFestival) }),
        nowMs,
        getStageName,
      ),
    [sets, days, picks, nowMs, currentFestival, getStageName],
  );

  useAutoArrive({
    crewId,
    userId: currentUserId,
    meetingPoints,
    onArrive: (label) => toast(arrivedMessage(label), 'success'),
  });

  function reset() {
    setTargetId('');
    setManualEta('');
    setNote('');
    setCoords(null);
    setShowForm(false);
  }

  // Capture the device position (browser Geolocation — no dep). Used to compute
  // a distance-based ETA to the target meeting point's saved coord. Denial
  // gracefully falls back to the manual estimate.
  async function captureLocation() {
    const pos = await getCurrentPosition((message) =>
      toast(
        message === 'Location is not available on this device'
          ? message
          : "Couldn't get your location — type an ETA estimate instead",
        'error',
      ),
    );
    if (pos) {
      setCoords({ lat: pos.lat, lng: pos.lng });
      toast('Location captured for ETA', 'success');
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const eta = effectiveEta != null && Number.isFinite(effectiveEta) ? Math.round(effectiveEta) : null;
      const outcome = await updateMyStatus(
        crewId,
        {
          status: 'on-my-way',
          targetMeetingPointId: targetId || null,
          etaMinutes: eta != null && eta >= 0 ? Math.min(eta, 1440) : null,
          note: note.trim() || null,
          // Persist the captured device coord as a last-synced breadcrumb (never
          // live). Omit position entirely when nothing was captured so the
          // server COALESCEs and leaves any prior breadcrumb untouched.
          ...(coords ? { position: { lat: coords.lat, lng: coords.lng } } : {}),
        },
        currentUserId,
      );
      // Honest, never "live": say "shared" only after the server ack.
      toast(writeOutcomeMessage(outcome, 'Status shared'), outcome === 'queued' ? 'info' : 'success');
      reset();
    } catch (err) {
      toastError(err, "Couldn't share status. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function sendPreset(key: CrewStatusKey) {
    if (busy) return;
    if (key === 'on-my-way') {
      setShowPresets(false);
      setShowForm(true);
      return;
    }
    setBusy(true);
    try {
      // "Lost" also saves the last-known position; a failed fix sends without one.
      const pos = key === 'lost' ? await getCurrentPosition() : undefined;
      const outcome = await updateMyStatus(
        crewId,
        {
          status: key,
          targetMeetingPointId: null,
          etaMinutes: null,
          note: key === 'at-stage' ? stageName : null,
          ...(pos ? { position: { lat: pos.lat, lng: pos.lng } } : {}),
        },
        currentUserId,
      );
      toast(writeOutcomeMessage(outcome, 'Status shared'), outcome === 'queued' ? 'info' : 'success');
      setShowPresets(false);
    } catch (err) {
      toastError(err, "Couldn't share status. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function clearMine() {
    setBusy(true);
    try {
      const outcome = await updateMyStatus(
        crewId,
        { status: null, targetMeetingPointId: null, etaMinutes: null, note: null },
        currentUserId,
      );
      toast(writeOutcomeMessage(outcome, 'Status cleared'), outcome === 'queued' ? 'info' : 'success');
    } catch (err) {
      toastError(err, "Couldn't clear status. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const freshStatuses = statuses.filter((s) => isStatusFresh(s, nowMs));
  const mine = freshStatuses.find((s) => s.user_id === currentUserId);
  const labelFor = (id: string | null) => (id ? (meetingPoints.find((m) => m.id === id)?.label ?? null) : null);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text-primary flex items-center gap-1.5">
          <Navigation className="w-4 h-4 text-accent-aqua" aria-hidden="true" /> Crew status
        </h3>
        {!showForm && !showPresets && (
          <Button variant="outline" onClick={() => setShowPresets(true)} className="text-xs">
            {mine ? 'Update mine' : 'Share status'}
          </Button>
        )}
      </div>

      {/* Honesty banner: this is NEVER live. */}
      <p className="text-[length:var(--font-size-12)] text-text-muted leading-snug">
        Statuses show where each crewmate was when they last synced. Sent when signal returns. Live location sharing is separate, below.
      </p>

      {showPresets && (
        <div className="p-3 rounded-lg bg-bg-card border border-border space-y-3">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-sm text-text-primary">Share my status</span>
            <button
              type="button"
              aria-label="Cancel"
              onClick={() => setShowPresets(false)}
              className="text-text-muted hover:text-text-primary"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2" role="group" aria-label="Status presets">
            {CREW_STATUS_PRESETS.filter((p) => p.key !== 'at-stage' || stageName).map((p) => {
              const { Icon } = STATUS_META[p.key];
              return (
                <button
                  key={p.key}
                  type="button"
                  disabled={busy}
                  onClick={() => sendPreset(p.key)}
                  className="px-2 py-2 rounded-lg border border-border bg-bg-card text-text-secondary hover:border-border-light text-xs font-medium min-h-11 flex items-center gap-2 text-left transition-colors"
                >
                  <Icon className="w-5 h-5 shrink-0" aria-hidden="true" />
                  <span>{p.key === 'at-stage' ? `At ${stageName}` : p.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {showForm && (
        <form onSubmit={submit} className="p-3 rounded-lg bg-bg-card border border-border space-y-3">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-sm text-text-primary">On my way</span>
            <button
              type="button"
              aria-label="Cancel"
              onClick={reset}
              className="text-text-muted hover:text-text-primary"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* ETA target: a meeting point. Coordless points still work (manual ETA). */}
          <label className="block text-xs text-text-secondary">
            Heading to
            <select
              className={`${inputBase} min-h-11 mt-1`}
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
              aria-label="Target meeting point"
            >
              <option value="">— no specific point —</option>
              {meetingPoints.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                  {typeof m.latitude === 'number' && typeof m.longitude === 'number' ? ' (pinned)' : ''}
                </option>
              ))}
            </select>
          </label>

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
            {computedEta != null ? (
              <span className="text-xs text-accent-aqua font-medium">ETA ~{computedEta} min</span>
            ) : (
              <input
                type="number"
                min={0}
                max={1440}
                inputMode="numeric"
                className={`${inputBase} min-h-11 w-28`}
                placeholder="ETA min"
                aria-label="ETA in minutes"
                value={manualEta}
                onChange={(e) => setManualEta(e.target.value)}
              />
            )}
          </div>

          <input
            className={`${inputBase} min-h-11`}
            placeholder="Note (optional, e.g. 'grabbing water first')"
            aria-label="Status note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={280}
          />

          <Button type="submit" variant="primary" isLoading={busy} className="w-full min-h-11">
            {target
              ? `On my way to ${target.label}${effectiveEta != null ? ` · ETA ~${Math.round(effectiveEta)} min` : ''}`
              : 'Share status'}
          </Button>
        </form>
      )}

      {/* Crew status list with HONEST staleness. */}
      {loading ? (
        <div className="space-y-2">
          <Skeleton variant="card" />
          <Skeleton variant="card" />
        </div>
      ) : loadError ? (
        <EmptyState
          icon={<Navigation className="w-12 h-12" aria-hidden="true" />}
          title="Couldn't load crew status"
          description="Something went wrong loading crew status."
          cta={{
            label: 'Retry',
            onClick: () => {
              setLoading(true);
              setLoadError(false);
              loadStatuses(crewId)
                .catch(() => setLoadError(true))
                .finally(() => setLoading(false));
            },
          }}
        />
      ) : (
        freshStatuses.length === 0 ? (
          crewMembers.length > 0 && (
            <div role="note" className="flex items-center gap-2 text-xs text-text-secondary">
              <div className="flex -space-x-1.5">
                {crewMembers.slice(0, 6).map((m) => (
                  <Avatar key={m.userId} size="xs" name={m.name || m.username} />
                ))}
              </div>
              <span>{noStatusLine(crewMembers.length)}</span>
            </div>
          )
        ) : (
        <ul className="space-y-2">
          {freshStatuses
            .map((s: CrewMemberStatus) => {
              const meta = s.status ? STATUS_META[s.status] : null;
              const isMe = s.user_id === currentUserId;
              const targetLabel = labelFor(s.target_meeting_point_id);
              return (
                <li key={s.user_id} className="p-2.5 rounded-lg bg-bg-card border border-border">
                  <div className="flex items-start gap-2">
                    {meta ? (
                      <meta.Icon className="w-5 h-5 text-text-secondary shrink-0" aria-hidden="true" />
                    ) : (
                      <MapPin className="w-5 h-5 text-text-muted shrink-0" aria-hidden="true" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-text-primary truncate">
                          {isMe ? 'You' : s.name || s.username || 'Crewmate'}
                        </span>
                        <span className="text-xs text-text-secondary">{crewStatusLabel(s) ?? ''}</span>
                      </div>
                      {targetLabel && (
                        <div className="text-xs text-accent-aqua mt-0.5 flex items-center gap-1">
                          <MapPin className="w-3 h-3" aria-hidden="true" />
                          {targetLabel}
                          {typeof s.eta_minutes === 'number' ? ` · ETA ~${s.eta_minutes} min` : ''}
                        </div>
                      )}
                      {!targetLabel && typeof s.eta_minutes === 'number' && (
                        <div className="text-xs text-accent-aqua mt-0.5">ETA ~{s.eta_minutes} min</div>
                      )}
                      {statusNoteLine(s) && (
                        <div className="text-xs text-text-secondary mt-0.5">{statusNoteLine(s)}</div>
                      )}
                      {/* Last-synced breadcrumb — NOT live. Staleness is read from
                          location_captured_at (when the device stamped the fix),
                          distinct from updated_at (when the row last synced). */}
                      {typeof s.latitude === 'number' && typeof s.longitude === 'number' && s.location_captured_at && (
                        <a
                          href={`https://maps.google.com/?q=${s.latitude},${s.longitude}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[length:var(--font-size-12)] text-text-secondary hover:text-accent-aqua mt-0.5 inline-flex items-center gap-1"
                        >
                          <MapPin className="w-3 h-3" aria-hidden="true" />
                          last seen {formatStaleness(s.location_captured_at)}
                        </a>
                      )}
                      {/* Honest staleness — the cardinal rule. */}
                      <div className="text-[length:var(--font-size-12)] text-text-muted mt-1">{formatStaleness(s.updated_at)}</div>
                    </div>
                    {isMe && (
                      <button
                        type="button"
                        onClick={clearMine}
                        disabled={busy}
                        className="text-[length:var(--font-size-12)] text-text-muted hover:text-accent-coral shrink-0 min-h-11 min-w-11 inline-flex items-center px-2"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
        </ul>
        )
      )}
    </div>
  );
}
