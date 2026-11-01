import React, { useMemo, useRef, useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
// html-to-image is dynamic-imported inside handleShare so it's not in the
// initial /wrap chunk — only fetched when the user taps Share.
import { api } from '@festie/shared/services';
import { useFestivalStore, useAuthStore, useCrewStore } from '@festie/shared/stores';
import { useFestival } from '@festie/shared/hooks';
import GuestTeaser from '../components/features/GuestTeaser';
import EmptyState from '../components/ui/EmptyState';
import { Card } from '../components/ui/Card';
import Skeleton from '../components/ui/Skeleton';
import WrapSkeleton from '../components/ui/skeletons/WrapSkeleton';
import Button from '../components/ui/Button';
import WrapPoster from '../components/features/WrapPoster';
import CrewWrapPoster, { type CrewWrapData } from '../components/features/CrewWrapPoster';
import { useToast } from '../lib/toastContext';
import WrapHero from '../components/wrap/WrapHero';
import PosterPreview from '../components/wrap/PosterPreview';
import { useRovingTabs } from '../hooks/useRovingTabs';
import { RATING_META } from '../lib/ratingIcon';
import { isFestivalOver } from '@festie/shared/utils';
import { RenderErrorBoundary } from '../components/layout/RouteErrorBoundary';
import { Sparkles, Trophy, Share2, Users } from 'lucide-react';

// Server shape from GET /ratings/wrap/:festivalId:
//   { stats: { totalRated, stagesVisited, daysAttended, totalHours },
//     topSets:    [{ setId, rating, artist, stageId?, startTime?, ... }],
//     allRatings: [...] }
interface WrapStats {
  totalRated: number;
  stagesVisited: number;
  daysAttended: number;
  totalHours: number | null;
  avgRating?: number | null;
}
interface TopSet {
  setId: string;
  rating: number;
  artist?: string;
  note?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  stageId?: string | null;
  stageName?: string | null;
}
interface WrapResponse {
  stats: WrapStats;
  topSets: TopSet[];
  allRatings: TopSet[];
}

export default function WrapPage() {
  return (
    <RenderErrorBoundary name="wrap">
      <WrapPageInner />
    </RenderErrorBoundary>
  );
}

function WrapPageInner() {
  const user = useAuthStore((s) => s.user);
  const currentFestival = useFestivalStore((s) => s.currentFestival);
  const days = useFestivalStore((s) => s.days);
  const activeCrew = useCrewStore((s) => s.activeCrew);
  const { getStageName } = useFestival();
  const { toast, toastError } = useToast();
  const posterRef = useRef<HTMLDivElement>(null);
  const wrapTabsRef = useRef<HTMLDivElement>(null);
  useRovingTabs(wrapTabsRef);
  const [sharing, setSharing] = useState(false);
  const [tab, setTab] = useState<'me' | 'crew'>('me');

  const over = isFestivalOver(currentFestival, days);

  const { data, isLoading, isError, refetch } = useQuery<WrapResponse>({
    queryKey: ['wrap', currentFestival?.id],
    queryFn: async () => {
      const res = await api.get<WrapResponse>(`/ratings/wrap/${currentFestival!.id}`);
      return res as WrapResponse;
    },
    enabled: !!currentFestival?.id && !!user && over,
  });

  // Crew overlap moment: reuses the crew-wrap query the Crew tab runs, so it costs no extra request there.
  const crewId = activeCrew?.id ?? null;
  const { data: crewData } = useQuery<CrewWrapResponse>({
    queryKey: ['crew-wrap', crewId, currentFestival?.id],
    queryFn: async () => api.get<CrewWrapResponse>(`/ratings/crew-wrap/${crewId}/${currentFestival!.id}`),
    enabled: !!crewId && !!currentFestival?.id && !!user && over,
  });
  const crewMoment = crewData?.wrap.setsSeenTogether[0];

  const allSorted = useMemo(
    () =>
      (data?.allRatings || [])
        .slice()
        .sort((a, b) => b.rating - a.rating || (a.startTime || '').localeCompare(b.startTime || '')),
    [data?.allRatings],
  );

  // Memo for poster top-sets must live ABOVE early-return branches below —
  // React would otherwise call fewer hooks on error/loading renders and throw
  // "Rendered more hooks than during the previous render" (error #310).
  const posterTopSets = useMemo(
    () =>
      (data?.topSets || []).slice(0, 5).map((s) => ({
        rating: s.rating,
        artist: s.artist || s.setId,
        stageName: s.stageName || (s.stageId ? getStageName(s.stageId) : null),
      })),
    [data?.topSets, getStageName],
  );

  // Share-as-PNG — captures the fixed 1080×1920 off-screen WrapPoster,
  // passes to Web Share API if available, otherwise triggers a download.
  // Await document.fonts.ready so custom fonts (Syncopate) finish loading
  // before capture — avoids the iOS Safari font-race that renders fallback
  // glyphs into the PNG.
  const handleShare = useCallback(async () => {
    if (!posterRef.current || !currentFestival) return;
    setSharing(true);
    try {
      if (document.fonts?.ready) await document.fonts.ready;
      await new Promise((r) => requestAnimationFrame(r));
      const { toBlob } = await import('html-to-image');
      const blob = await toBlob(posterRef.current, {
        width: 1080,
        height: 1920,
        pixelRatio: 2,
        backgroundColor: '#080810',
        cacheBust: true,
      });
      if (!blob) throw new Error('Capture failed');
      const file = new File([blob], `festie-wrap-${currentFestival.id}.png`, { type: 'image/png' });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: 'My Festie Wrap' });
      } else {
        const url = URL.createObjectURL(blob);
        const a = Object.assign(document.createElement('a'), { href: url, download: file.name });
        a.click();
        URL.revokeObjectURL(url);
        toast('Saved to downloads', 'success');
      }
    } catch (e: unknown) {
      // AbortError = user cancelled share sheet; suppress.
      const isAbort = e instanceof DOMException && e.name === 'AbortError';
      if (!isAbort) {
        toastError(e, "Couldn't share your wrap. Try again.");
      }
    } finally {
      setSharing(false);
    }
  }, [currentFestival, toast, toastError]);

  if (!user) return <GuestTeaser mode="wrap" />;

  if (!currentFestival) {
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

  if (!over) {
    return (
      <div className="max-w-lg mx-auto min-h-[calc(100dvh-200px)] flex items-center justify-center">
        <Card padding="lg">
          <EmptyState
            icon={<Sparkles className="w-12 h-12 text-accent-aqua" aria-hidden="true" />}
            title="Festival wrap coming soon"
            description="We'll put together your highlights the day after the festival ends."
          />
        </Card>
      </div>
    );
  }

  // Tab bar — Personal vs Crew wrap. Rendered above the personal-query
  // loading/error branches so the crew view is reachable regardless of the
  // personal wrap's fetch state.
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
          Crew wrap
        </button>
      </div>
    </div>
  );

  if (tab === 'crew') {
    return (
      <div>
        {tabBar}
        <div id="wrap-tab-panel">
          <CrewWrapTab
            crewId={activeCrew?.id ?? null}
            crewName={activeCrew?.name ?? 'Your crew'}
            festivalId={currentFestival.id}
            festivalName={currentFestival.name}
          />
        </div>
      </div>
    );
  }

  if (isLoading) {
    return <WrapSkeleton />;
  }
  if (isError) {
    return (
      <div className="max-w-lg mx-auto">
        <Card padding="lg">
          <EmptyState
            icon={<Sparkles className="w-12 h-12" aria-hidden="true" />}
            title="Couldn't load your wrap"
            description="Something went wrong loading your festival wrap."
            cta={{ label: 'Retry', onClick: () => refetch() }}
          />
        </Card>
      </div>
    );
  }

  const stats = data?.stats || { totalRated: 0, stagesVisited: 0, daysAttended: 0, totalHours: 0 };
  const topSets = data?.topSets || [];
  const totalHours = stats.totalHours ?? 0;

  const detail = [
    `${stats.stagesVisited} ${stats.stagesVisited === 1 ? 'stage' : 'stages'}`,
    `${stats.daysAttended} ${stats.daysAttended === 1 ? 'day' : 'days'}`,
    `${totalHours.toFixed(1)} hours of music`,
  ].join(' · ');
  const [lead, ...rest] = topSets;

  return (
    <div>
      {tabBar}
      <div id="wrap-tab-panel" className="max-w-lg mx-auto flex flex-col gap-6 pt-4 pb-6">
        <header className="text-center space-y-1">
          <h1 className="text-xl font-display font-bold text-text-primary leading-tight">{currentFestival.name}</h1>
        </header>

        {/* Poster preview: the exact image Share exports (also the html-to-image source). */}
        {stats.totalRated > 0 && (
          <section className="flex flex-col gap-3">
            <PosterPreview ref={posterRef}>
              <WrapPoster
                festivalName={currentFestival.name}
                topSets={posterTopSets}
                stats={{
                  totalRated: stats.totalRated,
                  stagesVisited: stats.stagesVisited,
                  daysAttended: stats.daysAttended,
                  totalHours,
                }}
              />
            </PosterPreview>
            <Button variant="primary" fullWidth isLoading={sharing} onClick={handleShare} className="min-h-[44px]">
              <Share2 className="w-4 h-4" aria-hidden="true" />
              Share your wrap
            </Button>
          </section>
        )}

        {stats.totalRated > 0 && <WrapHero value={stats.totalRated} label="sets rated" detail={detail} />}

        {/* Ranked top sets: the number one set leads, the rest follow in order. */}
        {lead ? (
          <section aria-labelledby="wrap-top-heading">
            <h2
              id="wrap-top-heading"
              className="text-xs uppercase tracking-[var(--letter-spacing-caps)] text-text-secondary mb-3"
            >
              Your top sets
            </h2>
            <div className="rounded-xl bg-bg-card border border-border p-5">
              <div className="text-xs text-text-muted">
                #1 · {lead.stageName || (lead.stageId ? getStageName(lead.stageId) : 'Stage')}
              </div>
              <div className="mt-1 text-2xl font-display font-bold text-text-primary">{lead.artist || lead.setId}</div>
              <RatingTag rating={lead.rating} />
              {lead.note && <div className="text-sm text-text-secondary mt-2 italic">"{lead.note}"</div>}
            </div>
            {rest.length > 0 && (
              <ol className="mt-2 flex flex-col gap-1 list-none p-0">
                {rest.map((s, i) => (
                  <li key={s.setId} className="flex items-center gap-3 px-2 py-2 border-b border-border last:border-b-0">
                    <span className="w-6 text-right font-display font-bold text-text-muted" aria-hidden="true">
                      {i + 2}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-text-primary truncate">{s.artist || s.setId}</div>
                      <div className="text-xs text-text-muted truncate">
                        {s.stageName || (s.stageId ? getStageName(s.stageId) : 'Stage')}
                      </div>
                    </div>
                    <RatingTag rating={s.rating} compact />
                  </li>
                ))}
              </ol>
            )}
          </section>
        ) : (
          <Card padding="lg">
            <EmptyState
              icon={<Trophy className="w-12 h-12" aria-hidden="true" />}
              title="No 4/5 or 5/5 ratings yet"
              description="Rate sets from the set detail panel to build your wrap."
            />
          </Card>
        )}

        {/* Crew overlap moment: the set the most of your crew loved. Hidden without crew data. */}
        {crewMoment && crewData && (
          <section className="rounded-xl border border-accent-aqua/40 bg-accent-aqua/10 p-5">
            <div className="flex items-center gap-2 text-xs uppercase tracking-[var(--letter-spacing-caps)] text-accent-aqua">
              <Users className="w-4 h-4" aria-hidden="true" />
              Your crew moment
            </div>
            <div className="mt-1 text-xl font-display font-bold text-text-primary">
              {crewMoment.artist || crewMoment.setId}
            </div>
            <p className="text-sm text-text-secondary mt-0.5">
              {crewMoment.count} of {crewData.wrap.memberCount} in {activeCrew?.name ?? 'your crew'} loved it
            </p>
            <button
              type="button"
              onClick={() => setTab('crew')}
              className="mt-3 min-h-11 text-sm font-medium text-accent-aqua underline underline-offset-2"
            >
              Open the crew wrap
            </button>
          </section>
        )}

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
                  <span className="flex-1 text-sm text-text-primary truncate">{s.artist || s.setId}</span>
                  {(s.stageName || s.stageId) && (
                    <span className="text-xs text-text-muted">{s.stageName || getStageName(s.stageId!)}</span>
                  )}
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
// the shared recap, reusing the same off-screen-poster + html-to-image + Web
// Share pipeline as the personal wrap (incl. the document.fonts.ready guard).
function CrewWrapTab({
  crewId,
  crewName,
  festivalId,
  festivalName,
}: {
  crewId: string | null;
  crewName: string;
  festivalId: string;
  festivalName: string;
}) {
  const { toast, toastError } = useToast();
  const posterRef = useRef<HTMLDivElement>(null);
  const [sharing, setSharing] = useState(false);

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
      if (document.fonts?.ready) await document.fonts.ready;
      await new Promise((r) => requestAnimationFrame(r));
      const { toBlob } = await import('html-to-image');
      const blob = await toBlob(posterRef.current, {
        width: 1080,
        height: 1920,
        pixelRatio: 2,
        backgroundColor: '#080810',
        cacheBust: true,
      });
      if (!blob) throw new Error('Capture failed');
      const file = new File([blob], `festie-crew-wrap-${crewId}.png`, { type: 'image/png' });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Our Festie Crew Wrap' });
      } else {
        const url = URL.createObjectURL(blob);
        const a = Object.assign(document.createElement('a'), { href: url, download: file.name });
        a.click();
        URL.revokeObjectURL(url);
        toast('Saved to downloads', 'success');
      }
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
            description="Join or select a crew to see your shared festival recap."
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
            title="Couldn't load your crew wrap"
            description="Something went wrong loading the shared recap."
            cta={{ label: 'Retry', onClick: () => refetch() }}
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
          Crew Wrap
        </div>
        <h1 className="text-xl font-display font-bold text-text-primary leading-tight">{crewName}</h1>
        <p className="text-sm text-text-secondary">{festivalName}</p>
      </header>

      <WrapHero
        value={wrap.setsSeenTogether.length}
        label="sets seen together"
        detail={[
          `${wrap.memberCount} in the crew`,
          wrap.totalSplit > 0
            ? `${wrap.totalSplit.toLocaleString(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: 0 })} split`
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
              ? `fronted ${wrap.biggestSpender.amount.toLocaleString(undefined, { style: 'currency', currency: 'USD' })}`
              : undefined
          }
        />
      </section>

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
                <span className="flex-1 text-sm text-text-primary truncate">{s.artist || s.setId}</span>
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
                        {s.artist || s.setId}
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
          <PosterPreview ref={posterRef}>
            <CrewWrapPoster crewName={crewName} festivalName={festivalName} wrap={wrap} />
          </PosterPreview>
          <Button variant="primary" fullWidth isLoading={sharing} onClick={handleShare} className="min-h-[44px]">
            <Share2 className="w-4 h-4" aria-hidden="true" />
            Share crew wrap
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
