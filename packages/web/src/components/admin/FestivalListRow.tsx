import { Link } from '@tanstack/react-router';
import { pluralize } from '@festie/shared/utils/format';
import { rowButton } from './adminFestivalStyles';
import type { OpenView } from './AdminFestivalSubTabs';

interface FestivalListRowProps {
  festival: {
    id: string;
    name: string;
    location?: string | null;
    published?: boolean;
    stageCount?: number;
    dayCount?: number;
  };
  /** An organizer submitted this draft and Festie has not answered yet. */
  waitingForReview?: boolean;
  selected: boolean;
  onToggleSelected: () => void;
  onOpen: (view: OpenView) => void;
  onArtists: () => void;
  onDelete: () => void;
}

export default function FestivalListRow({
  festival,
  waitingForReview = false,
  selected,
  onToggleSelected,
  onOpen,
  onArtists,
  onDelete,
}: FestivalListRowProps) {
  return (
  <div
      className="bg-bg-card/60 backdrop-blur-xl border border-glass-border rounded-xl p-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between hover:bg-bg-card/80 transition-colors"
  >
    <input
      type="checkbox"
      aria-label={`Select ${festival.name}`}
      checked={selected}
      onChange={onToggleSelected}
      className="mr-3 h-5 w-5 shrink-0"
    />
    <div className="flex-1 min-w-0">
      <h2 className="text-base font-semibold text-text-primary">
        {festival.name}
        {!festival.published && (
          <span className="ml-2 px-2 py-0.5 rounded-full bg-accent-amber/20 text-accent-amber text-xs font-semibold">
            {waitingForReview ? 'Waiting for review' : 'Draft'}
          </span>
        )}
      </h2>
      <p className="text-sm text-text-muted">
        {festival.location} · {pluralize(festival.stageCount ?? 0, 'stage')} · {pluralize(festival.dayCount ?? 0, 'day')}
      </p>
    </div>
    <div className="flex flex-wrap gap-2">
      <button
        onClick={() => onOpen('edit')}
        aria-label={`Edit ${festival.name}`}
        className={rowButton}
      >
        Edit
      </button>
      <Link
        to="/admin"
        search={{ tab: 'festivals', preview: festival.id }}
        target="_blank"
        rel="noopener"
        aria-label={`Preview ${festival.name}`}
        className={`inline-flex items-center ${rowButton}`}
      >
        Preview
      </Link>
      <button
        onClick={() => onOpen('import')}
        aria-label={`Import lineup for ${festival.name}`}
        className={rowButton}
      >
        Import
      </button>
      <button
        onClick={() => onOpen('map')}
        aria-label={`Edit map for ${festival.name}`}
        className={rowButton}
      >
        Map
      </button>
      <button
        onClick={() => onArtists()}
        aria-label={`Artists for ${festival.name}`}
        className={rowButton}
      >
        Artists
      </button>
      <button
        onClick={() => onDelete()}
        aria-label={`Delete ${festival.name}`}
        className="px-3 py-1.5 min-h-11 rounded-md bg-accent-coral/20 text-accent-coral hover:bg-accent-coral/30 transition-colors text-sm font-medium"
      >
        Delete
      </button>
    </div>
  </div>
  );
}
