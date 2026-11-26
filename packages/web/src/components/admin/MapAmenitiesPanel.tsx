import type { AmenityType, FestivalMapConfig } from '@festie/shared/types';
import { AMENITY_PALETTE, amenityGlyph, humanizeAmenityType } from '@festie/shared/utils';
import { cn } from '../../lib/utils';
import Button from '../ui/Button';
import MapNameInput from './MapNameInput';
import type { ArmedTarget } from './festivalMapEditorTypes';

interface MapAmenitiesPanelProps {
  amenityTotal: number;
  amenityFeatures: NonNullable<NonNullable<FestivalMapConfig['amenities']>['features']>;
  label: string;
  armed: ArmedTarget;
  onLabelChange: (label: string) => void;
  onArm: (type: AmenityType) => void;
  onRename: (id: string, label: string) => void;
  onArmMove: (id: string) => void;
  onRemove: (id: string) => void;
}

export default function MapAmenitiesPanel({
  amenityTotal,
  amenityFeatures,
  label: amenityLabel,
  armed,
  onLabelChange,
  onArm,
  onRename,
  onArmMove,
  onRemove,
}: MapAmenitiesPanelProps) {
  return (
  <div className="bg-bg-card/60 backdrop-blur-xl border border-glass-border rounded-xl p-4 space-y-3">
    <h3 className="type-label text-text-primary">Amenities</h3>
    <p className="text-xs text-text-muted">
      Pick a type, optionally name it, then click the map to drop it. {amenityTotal} placed.
    </p>
    <input
      type="text"
      aria-label="Amenity label (optional)"
      placeholder="Label (optional) — e.g. North water station"
      value={amenityLabel}
      onChange={(e) => onLabelChange(e.target.value)}
      className="w-full px-3 py-2 rounded-xl bg-bg-primary border border-glass-border text-sm text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent-aqua"
    />
    <div className="flex flex-wrap gap-2">
      {AMENITY_PALETTE.map((type) => {
        const { glyph, color } = amenityGlyph(type);
        const isArmed = armed?.kind === 'amenity' && armed.amenityType === type;
        return (
          <button
            key={type}
            onClick={() => onArm(type)}
            aria-pressed={isArmed}
            aria-label={`${isArmed ? 'Cancel placing' : 'Place'} ${humanizeAmenityType(type)}`}
            className={cn(
              'flex items-center gap-1.5 px-2 py-1 rounded-full border bg-bg-primary text-sm transition-colors',
              isArmed ? 'border-2' : 'border-glass-border hover:border-accent-aqua',
            )}
            style={isArmed ? { borderColor: color } : undefined}
          >
            <span
              className="w-6 h-6 rounded-full flex-center text-[length:var(--font-size-14)] leading-none border border-white"
              style={{ backgroundColor: color }}
              aria-hidden="true"
            >
              {glyph}
            </span>
            <span className="text-text-primary">{humanizeAmenityType(type)}</span>
          </button>
        );
      })}
    </div>

    {amenityFeatures.length > 0 && (
      <div className="space-y-2 border-t border-glass-border pt-3">
        {amenityFeatures.map((f) => {
          const { glyph, color } = amenityGlyph(f.properties.amenityType);
          return (
            <div key={f.properties.id} className="flex items-center gap-2">
              <span
                className="w-6 h-6 rounded-full flex-center text-[length:var(--font-size-14)] leading-none border border-white shrink-0"
                style={{ backgroundColor: color }}
                aria-hidden="true"
              >
                {glyph}
              </span>
              <MapNameInput
                label={f.properties.label}
                value={f.properties.label}
                onCommit={(v) => onRename(f.properties.id, v)}
              />
              <Button
                variant="secondary"
                size="sm"
                aria-pressed={armed?.kind === 'move-amenity' && armed.id === f.properties.id}
                onClick={() => onArmMove(f.properties.id)}
              >
                {armed?.kind === 'move-amenity' && armed.id === f.properties.id ? 'Cancel' : 'Move'}
              </Button>
              <button
                onClick={() => onRemove(f.properties.id)}
                className="px-2 py-1 rounded-md bg-accent-coral/20 text-accent-coral hover:bg-accent-coral/30 transition-colors text-xs"
                aria-label={`Remove ${f.properties.label}`}
              >
                Remove
              </button>
            </div>
          );
        })}
      </div>
    )}
  </div>
  );
}
