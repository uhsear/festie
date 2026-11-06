import { useMemo, useRef, useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { api } from '@festie/shared/services';
import { useFestivalStore, useAuthStore, useCrewStore, useUIStore } from '@festie/shared/stores';
import { COPY } from '@festie/shared/constants';
import type { WrapResponse } from '@festie/shared/types';
import {
  buildWrapCards,
  formatAmount,
  isWrapUnlocked,
  artistOf,
  selectSetsToRate,
  sortRatingsForWrap,
  summarizePlan,
  wrapByline,
} from '@festie/shared/utils';
import GuestTeaser from '../components/features/GuestTeaser';
import EmptyState from '../components/ui/EmptyState';
import { Card } from '../components/ui/Card';
import Skeleton from '../components/ui/Skeleton';
import WrapSkeleton from '../components/ui/skeletons/WrapSkeleton';
import Button from '../components/ui/Button';
import Switch from '../components/ui/Switch';
import CrewWrapPoster, { type CrewWrapData } from '../components/features/CrewWrapPoster';
import CrewPhotosCard from '../components/crew/CrewPhotosCard';
import { useToast } from '../lib/toastContext';
import { sharePoster } from '../lib/sharePoster';
import WrapHero from '../components/wrap/WrapHero';
import PosterPreview from '../components/wrap/PosterPreview';
import WrapCarousel from '../components/wrap/WrapCarousel';
import { useRovingTabs } from '../hooks/useRovingTabs';
import { RATING_META } from '../lib/ratingIcon';
import { RenderErrorBoundary } from '../components/layout/RouteErrorBoundary';
import { Sparkles, Trophy, Share2, Users } from 'lucide-react';

export default function WrapPage() {
  return (
    <>
      <h1 className="sr-only">{COPY.wrap.name}</h1>
      <RenderErrorBoundary name="wrap">
        <WrapPageInner />
      </RenderErrorBoundary>
    </>
  );
}

function WrapPageInner() {
  const search = useSearch({ from: '/wrap' });
  const user = useAuthStore((s) => s.user);
  const currentFestival = useFestivalStore((s) => s.currentFestival);
  const activeCrew = useCrewStore((s) => s.activeCrew);
  const selectCrew = useCrewStore((s) => s.selectCrew);
  const showHandle = useUIStore((s) => s.wrapShowHandle);
  const setShowHandle = useUIStore((s) => s.setWrapShowHandle);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { toast, toastError } = useToast();
  const wrapTabsRef = useRef<HTMLDivElement>(null);
  useRovingTabs(wrapTabsRef);
  const [sharing, setSharing] = useState(false);
  const [tab, setTab] = useState<'me' | 'crew'>('me');

  const festivalId = search.festival ?? currentFestival?.id;
  // The active crew belongs to one festival; only send it for that festival's wrap.
  const crewParam = activeCrew && activeCrew.festivalId === festivalId ? activeCrew.id : null;

  const { data, isLoading, isError, refetch } = useQuery<WrapResponse>({
    queryKey: ['wrap', festivalId, crewParam],
    queryFn: () =>
      api.get<WrapResponse>(`/ratings/wrap/${festivalId}${crewParam ? `?crewId=${encodeURIComponent(crewParam)}` : ''}`),
    enabled: !!festivalId && !!user,
  });

  // Hooks above and below must run on every render, before the early returns.
  const cards = useMemo(() => (data ? buildWrapCards(data) : []), [data]);
  const toRate = useMemo(() => (data ? selectSetsToRate(data.planned, data.festival) : []), [data]);
  const allSorted = useMemo(() => sortRatingsForWrap(data?.allRatings || []), [data?.allRatings]);

  const handleShare = useCallback(
    async (node: HTMLElement, index: number) => {
      if (!data) return;
      setSharing(true);
      try {
        await sharePoster(node, `festie-wrap-${data.festival.id}-${index + 1}.png`, `My ${COPY.wrap.name}`, toast);
      } catch (e: unknown) {
        // AbortError = user cancelled share sheet; suppress.
        const isAbort = e instanceof DOMException && e.name === 'AbortError';
        if (!isAbort) toastError(e, "Couldn't share your wrap. Try again.");
      } finally {
        setSharing(false);
      }
    },
    [data, toast, toastError],
  );

  if (!user) return <GuestTeaser mode="wrap" />;

  if (!festivalId) {
    return (
      <div className="max-w-lg mx-auto">
        <Card padding="lg">
          <EmptyState
            icon={<Sparkles className="w-12 h-12" aria-hidden="true" />}
            title="Select a festival first"
            description="Your wrap appears here once a festival ends."
          />
        </Card>
      </div>
    );
  }

  if (isLoading) {
    return <WrapSkeleton />;
  }
  if (isError || !data) {
    return (
      <div className="max-w-lg mx-auto">
        <Card padding="lg">
          <EmptyState
            icon={<Sparkles className="w-12 h-12" aria-hidden="true" />}
            title={`Couldn't load your ${COPY.wrap.name}`}
            description={`Something went wrong loading your ${COPY.wrap.name}.`}
            cta={{ label: 'Try again', onClick: () => refetch() }}
          />
        </Card>
      </div>
    );
  }

  if (!isWrapUnlocked(data.festival)) {
    return (
      <div className="max-w-lg mx-auto min-h-[calc(100dvh-200px)] flex items-center justify-center">
        <Card padding="lg">
          <EmptyState
            icon={<Sparkles className="w-12 h-12 text-accent-aqua" aria-hidden="true" />}
            title={`${COPY.wrap.name} coming soon`}
            description="We'll put together your highlights the day after the festival ends."
          />
        </Card>
      </div>
    );
  }

  // Tab bar — Personal vs Crew wrap.
  const tabBar = (
    <div className="max-w-lg mx-auto">
      <div
        ref={wrapTabsRef}
        role="tablist"
        aria-label="Wrap view"
        className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-bg-card border border-border"
      >
        <button
          role="tab"
          aria-selected={tab === 'me'}
          aria-controls="wrap-tab-panel"
          onClick={() => setTab('me')}
          className={`min-h-[40px] rounded-lg text-sm font-medium transition-colors ${
            tab === 'me' ? 'bg-accent-aqua text-bg-primary' : 'text-text-secondary hover:text-text-primary'
          }`}
        >
          You
        </button>
        <button
          role="tab"
          aria-selected={tab === 'crew'}
          aria-controls="wrap-tab-panel"
          onClick={() => setTab('crew')}
          className={`min-h-[40px] rounded-lg text-sm font-medium transition-colors ${
            tab === 'crew' ? 'bg-accent-aqua text-bg-primary' : 'text-text-secondary hover:text-text-primary'
          }`}
        >
          {COPY.wrap.crewName}
        </button>
      </div>
    </div>
  );

  const festivalName = data.festival.name;

  if (tab === 'crew') {
    const crew = data.crew;
    const sameAsActive = !!crew && activeCrew?.id === crew.id;
    return (
      <div>
        {tabBar}
        <div id="wrap-tab-panel">
          <CrewWrapTab
            crewId={crew?.id ?? null}
            crewName={crew?.name ?? 'Your crew'}
            festivalId={festivalId}
            festivalName={festivalName}
            byline={wrapByline(data.festival, null, false)}
            photoAlbumUrl={sameAsActive ? (activeCrew?.photoAlbumUrl ?? null) : (crew?.photoAlbumUrl ?? null)}
            onPhotosSaved={async () => {
              await qc.invalidateQueries({ queryKey: ['wrap', festivalId] });
              if (crew && sameAsActive) await selectCrew(crew.id);
            }}
          />
        </div>
      </div>
    );
  }

  if (cards.length === 0) {
    return (
      <div>
        {tabBar}
        <div id="wrap-tab-panel" className="max-w-lg mx-auto pt-4">
          <Card padding="lg">
            <EmptyState
              icon={<Trophy className="w-12 h-12" aria-hidden="true" />}
              title="Nothing to wrap yet"
              description="Wraps are built from the sets you pick and rate. Rate any set you saw from its detail page."
              cta={{ label: 'Open the lineup', onClick: () => navigate({ to: '/' }) }}
            />
          </Card>
        </div>
      </div>
    );
  }

  const plan = summarizePlan(data.planned, data.caughtExtra ?? []);
  const hasPlan = plan.planned > 0;
  const stats = data.stats;
  const heroStages = hasPlan ? plan.stages : stats.stagesVisited;
  const heroDays = hasPlan ? plan.days : stats.daysAttended;
  const heroHours = hasPlan ? plan.hours : stats.totalHours;
  const detail = [
    `${heroStages} ${heroStages === 1 ? 'stage' : 'stages'}`,
    `${heroDays} ${heroDays === 1 ? 'day' : 'days'}`,
    `${heroHours.toFixed(1)} hours of music`,
  ].join(' · ');
  const byline = wrapByline(data.festival, user.username ?? null, showHandle);

  return (
    <div>
      {tabBar}
      <div id="wrap-tab-panel" className="max-w-lg mx-auto flex flex-col gap-6 pt-4 pb-6">
        {user.username && (
          <div className="flex items-center gap-3 rounded-lg border border-border bg-bg-card p-3">
            <p id="wrap-handle-title" className="min-w-0 flex-1 text-sm text-text-primary">
              Show @{user.username} on cards
            </p>
            <Switch checked={showHandle} onChange={setShowHandle} labelledBy="wrap-handle-title" />
          </div>
        )}

        {toRate.length > 0 && (
          <div className="flex items-center gap-3 rounded-xl border border-accent-aqua/40 bg-accent-aqua/10 p-4">
            <p className="flex-1 text-sm font-medium text-text-primary">
              {toRate.length} {toRate.length === 1 ? 'set' : 'sets'} still to rate
            </p>
            <Link
              to="/rate"
              search={{ festival: festivalId }}
              className="inline-flex min-h-11 items-center rounded-full bg-accent-aqua px-5 text-sm font-semibold text-bg-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-aqua"
            >
              Rate your night
            </Link>
          </div>
        )}

        <Link
          to="/caught"
          search={{ festival: festivalId }}
          className="inline-flex min-h-11 items-center self-start rounded-full border border-border px-5 text-sm font-semibold text-text-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-aqua"
        >
          What you caught
        </Link>

        <WrapHero
          value={hasPlan ? plan.planned : stats.totalRated}
          label={hasPlan ? 'sets planned' : 'sets rated'}
          detail={detail}
        />

        <WrapCarousel
          cards={cards}
          festivalName={festivalName}
          byline={byline}
          sharing={sharing}
          onShare={handleShare}
        />

        {/* Full list */}
        {allSorted.length > 0 && (
          <section>
            <h2 className="text-xs uppercase tracking-[var(--letter-spacing-caps)] text-text-secondary mb-3">
              Everything you rated
            </h2>
            <div className="rounded-xl bg-bg-card border border-border p-4">
              {allSorted.map((s) => (
                <div
                  key={s.setId}
                  className="flex items-center gap-3 py-2 border-b border-border last:border-b-0 first:pt-0 last:pb-0"
                >
                  <RatingTag rating={s.rating} compact />
                  <span className="flex-1 min-w-0 text-sm text-text-primary break-words [overflow-wrap:anywhere] line-clamp-2">{artistOf(s)}</span>
                  {s.stageName && <span className="text-xs text-text-muted">{s.stageName}</span>}
                </div>
              ))}
            </div>
          </section>
        )}

        <div className="text-center text-xs text-text-muted">festie.us</div>
      </div>
    </div>
  );
}

/** Rating as icon + word, so a rating is never colour or glyph alone. */
function RatingTag({ rating, compact = false }: { rating: number; compact?: boolean }) {
  const meta = RATING_META[rating];
  const Icon = meta?.Icon ?? Trophy;
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-text-secondary ${compact ? 'text-xs shrink-0' : 'mt-2 text-sm'}`}
    >
      <Icon className={compact ? 'w-3.5 h-3.5' : 'w-4 h-4'} aria-hidden="true" />
      {meta?.label ?? `${rating}/5`}
    </span>
  );
}

interface CrewWrapResponse {
  wrap: CrewWrapData;
}

// Crew wrap tab — fetches GET /ratings/crew-wrap/:crewId/:festivalId and renders
// the shared recap, sharing the poster through the same sharePoster pipeline as the personal wrap.
function CrewWrapTab({
  crewId,
  crewName,
  festivalId,
  festivalName,
  byline,
  photoAlbumUrl,
  onPhotosSaved,
}: {
  crewId: string | null;
  crewName: string;
  festivalId: string;
  festivalName: string;
  byline: string | null;
  photoAlbumUrl: string | null;
  onPhotosSaved: () => void | Promise<void>;
}) {
  const { toast, toastError } = useToast();
  const posterRef = useRef<HTMLDivElement>(null);
  const [sharing, setSharing] = useState(false);
  const [showMoney, setShowMoney] = useState(false);

  const { data, isLoading, isError, refetch } = useQuery<CrewWrapResponse>({
    queryKey: ['crew-wrap', crewId, festivalId],
    queryFn: async () => api.get<CrewWrapResponse>(`/ratings/crew-wrap/${crewId}/${festivalId}`),
    enabled: !!crewId,
  });

  const wrap = data?.wrap;

  const handleShare = useCallback(async () => {
    if (!posterRef.current) return;
    setSharing(true);
    try {
      await sharePoster(posterRef.current, `festie-crew-wrap-${crewId}.png`, `Our ${COPY.wrap.crewName}`, toast);
    } catch (e: unknown) {
      const isAbort = e instanceof DOMException && e.name === 'AbortError';
      if (!isAbort) toastError(e, "Couldn't share your wrap. Try again.");
    } finally {
      setSharing(false);
    }
  }, [crewId, toast, toastError]);

  if (!crewId) {
    return (
      <div className="max-w-lg mx-auto pt-4">
        <Card padding="lg">
          <EmptyState
            icon={<Users className="w-12 h-12" aria-hidden="true" />}
            title="No active crew"
            description={`Join or select a crew to see your ${COPY.wrap.crewName}.`}
          />
        </Card>
      </div>
    );
  }
  if (isLoading) {
    return (
      <div className="max-w-lg mx-auto pt-4 space-y-3">
        <Skeleton variant="card" />
        <Skeleton variant="card" />
      </div>
    );
  }
  if (isError || !wrap) {
    return (
      <div className="max-w-lg mx-auto pt-4">
        <Card padding="lg">
          <EmptyState
            icon={<Users className="w-12 h-12" aria-hidden="true" />}
            title={`Couldn't load your ${COPY.wrap.crewName}`}
            description={`Something went wrong loading the ${COPY.wrap.crewName}.`}
            cta={{ label: 'Try again', onClick: () => refetch() }}
          />
        </Card>
      </div>
    );
  }

  const hasData =
    wrap.memberCount > 0 && (wrap.topOverlap !== null || wrap.setsSeenTogether.length > 0 || wrap.totalSplit > 0);

  return (
    <div className="max-w-lg mx-auto flex flex-col gap-4 pt-4 pb-6">
      <header className="text-center space-y-1">
        <div className="inline-flex items-center gap-2 text-accent-aqua text-xs uppercase tracking-[var(--letter-spacing-caps)]">
          <Users className="w-4 h-4" aria-hidden="true" />
          {COPY.wrap.crewName}
        </div>
        <h2 className="text-xl font-display font-bold text-text-primary leading-tight">{crewName}</h2>
        <p className="text-sm text-text-secondary">{festivalName}</p>
      </header>

      <WrapHero
        value={wrap.setsSeenTogether.length}
        label="sets seen together"
        detail={[
          `${wrap.memberCount} in the crew`,
          wrap.totalSplit > 0
            ? `${formatAmount(wrap.totalSplit, wrap.currency)} split`
            : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      />

      {/* Superlatives */}
      <section className="flex flex-col gap-3">
        <Superlative
          label="Most-overlapping taste"
          value={wrap.topOverlap ? `${wrap.topOverlap.aName} + ${wrap.topOverlap.bName}` : 'Rate more sets together'}
          sub={
            wrap.topOverlap
              ? `${wrap.topOverlap.shared} shared favourite${wrap.topOverlap.shared === 1 ? '' : 's'}` +
                (wrap.topOverlap.sharedSets.length ? ` · ${wrap.topOverlap.sharedSets.slice(0, 3).join(', ')}` : '')
              : undefined
          }
        />
        <Superlative
          label="Biggest spender"
          value={wrap.biggestSpender ? wrap.biggestSpender.name : 'No expenses yet'}
          sub={
            wrap.biggestSpender
              ? `fronted ${formatAmount(wrap.biggestSpender.amount, wrap.currency)}`
              : undefined
          }
        />
      </section>

      <CrewPhotosCard crewId={crewId} currentUrl={photoAlbumUrl} onSaved={onPhotosSaved} />

      {/* Sets seen together */}
      {wrap.setsSeenTogether.length > 0 && (
        <section>
          <h2 className="flex items-center gap-2 text-xs uppercase tracking-[var(--letter-spacing-caps)] text-text-secondary mb-3">
            <span className="w-2 h-2 rounded-full bg-accent-aqua" aria-hidden="true" />
            Sets you saw together
          </h2>
          <div className="rounded-xl bg-bg-card border border-border p-4 space-y-2">
            {wrap.setsSeenTogether.slice(0, 10).map((s) => (
              <div key={s.setId} className="flex items-center gap-3">
                <span className="flex-1 min-w-0 text-sm text-text-primary break-words [overflow-wrap:anywhere] line-clamp-2">{artistOf(s)}</span>
                <span className="text-xs font-semibold text-accent-aqua">{s.count} loved it</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Per-member top picks */}
      {wrap.perMember.some((m) => m.topSets.length > 0) && (
        <section>
          <h2 className="flex items-center gap-2 text-xs uppercase tracking-[var(--letter-spacing-caps)] text-text-secondary mb-3">
            <span className="w-2 h-2 rounded-full bg-accent-coral" aria-hidden="true" />
            Everyone's top picks
          </h2>
          <div className="space-y-3">
            {wrap.perMember.map((m) => (
              <div key={m.userId} className="rounded-xl bg-bg-card border border-border p-4">
                <div className="text-sm font-semibold text-text-primary mb-1">{m.name}</div>
                {m.topSets.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {m.topSets.map((s) => (
                      <span
                        key={s.setId}
                        className="text-xs px-2 py-1 rounded-full bg-bg-secondary border border-border text-text-secondary inline-flex items-center gap-1"
                      >
                        {(() => {
                          const Icon = RATING_META[s.rating]?.Icon ?? Trophy;
                          return <Icon className="w-3 h-3" aria-hidden="true" />;
                        })()}
                        {artistOf(s)}
                      </span>
                    ))}
                  </div>
                ) : (
                  <div className="text-xs text-text-muted">No sets rated 4 or higher yet</div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Poster preview + share — meaningful only with at least some crew data */}
      {hasData && (
        <section className="flex flex-col gap-3">
          <label className="flex items-start gap-3 text-sm text-text-primary">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4"
              checked={showMoney}
              onChange={(e) => setShowMoney(e.target.checked)}
            />
            <span>
              Show money on poster
              <span className="block text-xs text-text-secondary">
                Off by default. When on, the poster shows the crew's total and who fronted the most.
              </span>
            </span>
          </label>
          <PosterPreview ref={posterRef}>
            <CrewWrapPoster crewName={crewName} festivalName={festivalName} wrap={wrap} showMoney={showMoney} byline={byline} />
          </PosterPreview>
          <Button variant="primary" fullWidth isLoading={sharing} onClick={handleShare} className="min-h-[44px]">
            <Share2 className="w-4 h-4" aria-hidden="true" />
            Share {COPY.wrap.crewName}
          </Button>
        </section>
      )}

      <div className="text-center text-xs text-text-muted">festie.us</div>
    </div>
  );
}

function Superlative({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl bg-bg-card border border-border p-4">
      <div className="text-xs uppercase tracking-[var(--letter-spacing-caps)] text-text-muted">{label}</div>
      <div className="text-base font-bold text-text-primary mt-1">{value}</div>
      {sub && <div className="text-xs text-text-secondary mt-0.5">{sub}</div>}
    </div>
  );
}
