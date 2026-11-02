import { Trophy } from 'lucide-react';
import { POSTER } from '@festie/shared/tokens';
import { festivalTint } from '@festie/shared/utils';
import type { WrapCard } from '@festie/shared/types';
import { RATING_META } from '../../lib/ratingIcon';
import PosterFrame from './PosterFrame';

interface Props {
  card: WrapCard;
  festivalName: string;
  byline?: string | null;
}

const ellipsis = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } as const;

/** One Wrap card drawn on the 1080x1920 poster frame. */
export default function WrapCardPoster({ card, festivalName, byline }: Props) {
  const tint = festivalTint(festivalName);
  const { font, colors } = POSTER;
  return (
    <PosterFrame festivalName={festivalName} kicker={card.kicker} byline={byline}>
      <div style={{ fontSize: font.headline, fontWeight: 700, lineHeight: 1.1 }}>{card.headline}</div>
      {card.sub && <div style={{ fontSize: font.secondary, color: colors.secondary, marginTop: 16 }}>{card.sub}</div>}

      {card.rows && card.rows.length > 0 && (
        <div style={{ marginTop: 48 }}>
          {card.rows.map((row, i) => {
            const Icon = row.rating ? (RATING_META[row.rating]?.Icon ?? Trophy) : null;
            return (
              <div
                key={`${row.primary}-${i}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 24,
                  padding: '24px 0',
                  borderBottom: `1px solid ${tint.faint}`,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: font.artist, fontWeight: 700, ...ellipsis }}>{row.primary}</div>
                  {row.secondary && (
                    <div style={{ fontSize: font.secondary, color: colors.secondary, marginTop: 4, ...ellipsis }}>
                      {row.secondary}
                    </div>
                  )}
                </div>
                {Icon && <Icon size={font.statValue} color={colors.accent} strokeWidth={2} aria-hidden="true" />}
                {row.badge && (
                  <div style={{ fontSize: font.kicker, fontWeight: 800, color: colors.accent, flexShrink: 0 }}>
                    {row.badge}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {card.quote && (
        <div style={{ marginTop: 48 }}>
          <div style={{ fontSize: font.quote, fontStyle: 'italic', lineHeight: 1.25 }}>
            {'“'}
            {card.quote.text}
            {'”'}
          </div>
          <div style={{ fontSize: font.secondary, color: colors.secondary, marginTop: 16 }}>{card.quote.by}</div>
        </div>
      )}

      {card.stats && (
        <div style={{ marginTop: 48, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 18 }}>
          {card.stats.map((t) => (
            <div
              key={t.label}
              style={{
                background: tint.pale,
                borderRadius: 24,
                border: `1px solid ${tint.faint}`,
                padding: 28,
                textAlign: 'center',
              }}
            >
              <div style={{ fontSize: font.statValue, fontWeight: 800, color: colors.accent, lineHeight: 1 }}>
                {t.value}
              </div>
              <div
                style={{
                  fontSize: font.statLabel,
                  color: colors.secondary,
                  marginTop: 8,
                  letterSpacing: 3,
                  textTransform: 'uppercase',
                }}
              >
                {t.label}
              </div>
            </div>
          ))}
        </div>
      )}
    </PosterFrame>
  );
}
