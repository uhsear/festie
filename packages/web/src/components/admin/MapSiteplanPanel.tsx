import { useRef, type ChangeEvent } from 'react';
import { SITEPLAN_CORNER_COUNT, isHttpsUrl } from '@festie/shared/utils';
import Button from '../ui/Button';
import type { Vertex } from './festivalMapEditorTypes';

interface MapSiteplanPanelProps {
  url: string;
  opacity: number;
  committed: boolean;
  placing: boolean;
  draftCorners: Vertex[];
  uploading: boolean;
  uploadError: string | null;
  onFile: (e: ChangeEvent<HTMLInputElement>) => void;
  onUrlChange: (url: string) => void;
  onOpacityChange: (opacity: number) => void;
  onStartCorners: () => void;
  onUndoCorner: () => void;
  onApplyCorners: () => void;
  onCancelCorners: () => void;
  onRemoveOverlay: () => void;
}

export default function MapSiteplanPanel({
  url: siteplanUrl,
  opacity: siteplanOpacity,
  committed: committedSiteplan,
  placing,
  draftCorners,
  uploading,
  uploadError,
  onFile,
  onUrlChange,
  onOpacityChange,
  onStartCorners,
  onUndoCorner,
  onApplyCorners,
  onCancelCorners,
  onRemoveOverlay,
}: MapSiteplanPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  return (
  <div className="bg-bg-card/60 backdrop-blur-xl border border-glass-border rounded-xl p-4 space-y-3">
    <h3 className="type-label text-text-primary">Site plan overlay</h3>
    <p className="text-xs text-text-muted">
      Upload the organizer’s site-plan image (PNG, JPEG or WebP, up to 10 MB), or paste an https link. Then mark the
      four corners: top-left, top-right, bottom-right, bottom-left. Got a PDF? Save the page as a PNG first.
    </p>
    <input
      ref={fileInputRef}
      type="file"
      accept="image/png,image/jpeg,image/webp"
      className="hidden"
      aria-label="Site-plan image file"
      onChange={(e) => void onFile(e)}
    />
    <Button variant="secondary" size="sm" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
      {uploading ? 'Uploading…' : 'Upload image'}
    </Button>
    {uploadError && (
      <p className="text-xs text-[var(--color-text-danger)]" role="alert">
        {uploadError}
      </p>
    )}
    <input
      type="url"
      inputMode="url"
      aria-label="Site-plan image URL"
      placeholder="https://…/site-plan.png"
      value={siteplanUrl}
      onChange={(e) => onUrlChange(e.target.value)}
      maxLength={2048}
      className="w-full px-3 py-2 rounded-xl bg-bg-primary border border-glass-border text-sm text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent-aqua"
    />
    {siteplanUrl.trim() !== '' && !isHttpsUrl(siteplanUrl) && (
      <p className="text-xs text-[var(--color-text-danger)]">Image link must start with https://</p>
    )}

    {/* Corner placement */}
    {placing ? (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-text-secondary">
          {draftCorners.length}/{SITEPLAN_CORNER_COUNT} corners
        </span>
        <button
          type="button"
          onClick={onUndoCorner}
          disabled={draftCorners.length === 0}
          className="px-3 py-1.5 rounded-md text-xs font-medium border border-glass-border text-text-secondary hover:text-text-primary disabled:opacity-50"
        >
          Undo corner
        </button>
        <button
          type="button"
          onClick={onApplyCorners}
          disabled={draftCorners.length !== SITEPLAN_CORNER_COUNT || !isHttpsUrl(siteplanUrl)}
          className="px-3 py-1.5 rounded-md text-xs font-medium bg-accent-aqua text-[var(--text-on-light-accent)] disabled:opacity-50"
        >
          Apply corners
        </button>
        <button
          type="button"
          onClick={onCancelCorners}
          className="px-3 py-1.5 rounded-md text-xs font-medium bg-accent-coral/20 text-accent-coral hover:bg-accent-coral/30"
        >
          Cancel
        </button>
      </div>
    ) : (
      <button
        type="button"
        onClick={onStartCorners}
        disabled={!isHttpsUrl(siteplanUrl)}
        className="px-3 py-1.5 min-h-11 rounded-md text-xs font-medium bg-accent-aqua/20 text-accent-aqua border border-transparent hover:bg-accent-aqua/30 disabled:opacity-50"
      >
        {committedSiteplan ? 'Re-place corners' : 'Set corners'}
      </button>
    )}

    {/* Opacity slider — only meaningful once an overlay is committed. */}
    {committedSiteplan && (
      <div className="space-y-1">
        <label htmlFor="siteplan-opacity" className="text-xs text-text-secondary">
          Opacity: {Math.round(siteplanOpacity * 100)}%
        </label>
        <input
          id="siteplan-opacity"
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={siteplanOpacity}
          onChange={(e) => onOpacityChange(parseFloat(e.target.value))}
          className="w-full accent-accent-aqua"
        />
      </div>
    )}

    {committedSiteplan && (
      <div className="flex items-center gap-2 border-t border-glass-border pt-3">
        <span className="text-sm text-text-primary flex-1 truncate">
          Overlay set ({SITEPLAN_CORNER_COUNT} corners)
        </span>
        <button
          onClick={onRemoveOverlay}
          className="px-2 py-1 rounded-md bg-accent-coral/20 text-accent-coral hover:bg-accent-coral/30 transition-colors text-xs"
          aria-label="Remove site-plan overlay"
        >
          Remove
        </button>
      </div>
    )}
  </div>
  );
}
