import { Trophy } from 'lucide-react';
import { POSTER } from '@festie/shared/tokens';
import type { WrapCard } from '@festie/shared/types';
import { RATING_META } from '../../lib/ratingIcon';
import PosterDominant from './PosterDominant';
import PosterFrame from './PosterFrame';

interface Props {
  card: WrapCard;
  festivalName: string;
  byline?: string | null;
}

const ellipsis = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } as const;

/** One Wrap card on the 1080x1920 poster frame: one dominant object, then at most five rows in a time column with a rail. */
export default function WrapCardPoster({ card, festivalName, byline }: Props) {
  const { font, colors, layout } = POSTER;
  const named = card.kind === 'top' || card.kind === 'memory';
  const rows = card.rows?.slice(0, layout.maxRows) ?? [];
  return (
    <PosterFrame festivalName={festivalName} kicker={card.kicker} byline={byline}>
      {card.dominant ? (
        <PosterDominant
          value={card.dominant.value}
          label={named ? card.headline : card.dominant.label}
          sub={card.sub}
        />
      ) : (
        <div style={{ fontSize: font.headline, fontWeight: POSTER.weight, lineHeight: 1.1 }}>{card.headline}</div>
      )}

      {rows.map((row, i) => {
        const Icon = row.rating ? (RATING_META[row.rating]?.Icon ?? Trophy) : null;
        return (
          <div
            key={`${row.primary}-${i}`}
            data-poster="row"
            style={{ display: 'flex', alignItems: 'center', gap: 24, height: layout.rowHeight, boxSizing: 'border-box', borderBottom: `1px solid ${colors.rule}` }}
          >
            <div style={{ width: layout.railWidth, height: layout.railHeight, borderRadius: layout.railWidth / 2, background: colors.rail, flexShrink: 0 }} />
            <div style={{ width: layout.timeWidth, flexShrink: 0, fontSize: font.time, fontVariantNumeric: 'tabular-nums', ...ellipsis }}>
              {row.time ?? String(i + 1).padStart(2, '0')}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: font.artist, fontWeight: POSTER.weight, ...ellipsis }}>{row.primary}</div>
              {row.secondary && <div style={{ fontSize: font.secondary, color: colors.secondary, marginTop: 4, ...ellipsis }}>{row.secondary}</div>}
            </div>
            {Icon && <Icon size={font.statValue} color={colors.accent} aria-hidden="true" />}
            {row.badge && <div style={{ fontSize: font.kicker, fontWeight: POSTER.weight, color: colors.accent, flexShrink: 0 }}>{row.badge}</div>}
          </div>
        );
      })}

      {card.quote && (
        <div>
          <div style={{ fontSize: font.quote, fontStyle: 'italic', lineHeight: 1.25 }}>
            {'“'}
            {card.quote.text}
            {'”'}
          </div>
          <div style={{ fontSize: font.secondary, color: colors.secondary, marginTop: 16 }}>{card.quote.by}</div>
        </div>
      )}

      {card.stats && (
        <div style={{ marginTop: 32, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 18 }}>
          {card.stats.map((t) => (
            <div key={t.label} style={{ background: colors.tile, borderRadius: 24, border: `1px solid ${colors.rule}`, padding: 28, textAlign: 'center' }}>
              <div style={{ fontSize: font.statValue, fontWeight: POSTER.weight, color: colors.accent, lineHeight: 1 }}>{t.value}</div>
              <div style={{ fontSize: font.statLabel, color: colors.secondary, marginTop: 8, letterSpacing: 3, textTransform: 'uppercase' }}>{t.label}</div>
            </div>
          ))}
        </div>
      )}
    </PosterFrame>
  );
}
