import { isPmtilesInput } from '@festie/shared/utils';

interface MapBasemapPanelProps {
  url: string;
  attribution: string;
  onChange: (url: string, attribution: string) => void;
}

const inputClass =
  'w-full px-3 py-2 rounded-lg bg-bg-primary border border-glass-border text-sm text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent-aqua';

export default function MapBasemapPanel({ url, attribution, onChange }: MapBasemapPanelProps) {
  const invalid = url.trim() !== '' && !isPmtilesInput(url.trim());
  return (
    <div className="bg-bg-card/60 backdrop-blur-xl border border-glass-border rounded-lg p-4 space-y-3">
      <h3 className="type-label text-text-primary">Offline map</h3>
      <p className="text-xs text-text-muted">
        Point the map at a PMTiles file so people can download it and use the map without a signal. Enter an https link,
        or a file Festie hosts such as /tiles/fest-2026.pmtiles. Leave it empty to keep the online map.
      </p>
      <input
        type="text"
        inputMode="url"
        aria-label="Offline map file"
        placeholder="/tiles/fest-2026.pmtiles"
        value={url}
        onChange={(e) => onChange(e.target.value, attribution)}
        maxLength={2048}
        className={inputClass}
      />
      {invalid && (
        <p className="text-xs text-[var(--color-text-danger)]" role="alert">
          Use an https link or a /tiles/&lt;name&gt;.pmtiles path. Fix it or clear the field to save the map.
        </p>
      )}
      <input
        type="text"
        aria-label="Offline map credit"
        placeholder="© OpenStreetMap contributors"
        value={attribution}
        onChange={(e) => onChange(url, e.target.value)}
        maxLength={500}
        className={inputClass}
      />
    </div>
  );
}
