import { ZONE_PALETTE, type extractZones } from '@festie/shared/utils';
import { cn } from '../../lib/utils';
import Button from '../ui/Button';
import MapNameInput from './MapNameInput';
import type { ArmedTarget, Vertex } from './festivalMapEditorTypes';

interface MapZonesPanelProps {
  zoneTotal: number;
  placedZones: ReturnType<typeof extractZones>;
  zoneLabel: string;
  zoneColor: string;
  drawing: boolean;
  draftVertices: Vertex[];
  armed: ArmedTarget;
  onZoneLabelChange: (label: string) => void;
  onZoneColorChange: (color: string) => void;
  onStartZone: () => void;
  onUndoVertex: () => void;
  onFinishZone: () => void;
  onCancelZone: () => void;
  onRename: (id: string, label: string) => void;
  onArmMove: (id: string) => void;
  onRemove: (id: string) => void;
}

export default function MapZonesPanel({
  zoneTotal,
  placedZones,
  zoneLabel,
  zoneColor,
  drawing,
  draftVertices,
  armed,
  onZoneLabelChange,
  onZoneColorChange,
  onStartZone,
  onUndoVertex,
  onFinishZone,
  onCancelZone,
  onRename,
  onArmMove,
  onRemove,
}: MapZonesPanelProps) {
  return (
  <div className="bg-bg-card/60 backdrop-blur-xl border border-glass-border rounded-xl p-4 space-y-3">
    <h3 className="type-label text-text-primary">Zones</h3>
    <p className="text-xs text-text-muted">
      Pick a color, name the area, then click the map to drop points. Finish with 3 or more. {zoneTotal}{' '}
      drawn.
    </p>

    {/* Color presets + label input */}
    <input
      type="text"
      aria-label="Zone label"
      placeholder="Zone name — e.g. Camping, VIP, No-go"
      value={zoneLabel}
      onChange={(e) => onZoneLabelChange(e.target.value)}
      className="w-full px-3 py-2 rounded-xl bg-bg-primary border border-glass-border text-sm text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent-aqua"
    />
    <div className="flex flex-wrap gap-2">
      {ZONE_PALETTE.map((preset) => {
        const selected = zoneColor === preset.color;
        return (
          <button
            key={preset.color}
            type="button"
            onClick={() => {
              onZoneColorChange(preset.color);
              if (!zoneLabel.trim()) onZoneLabelChange(preset.label);
            }}
            aria-pressed={selected}
            aria-label={`Use ${preset.label} color`}
            className={cn(
              'flex items-center gap-1.5 px-2 py-1 rounded-full border bg-bg-primary text-sm transition-colors',
              selected ? 'border-2' : 'border-glass-border hover:border-accent-aqua',
            )}
            style={selected ? { borderColor: preset.color } : undefined}
          >
            <span
              className="w-5 h-5 rounded-full border border-white"
              style={{ backgroundColor: preset.color }}
              aria-hidden="true"
            />
            <span className="text-text-primary">{preset.label}</span>
          </button>
        );
      })}
    </div>

    {/* Draw controls */}
    {drawing ? (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-text-secondary">
          {draftVertices.length} {draftVertices.length === 1 ? 'point' : 'points'}
        </span>
        <button
          type="button"
          onClick={onUndoVertex}
          disabled={draftVertices.length === 0}
          className="px-3 py-1.5 rounded-md text-xs font-medium border border-glass-border text-text-secondary hover:text-text-primary disabled:opacity-50"
        >
          Undo point
        </button>
        <button
          type="button"
          onClick={onFinishZone}
          disabled={draftVertices.length < 3}
          className="px-3 py-1.5 rounded-md text-xs font-medium bg-accent-aqua text-[var(--text-on-light-accent)] disabled:opacity-50"
        >
          Finish zone
        </button>
        <button
          type="button"
          onClick={onCancelZone}
          className="px-3 py-1.5 rounded-md text-xs font-medium bg-accent-coral/20 text-accent-coral hover:bg-accent-coral/30"
        >
          Cancel
        </button>
      </div>
    ) : (
      <button
        type="button"
        onClick={onStartZone}
        className="px-3 py-1.5 min-h-11 rounded-md text-xs font-medium bg-accent-aqua/20 text-accent-aqua border border-transparent hover:bg-accent-aqua/30"
      >
        Draw a zone
      </button>
    )}

    {/* Placed zones list */}
    {placedZones.length > 0 && (
      <div className="space-y-2 border-t border-glass-border pt-3">
        {placedZones.map((z) => (
          <div key={z.id} className="flex items-center gap-2">
            <span
              className="w-5 h-5 rounded-full border border-white shrink-0"
              style={{ backgroundColor: z.color }}
              aria-hidden="true"
            />
            <MapNameInput label={z.label || 'zone'} value={z.label} onCommit={(v) => onRename(z.id, v)} />
            <Button
              variant="secondary"
              size="sm"
              aria-pressed={armed?.kind === 'move-zone' && armed.id === z.id}
              onClick={() => onArmMove(z.id)}
            >
              {armed?.kind === 'move-zone' && armed.id === z.id ? 'Cancel' : 'Move'}
            </Button>
            <button
              onClick={() => onRemove(z.id)}
              className="px-2 py-1 rounded-md bg-accent-coral/20 text-accent-coral hover:bg-accent-coral/30 transition-colors text-xs"
              aria-label={`Remove ${z.label || 'zone'}`}
            >
              Remove
            </button>
          </div>
        ))}
      </div>
    )}
  </div>
  );
}
