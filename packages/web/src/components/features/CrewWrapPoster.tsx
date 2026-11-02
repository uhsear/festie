import type {
  CrewWrapOverlapPair,
  CrewWrapSeenTogether,
  CrewWrapMemberSummary,
  CrewWrapData,
} from '@festie/shared/types';
import { POSTER } from '@festie/shared/tokens';
import { festivalTint } from '@festie/shared/utils';
import PosterFrame from '../wrap/PosterFrame';

// Re-export the shared types so existing importers (e.g. routes/wrap.tsx) keep
// importing `CrewWrapData` from this component module unchanged.
export type { CrewWrapOverlapPair, CrewWrapSeenTogether, CrewWrapMemberSummary, CrewWrapData };

interface Props {
  crewName: string;
  festivalName: string;
  wrap: CrewWrapData;
  byline?: string | null;
}

const money = (n: number) =>
  n.toLocaleString(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: 0 });

const { font, colors } = POSTER;

/**
 * Fixed-dimension 1080×1920 crew recap poster, a crew-scoped sibling of WrapCardPoster on
 * the same PosterFrame. Every field degrades gracefully — an empty or single-member crew
 * shows fallbacks rather than blanks or NaN.
 */
export default function CrewWrapPoster({ crewName, festivalName, wrap, byline }: Props) {
  const tint = festivalTint(festivalName);
  const topOverlap = wrap.topOverlap;
  const seenTogether = wrap.setsSeenTogether.slice(0, 5);

  const stats: { label: string; value: string }[] = [
    { label: 'Crew', value: String(wrap.memberCount) },
    { label: 'Seen together', value: String(wrap.setsSeenTogether.length) },
    { label: 'Split', value: money(wrap.totalSplit) },
  ];

  return (
    <PosterFrame festivalName={festivalName} kicker="CREW WRAP" byline={byline}>
      <div style={{ fontSize: font.headline, fontWeight: 700, lineHeight: 1.1 }}>{crewName}</div>

      <div style={{ marginTop: 40, display: 'flex', flexDirection: 'column', gap: 28 }}>
        <Superlative
          label="Most-overlapping taste"
          value={topOverlap ? `${topOverlap.aName} + ${topOverlap.bName}` : 'Rate more sets together'}
          sub={
            topOverlap
              ? `${topOverlap.shared} shared favourite${topOverlap.shared === 1 ? '' : 's'}` +
                (topOverlap.sharedSets.length ? ` · ${topOverlap.sharedSets.slice(0, 3).join(', ')}` : '')
              : undefined
          }
        />
        <Superlative
          label="Biggest spender"
          value={wrap.biggestSpender ? wrap.biggestSpender.name : 'No expenses yet'}
          sub={wrap.biggestSpender ? `fronted ${money(wrap.biggestSpender.amount)}` : undefined}
        />

        <div>
          <div style={{ fontSize: font.statLabel, letterSpacing: 4, textTransform: 'uppercase', color: colors.secondary, marginBottom: 16 }}>
            Sets you saw together
          </div>
          {seenTogether.length > 0 ? (
            seenTogether.map((s) => (
              <div
                key={s.setId}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 20,
                  padding: '18px 0',
                  borderBottom: `1px solid ${tint.faint}`,
                }}
              >
                <div
                  style={{
                    flex: 1,
                    minWidth: 0,
                    fontSize: font.artist,
                    fontWeight: 700,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {s.artist || s.setId}
                </div>
                <div style={{ fontSize: font.secondary, fontWeight: 800, color: colors.accent, flexShrink: 0 }}>
                  {s.count} loved it
                </div>
              </div>
            ))
          ) : (
            <div style={{ fontSize: font.secondary, color: colors.secondary }}>
              No sets two of you both rated 4 or higher — yet.
            </div>
          )}
        </div>
      </div>

      <div style={{ marginTop: 40, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 18 }}>
        {stats.map((t) => (
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
            <div style={{ fontSize: font.statValue, fontWeight: 800, color: colors.accent, lineHeight: 1 }}>{t.value}</div>
            <div
              style={{
                fontSize: font.statLabel,
                color: colors.secondary,
                marginTop: 8,
                letterSpacing: 2,
                textTransform: 'uppercase',
              }}
            >
              {t.label}
            </div>
          </div>
        ))}
      </div>
    </PosterFrame>
  );
}

function Superlative({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div style={{ fontSize: font.statLabel, letterSpacing: 4, textTransform: 'uppercase', color: colors.secondary, marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ fontSize: font.artist, fontWeight: 800 }}>{value}</div>
      {sub && <div style={{ fontSize: font.secondary, color: colors.secondary, marginTop: 4 }}>{sub}</div>}
    </div>
  );
}
