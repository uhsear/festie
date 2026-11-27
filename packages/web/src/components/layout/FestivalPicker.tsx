import { useMemo, useState } from 'react';
import { Check, ChevronDown, Share2 } from 'lucide-react';
import { useFestivalStore } from '@festie/shared/stores';
import {
  buildFestivalPageUrl,
  festivalStatus,
  formatFestivalDateRange,
  groupFestivalsByStatus,
  partitionSeriesBlocks,
  splitBySeries,
} from '@festie/shared/utils';
import { DISCOVER_COPY, FESTIVAL_SHARE_COPY } from '@festie/shared/constants';
import type { Festival } from '@festie/shared/types';
import Dialog from '../ui/Dialog';
import FollowButton from '../features/FollowButton';
import Button from '../ui/Button';
import Input from '../ui/Input';
import { useToast } from '../../lib/toastContext';
import { cn } from '../../lib/utils';

const SEARCH_THRESHOLD = 8;

/**
 * Festival switcher: a pill trigger that opens a dialog grouped Live now /
 * Upcoming / Past, with dates and place. Replaces the native select, which showed
 * only names and read "Select Festival" until the list loaded.
 */
export default function FestivalPicker() {
  const festivals = useFestivalStore((s) => s.festivals);
  const currentFestival = useFestivalStore((s) => s.currentFestival);
  const selectFestival = useFestivalStore((s) => s.selectFestival);
  const isLoading = useFestivalStore((s) => s.isLoading);
  const loadError = useFestivalStore((s) => s.error);
  const loadFestivals = useFestivalStore((s) => s.loadFestivals);
  const { toast, toastError } = useToast();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const showSearch = festivals.length > SEARCH_THRESHOLD;
  const q = query.trim().toLowerCase();
  const groups = useMemo(() => {
    const matches = q
      ? festivals.filter((f) => f.name.toLowerCase().includes(q) || (f.location ?? '').toLowerCase().includes(q))
      : festivals;
    // Editions of one recurring festival sit together under the series name. A series with an edition that has not
    // ended goes ahead of the status groups, a series whose editions are all over goes after them.
    const ordered = groupFestivalsByStatus(matches);
    const { series, standalone } = splitBySeries([...ordered.live, ...ordered.upcoming, ...ordered.past, ...ordered.undated]);
    const { current, ended } = partitionSeriesBlocks(series);
    const g = groupFestivalsByStatus(standalone);
    const seriesGroup = (block: (typeof series)[number]) => ({
      key: `series-${block.key}`,
      heading: block.label,
      items: block.editions,
      followable: null,
    });
    return [
      ...current.map(seriesGroup),
      { key: 'live', heading: 'Live now', items: g.live, followable: false },
      { key: 'upcoming', heading: 'Upcoming', items: g.upcoming, followable: true },
      { key: 'past', heading: 'Past', items: g.past, followable: false },
      { key: 'undated', heading: 'Dates to come', items: g.undated, followable: true },
      ...ended.map(seriesGroup),
    ].filter((group) => group.items.length > 0);
  }, [festivals, q]);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) setQuery('');
  };

  const handleChoose = async (id: string) => {
    handleOpenChange(false);
    try {
      await selectFestival(id);
    } catch (err) {
      toastError(err, "Couldn't switch festival. Try again.");
    }
  };

  // Same pattern as DetailPanel's set share: native sheet first, clipboard as the fallback.
  const handleShare = async (f: Festival & { slug: string }) => {
    const url = buildFestivalPageUrl(f.slug, window.location.origin, 'share-festival');
    const nav = navigator as Navigator & { share?: (data: ShareData) => Promise<void> };
    if (typeof nav.share === 'function') {
      try {
        await nav.share({ title: f.name, text: FESTIVAL_SHARE_COPY.text(f.name), url });
        return;
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast(FESTIVAL_SHARE_COPY.copied, 'success');
    } catch {
      toast(FESTIVAL_SHARE_COPY.failed, 'error');
    }
  };

  const renderRow = (f: Festival, groupFollowable: boolean | null) => {
    // A series mixes statuses, so each edition decides: a festival that has not ended can be followed.
    const status = festivalStatus(f);
    const followable = groupFollowable ?? (status === 'upcoming' || status === null);
    const dates = formatFestivalDateRange(f.startDate, f.endDate);
    const isCurrent = f.id === currentFestival?.id;
    const button = (
      <button
        type="button"
        data-testid={`festival-option-${f.id}`}
        aria-current={isCurrent ? 'true' : undefined}
        onClick={() => void handleChoose(f.id)}
        className={cn(
          'flex w-full min-w-0 flex-1 items-center gap-3 rounded-lg px-3 py-2 min-h-[52px] text-left cursor-pointer',
          'hover:bg-bg-input focus-visible:outline-2 focus-visible:outline-accent-aqua focus-visible:outline-offset-2',
        )}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-text-primary">{f.name}</span>
          {dates && <span className="block truncate text-xs text-text-muted">{dates}</span>}
          {f.location && <span className="block truncate text-xs text-text-muted">{f.location}</span>}
          {/* 'Set times' is the normal case and says nothing: only the exceptions get a chip. */}
          {f.scheduleProgress && f.scheduleProgress !== 'times' && (
            <span
              data-testid={`festival-progress-${f.id}`}
              className="mt-1 inline-block rounded-full border border-border px-2 py-0.5 text-xs font-medium text-text-secondary"
            >
              {DISCOVER_COPY.scheduleProgress[f.scheduleProgress]}
            </span>
          )}
        </span>
        {isCurrent && (
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent-aqua text-[var(--text-on-light-accent)]">
            <Check className="w-4 h-4" strokeWidth={3} aria-hidden="true" />
          </span>
        )}
      </button>
    );
    const slug = f.slug;
    return (
      <div key={f.id} className="flex items-center gap-2">
        {button}
        {/* Follow comes before share so the share icons line up in one right-hand column. */}
        {followable && <FollowButton festivalId={f.id} festivalName={f.name} size="sm" quiet />}
        {slug && (
          <button
            type="button"
            aria-label={FESTIVAL_SHARE_COPY.a11y(f.name)}
            onClick={() => void handleShare({ ...f, slug })}
            data-testid={`festival-share-${f.id}`}
            className={cn(
              'flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-text-secondary cursor-pointer',
              'hover:bg-bg-input hover:text-text-primary focus-visible:outline-2 focus-visible:outline-accent-aqua focus-visible:outline-offset-2',
            )}
          >
            <Share2 className="w-4 h-4" aria-hidden="true" />
          </button>
        )}
      </div>
    );
  };

  const name = currentFestival?.name;
  return (
    <>
      <button
        type="button"
        data-testid="festival-select"
        data-festival-id={currentFestival?.id ?? ''}
        aria-haspopup="dialog"
        aria-label={name ? `Festival: ${name}. Change festival` : 'Choose a festival'}
        onClick={() => setOpen(true)}
        className={cn(
          'festival-select inline-flex items-center gap-2',
          'min-h-[44px] py-2 pl-3.5 pr-3 bg-bg-card border border-border rounded-full',
          'text-text-primary text-sm font-semibold cursor-pointer',
          'max-w-[min(220px,calc(100vw-160px))] sm:max-w-[min(340px,40vw)]',
          'backdrop-blur-[8px]',
          'focus-visible:outline-2 focus-visible:outline-accent-aqua focus-visible:outline-offset-2',
        )}
      >
        {name ? (
          <span className="truncate">{name}</span>
        ) : isLoading ? (
          <span className="skeleton-shimmer h-5 w-32 rounded" aria-hidden="true" />
        ) : (
          <span className="truncate">Choose a festival</span>
        )}
        <ChevronDown className="w-4 h-4 shrink-0" aria-hidden="true" />
      </button>

      <Dialog open={open} onOpenChange={handleOpenChange} title="Choose a festival">
        {showSearch && (
          <Input
            variant="search"
            placeholder="Search festivals"
            aria-label="Search festivals"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        )}
        {festivals.length === 0 ? (
          isLoading ? (
            <div className="space-y-2" aria-hidden="true">
              {[0, 1, 2].map((i) => (
                <div key={i} className="skeleton-shimmer h-[52px] rounded-lg" />
              ))}
            </div>
          ) : loadError ? (
            <div role="alert" className="space-y-2 text-sm text-text-muted">
              <p>{loadError}</p>
              <Button variant="secondary" size="sm" onClick={() => void loadFestivals().catch(() => {})}>
                Retry
              </Button>
            </div>
          ) : (
            <p className="text-sm text-text-muted">No festivals yet.</p>
          )
        ) : groups.length === 0 ? (
          <p className="text-sm text-text-muted">{`No festival matches "${query.trim()}".`}</p>
        ) : (
          groups.map((group) => (
            <section key={group.key}>
              <h3 className="mb-1 px-3 text-xs font-semibold uppercase tracking-wide text-text-secondary">
                {group.heading}
              </h3>
              {group.items.map((f) => renderRow(f, group.followable))}
            </section>
          ))
        )}
      </Dialog>
    </>
  );
}
