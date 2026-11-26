import type {
  CrewWrapOverlapPair,
  CrewWrapSeenTogether,
  CrewWrapMemberSummary,
  CrewWrapData,
} from '@festie/shared/types';
import { POSTER } from '@festie/shared/tokens';
import { crewPosterContent } from '@festie/shared/utils';
import PosterDominant from '../wrap/PosterDominant';
import PosterFrame from '../wrap/PosterFrame';

// Re-export the shared types so existing importers (e.g. routes/wrap.tsx) keep
// importing `CrewWrapData` from this component module unchanged.
export type { CrewWrapOverlapPair, CrewWrapSeenTogether, CrewWrapMemberSummary, CrewWrapData };

interface Props {
  crewName: string;
  festivalName: string;
  wrap: CrewWrapData;
  showMoney: boolean;
  byline?: string | null;
}

const { font, colors } = POSTER;

/**
 * Fixed-dimension 1080×1920 crew recap poster, a crew-scoped sibling of WrapCardPoster on
 * the same PosterFrame. Every field degrades gracefully — an empty or single-member crew
 * shows fallbacks rather than blanks or NaN.
 */
export default function CrewWrapPoster({ crewName, festivalName, wrap, showMoney, byline }: Props) {
  const topOverlap = wrap.topOverlap;
  const { dominant, spotlight, stats, seenTogether } = crewPosterContent(wrap, { showMoney });

  return (
    <PosterFrame festivalName={festivalName} kicker="CREW WRAP" byline={byline}>
      <PosterDominant value={dominant.value} label={dominant.label} sub={crewName} />

      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 24 }}>
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
        <Superlative label={spotlight.label} value={spotlight.value} sub={spotlight.sub} />

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
                  padding: '14px 0',
                  borderBottom: `1px solid ${colors.rule}`,
                }}
              >
                <div
                  style={{
                    flex: 1,
                    minWidth: 0,
                    fontSize: font.artist,
                    fontWeight: POSTER.weight,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {s.artist || s.setId}
                </div>
                <div style={{ fontSize: font.secondary, fontWeight: POSTER.weight, color: colors.accent, flexShrink: 0 }}>
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

      <div style={{ marginTop: 24, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 18 }}>
        {stats.map((t) => (
          <div
            key={t.label}
            style={{
              background: colors.tile,
              borderRadius: 24,
              border: `1px solid ${colors.rule}`,
              padding: 28,
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: font.statValue, fontWeight: POSTER.weight, color: colors.accent, lineHeight: 1 }}>{t.value}</div>
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
      <div style={{ fontSize: font.artist, fontWeight: POSTER.weight }}>{value}</div>
      {sub && <div style={{ fontSize: font.secondary, color: colors.secondary, marginTop: 4 }}>{sub}</div>}
    </div>
  );
}
