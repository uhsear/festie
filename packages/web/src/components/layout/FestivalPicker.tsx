import { useMemo, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { useFestivalStore } from '@festie/shared/stores';
import { formatFestivalDateRange, groupFestivalsByStatus } from '@festie/shared/utils';
import type { Festival } from '@festie/shared/types';
import Dialog from '../ui/Dialog';
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
  const { toastError } = useToast();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const showSearch = festivals.length > SEARCH_THRESHOLD;
  const q = query.trim().toLowerCase();
  const groups = useMemo(() => {
    const matches = q
      ? festivals.filter((f) => f.name.toLowerCase().includes(q) || (f.location ?? '').toLowerCase().includes(q))
      : festivals;
    const g = groupFestivalsByStatus(matches);
    return [
      { heading: 'Live now', items: g.live },
      { heading: 'Upcoming', items: g.upcoming },
      { heading: 'Past', items: g.past },
      { heading: 'Dates to come', items: g.undated },
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

  const renderRow = (f: Festival) => {
    const detail = [formatFestivalDateRange(f.startDate, f.endDate), f.location].filter(Boolean).join(' · ');
    const isCurrent = f.id === currentFestival?.id;
    return (
      <button
        key={f.id}
        type="button"
        data-testid={`festival-option-${f.id}`}
        aria-current={isCurrent ? 'true' : undefined}
        onClick={() => void handleChoose(f.id)}
        className={cn(
          'flex w-full items-center gap-3 rounded-xl px-3 py-2 min-h-[52px] text-left cursor-pointer',
          'hover:bg-bg-input focus-visible:outline-2 focus-visible:outline-accent-aqua focus-visible:outline-offset-2',
        )}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-text-primary">{f.name}</span>
          {detail && <span className="block truncate text-xs text-text-muted">{detail}</span>}
        </span>
        {isCurrent && <Check className="w-4 h-4 shrink-0 text-accent-aqua" aria-hidden="true" />}
      </button>
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
                <div key={i} className="skeleton-shimmer h-[52px] rounded-xl" />
              ))}
            </div>
          ) : (
            <p className="text-sm text-text-muted">No festivals yet.</p>
          )
        ) : groups.length === 0 ? (
          <p className="text-sm text-text-muted">{`No festival matches "${query.trim()}".`}</p>
        ) : (
          groups.map((group) => (
            <section key={group.heading}>
              <h3 className="mb-1 px-3 text-xs font-semibold uppercase tracking-wide text-text-secondary">
                {group.heading}
              </h3>
              {group.items.map(renderRow)}
            </section>
          ))
        )}
      </Dialog>
    </>
  );
}
