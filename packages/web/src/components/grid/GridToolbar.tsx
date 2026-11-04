import { Share2, TriangleAlert, ZoomIn, ZoomOut } from 'lucide-react';
import { COPY, clashChip, clashChipA11y } from '@festie/shared/constants';
import { GRID_ZOOM_LEVELS } from '@festie/shared/utils';
import { cn } from '../../lib/utils';

interface GridToolbarProps {
  clashCount: number;
  pickedCount: number;
  viewAsOn: boolean;
  onShowClash: () => void;
  zoom: number;
  onZoom: (next: number) => void;
  exporting: boolean;
  onExport: () => void;
}

const ZOOM_BUTTON = cn(
  'inline-flex items-center justify-center min-h-11 min-w-11 rounded-md cursor-pointer',
  'text-text-secondary hover:text-text-primary hover:bg-bg-secondary',
  'focus-visible:outline-2 focus-visible:outline-accent-aqua focus-visible:outline-offset-2',
  'disabled:opacity-40 disabled:cursor-not-allowed',
);

/** Clash chip, zoom buttons and image export for the schedule grid. */
export default function GridToolbar({
  clashCount,
  pickedCount,
  viewAsOn,
  onShowClash,
  zoom,
  onZoom,
  exporting,
  onExport,
}: GridToolbarProps) {
  return (
    <div className="flex items-center gap-1.5">
      {clashCount > 0 && (
        <button
          type="button"
          onClick={onShowClash}
          aria-label={clashChipA11y(clashCount)}
          className={cn(
            'inline-flex items-center gap-1.5 cursor-pointer',
            'bg-[var(--color-clash-tint)] border border-[var(--color-clash)] text-text-primary rounded-full min-h-11 px-3',
            'text-[length:var(--font-size-12)] font-semibold',
            'focus-visible:outline-2 focus-visible:outline-accent-aqua focus-visible:outline-offset-2',
          )}
        >
          <TriangleAlert aria-hidden="true" className="w-3.5 h-3.5 text-[var(--color-clash)]" />
          <span>{clashChip(clashCount)}</span>
        </button>
      )}
      {clashCount === 0 && pickedCount > 0 && !viewAsOn && (
        <span className="inline-flex items-center min-h-11 px-3 text-[length:var(--font-size-12)] text-text-muted">
          {COPY.clash.none}
        </span>
      )}
      {/* Phones: the toolbar row scrolls away, so zoom and share float above the tab bar. */}
      <div
        className={cn(
          'flex items-center gap-1.5',
          'max-lg:fixed max-lg:left-3 max-lg:z-30 max-lg:rounded-full max-lg:px-1',
          'max-lg:bottom-[calc(var(--bottom-nav-h,88px)+8px+env(safe-area-inset-bottom,0px))]',
          'max-lg:bg-bg-card max-lg:border max-lg:border-border max-lg:shadow-lg',
        )}
      >
        <button
          type="button"
          className={ZOOM_BUTTON}
          onClick={() => onZoom(zoom - 1)}
          disabled={zoom <= 0}
          aria-label={COPY.grid.zoomOut}
          title={COPY.grid.zoomOutHint}
        >
          <ZoomOut aria-hidden="true" className="w-4 h-4" />
        </button>
        <button
          type="button"
          className={ZOOM_BUTTON}
          onClick={() => onZoom(zoom + 1)}
          disabled={zoom >= GRID_ZOOM_LEVELS.length - 1}
          aria-label={COPY.grid.zoomIn}
          title={COPY.grid.zoomInHint}
        >
          <ZoomIn aria-hidden="true" className="w-4 h-4" />
        </button>
        <button
          className={cn(
            'inline-flex items-center justify-center w-11 h-11 rounded-md cursor-pointer',
            'text-accent-aqua',
            'transition-[background-color,transform]',
            'hover:bg-[color-mix(in_srgb,var(--color-accent-aqua)_24%,transparent)]',
            'active:scale-[0.93]',
            'focus-visible:outline-2 focus-visible:outline-accent-aqua focus-visible:outline-offset-2',
            'aria-busy:opacity-70 aria-busy:cursor-progress',
          )}
          style={{
            background: 'color-mix(in srgb, var(--color-accent-aqua) 12%, transparent)',
            border: '1px solid color-mix(in srgb, var(--color-accent-aqua) 35%, transparent)',
          }}
          onClick={onExport}
          title="Share grid"
          aria-label="Share grid as image"
          aria-busy={exporting ? 'true' : 'false'}
          disabled={exporting}
          type="button"
        >
          <Share2 size={14} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
