import React, { useEffect } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useAuthStore, useFestivalStore } from '@festie/shared/stores';
import { useActiveCrew, useCrewFestival, useCrewHub, usePicks } from '@festie/shared/hooks';
import { artistDisplayName, formatTime, memberSummary, timeAgo } from '@festie/shared/utils';
import { useNow } from '../hooks/useSetStatus';
import { PRIORITY_LABEL } from '@festie/shared/constants';
import type { Priority } from '@festie/shared/types';
import FreshnessChip from '../components/features/FreshnessChip';
import EmptyState from '../components/ui/EmptyState';
import Button from '../components/ui/Button';
import PriorityIcon from '../components/ui/PriorityIcon';
import CrewPlanSkeleton from '../components/ui/skeletons/CrewPlanSkeleton';
import { Card } from '../components/ui/Card';
import { RenderErrorBoundary } from '../components/layout/RouteErrorBoundary';
import { MapPin, Home, CalendarClock, Users, ArrowLeft, Trophy, Sparkles, Radio, Vote } from 'lucide-react';

// The plan renders from the persisted cache first (useCrewHub reads the stores),
// then refreshes statuses, meeting points and polls. A crew on another festival
// switches the festival store first (useCrewFestival).
// Per-priority badge tint using the priority tokens (must=coral, want=aqua,
// maybe=amber). Static literal class strings so Tailwind detects them.
const PRIORITY_BADGE: Record<Priority, string> = {
  must: 'bg-priority-must/15 text-priority-must',
  'want-to-see': 'bg-priority-want/15 text-priority-want',
  maybe: 'bg-priority-maybe/15 text-priority-maybe',
};

const EMPTY_LINK =
  'inline-flex items-center min-h-11 text-sm font-medium text-accent-aqua underline underline-offset-2';

export default function CrewPlanView() {
  return (
    <RenderErrorBoundary name="crew-plan">
      <CrewPlanInner />
    </RenderErrorBoundary>
  );
}

function CrewPlanInner() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const { status, crew, retry: retryCrew } = useActiveCrew();
  const festival = useCrewFestival(crew);

  useEffect(() => {
    if (!user) navigate({ to: '/login' }).catch(() => {});
  }, [user, navigate]);

  if (!user) return null;

  if (status === 'loading') return <CrewPlanSkeleton />;

  if (status === 'error') {
    return (
      <Gate>
        <EmptyState
          icon={<Users className="w-12 h-12" aria-hidden="true" />}
          title="Couldn't load your crew"
          description="Check your connection, then try again."
          cta={{ label: 'Try again', onClick: retryCrew }}
        />
      </Gate>
    );
  }

  if (status === 'none' || !crew) {
    return (
      <Gate>
        <EmptyState
          icon={<Users className="w-12 h-12" aria-hidden="true" />}
          title="No crew yet"
          description="Make a crew or join one with a code to plan together."
          cta={{ label: 'Create or join a crew', onClick: () => navigate({ to: '/crew' }) }}
        />
      </Gate>
    );
  }

  if (festival.state === 'switching') {
    return (
      <div>
        <p className="text-sm text-text-secondary text-center pt-4" role="status">
          Opening {festival.festivalName}…
        </p>
        <CrewPlanSkeleton />
      </div>
    );
  }

  if (festival.state === 'failed') {
    return (
      <Gate>
        <EmptyState
          icon={<Users className="w-12 h-12" aria-hidden="true" />}
          title={`Couldn't open ${festival.festivalName}`}
          description={`${crew.name} is planning ${festival.festivalName}. Connect to the internet, then try again.`}
          cta={{ label: 'Try again', onClick: festival.retry }}
        />
      </Gate>
    );
  }

  return <CrewPlanContent />;
}

function Gate({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-4 pb-6 max-w-[600px] mx-auto w-full">
      <BackLink />
      <Card padding="lg">{children}</Card>
    </div>
  );
}

function CrewPlanContent() {
  const navigate = useNavigate();
  const hub = useCrewHub(useNow());
  const { savePick } = usePicks();
  const currentFestival = useFestivalStore((s) => s.currentFestival);
  const stages = useFestivalStore((s) => s.stages);
  const { crew, isOwner, ownerName, meetingPoint, isPast, upNext, howWeDid, mix, whereabouts, openPolls, myPicks } =
    hub;

  if (!crew) return null;

  const openCrew = (tab: 'find' | 'members' | 'plan') => navigate({ to: '/crew', search: { tab } }).catch(() => {});
  const memberLabel = `${hub.memberCount} ${hub.memberCount === 1 ? 'member' : 'members'}`;

  return (
    <div className="space-y-4 pb-6 max-w-2xl mx-auto px-3 w-full">
      <BackLink />

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-xl font-display font-bold text-text-primary">{crew.name}’s plan</h1>
          <p className="text-sm text-text-secondary">
            {hub.festivalName ? `${hub.festivalName} · ` : ''}
            {memberLabel}
          </p>
        </div>
        <FreshnessChip surface="crew" />
      </div>

      {/* Active meeting point */}
      <Card padding="md">
        <Card.Header>
          <MapPin className="w-5 h-5 text-text-secondary flex-shrink-0" aria-hidden="true" />
          <span className="font-semibold text-text-primary">Meet up</span>
        </Card.Header>
        <Card.Body>
          {meetingPoint ? (
            <div className="space-y-1">
              <p className="text-text-primary font-medium">{meetingPoint.label}</p>
              <p className="text-sm text-text-secondary">{meetingPoint.location}</p>
              {meetingPoint.meet_at && (
                <p className="text-sm text-accent-aqua font-medium">
                  {new Date(meetingPoint.meet_at).toLocaleString([], {
                    weekday: 'short',
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-text-secondary">No meeting point yet.</p>
              <Button variant="secondary" size="sm" onClick={() => openCrew('find')}>
                Add meeting point
              </Button>
            </div>
          )}
        </Card.Body>
      </Card>

      {/* Crew home base */}
      <Card padding="md">
        <Card.Header>
          <Home className="w-5 h-5 text-accent-aqua flex-shrink-0" aria-hidden="true" />
          <span className="font-semibold text-text-primary">Home base</span>
        </Card.Header>
        <Card.Body>
          {crew.homeBaseLocation || crew.homeBaseTime ? (
            <div className="space-y-1">
              {crew.homeBaseLocation && <p className="text-text-primary font-medium">{crew.homeBaseLocation}</p>}
              {crew.homeBaseTime && <p className="text-sm text-text-secondary">{crew.homeBaseTime}</p>}
            </div>
          ) : isOwner ? (
            <div className="space-y-2">
              <p className="text-sm text-text-secondary">No home base yet.</p>
              <Button variant="secondary" size="sm" onClick={() => openCrew('find')}>
                Set home base
              </Button>
            </div>
          ) : (
            <p className="text-sm text-text-secondary">
              No home base yet. Ask {ownerName ?? 'the crew owner'} to set one.
            </p>
          )}
        </Card.Body>
      </Card>

      {isPast ? (
        <Card padding="md">
          <Card.Header>
            <Trophy className="w-5 h-5 text-text-secondary flex-shrink-0" aria-hidden="true" />
            <span className="font-semibold text-text-primary">How the crew did</span>
          </Card.Header>
          <Card.Body className="space-y-2">
            {howWeDid.length === 0 ? (
              <p className="text-sm text-text-secondary">Your crew had no picks in common at this festival.</p>
            ) : (
              <ul className="space-y-1">
                {howWeDid.map((e) => (
                  <li key={e.set.id}>
                    <Link
                      to="/set/$setId"
                      params={{ setId: e.set.id }}
                      className="inline-flex items-center min-h-11 text-sm hover:underline"
                    >
                      {artistDisplayName(e.set)} · {e.count} of {e.total} picked it
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <Link to="/wrap" className={EMPTY_LINK}>
              See your Wrap
            </Link>
          </Card.Body>
        </Card>
      ) : (
        <Card padding="md">
          <Card.Header>
            <CalendarClock className="w-5 h-5 text-text-secondary flex-shrink-0" aria-hidden="true" />
            <span className="font-semibold text-text-primary">Up next</span>
          </Card.Header>
          <Card.Body className="space-y-4">
            {upNext.length === 0 ? (
              <div className="space-y-2">
                <p className="text-sm text-text-secondary">No crew picks coming up.</p>
                <div className="flex flex-wrap gap-x-4">
                  <Link to="/cards" className={EMPTY_LINK}>
                    Browse the lineup
                  </Link>
                  <Link to="/crew" search={{ tab: 'members' }} className={EMPTY_LINK}>
                    Invite your crew
                  </Link>
                </div>
              </div>
            ) : (
              upNext.map((slot) => (
                <div key={slot.startMs} className="space-y-2">
                  <p className="text-xs uppercase tracking-[var(--letter-spacing-caps)] text-text-secondary font-semibold">
                    {slot.startTime ? formatTime(slot.startTime) : 'Soon'}
                  </p>
                  <ul className="space-y-1.5">
                    {slot.groups.map((g) => {
                      const stageName = stages?.find((st) => st.id === g.set.stageId)?.name;
                      return (
                        <li key={g.set.id} className="flex items-center gap-2">
                          <Link
                            to="/set/$setId"
                            params={{ setId: g.set.id }}
                            className="flex flex-1 min-w-0 items-center gap-2 min-h-11 text-sm hover:underline"
                          >
                            <span
                              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold flex-shrink-0 ${PRIORITY_BADGE[g.priority]}`}
                              aria-label={PRIORITY_LABEL[g.priority]}
                            >
                              <PriorityIcon priority={g.priority} className="w-3 h-3" filled />
                              {PRIORITY_LABEL[g.priority]}
                            </span>
                            <span className="truncate">
                              <span className="text-text-primary font-medium">{artistDisplayName(g.set)}</span>
                              {stageName && <span className="text-text-secondary"> · {stageName}</span>}
                              <span className="text-text-secondary"> · {memberSummary(g.names)}</span>
                            </span>
                          </Link>
                          {!myPicks[g.set.id] && currentFestival && (
                            <Button
                              variant="utility"
                              size="sm"
                              aria-label={`Add ${artistDisplayName(g.set)} to my picks`}
                              onClick={() => {
                                savePick(currentFestival.id, g.set.id, g.priority).catch(() => {});
                              }}
                            >
                              Add
                            </Button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))
            )}
          </Card.Body>
        </Card>
      )}

      {!isPast && mix.length > 0 && (
        <Card padding="md">
          <Card.Header>
            <Sparkles className="w-5 h-5 text-text-secondary flex-shrink-0" aria-hidden="true" />
            <span className="font-semibold text-text-primary">Crew mix</span>
          </Card.Header>
          <Card.Body>
            <ul className="space-y-1">
              {mix.map((e) => (
                <li key={e.set.id}>
                  <Link
                    to="/set/$setId"
                    params={{ setId: e.set.id }}
                    className="flex flex-col justify-center min-h-11 text-sm hover:underline"
                  >
                    <span className="text-text-primary font-medium">{artistDisplayName(e.set)}</span>
                    <span className="text-text-secondary">
                      {e.count} of {e.total} want this
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card.Body>
        </Card>
      )}

      {whereabouts.length > 0 && (
        <Card padding="md">
          <Card.Header>
            <Radio className="w-5 h-5 text-text-secondary flex-shrink-0" aria-hidden="true" />
            <span className="font-semibold text-text-primary">Where everyone is</span>
          </Card.Header>
          <Card.Body className="space-y-1">
            <ul className="space-y-1">
              {whereabouts.map((w) => {
                const detail = w.sos ? 'Sent an SOS' : w.live === 'live' ? 'Sharing live location' : (w.statusLabel ?? 'Location shared');
                const at = w.liveAt ?? w.statusAt;
                return (
                  <li key={w.userId} className="text-sm text-text-secondary">
                    {`${w.name} · ${detail}${at != null ? ` · ${timeAgo(at)}` : ''}`}
                  </li>
                );
              })}
            </ul>
            <Link to="/crew" search={{ tab: 'find' }} className={EMPTY_LINK}>
              Open crew
            </Link>
          </Card.Body>
        </Card>
      )}

      {openPolls.length > 0 && (
        <Card padding="md">
          <Card.Header>
            <Vote className="w-5 h-5 text-text-secondary flex-shrink-0" aria-hidden="true" />
            <span className="font-semibold text-text-primary">Open polls</span>
          </Card.Header>
          <Card.Body className="space-y-2">
            <ul className="space-y-1">
              {openPolls.slice(0, 2).map((p) => (
                <li key={p.id} className="text-sm text-text-primary">
                  {p.question}
                </li>
              ))}
            </ul>
            {openPolls.length > 2 && <p className="text-sm text-text-secondary">+{openPolls.length - 2} more</p>}
            <Button variant="secondary" size="sm" onClick={() => openCrew('plan')}>
              Vote
            </Button>
          </Card.Body>
        </Card>
      )}
    </div>
  );
}

function BackLink() {
  return (
    <Link
      to="/crew"
      aria-label="Back to crew"
      className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors"
    >
      <ArrowLeft className="w-4 h-4" aria-hidden="true" />
      <span>Back to crew</span>
    </Link>
  );
}
