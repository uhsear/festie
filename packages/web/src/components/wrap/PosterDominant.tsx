import { POSTER } from '@festie/shared/tokens';

/** The one dominant typographic object on a share poster: a short value at POSTER.dominantSize and its label. */
export default function PosterDominant({ value, label, sub }: { value: string; label: string; sub?: string }) {
  const { colors, font, layout } = POSTER;
  return (
    <div style={{ height: layout.dominantBlock }}>
      <div
        data-poster="dominant"
        style={{
          height: layout.dominantHeight,
          fontFamily: "'Clash Display', system-ui, sans-serif",
          fontSize: POSTER.dominantSize,
          fontWeight: POSTER.weight,
          lineHeight: `${layout.dominantHeight}px`,
          color: colors.text,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
        }}
      >
        {value}
      </div>
      <div style={{ fontSize: font.headline, fontFamily: "'Clash Display', system-ui, sans-serif", fontWeight: POSTER.weight, color: colors.accent, lineHeight: 1.1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {label}
      </div>
      {sub && <div style={{ fontSize: font.secondary, color: colors.secondary, marginTop: 8, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</div>}
    </div>
  );
}
