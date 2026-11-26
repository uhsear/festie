import type { ReactNode } from 'react';
import { POSTER } from '@festie/shared/tokens';
import { posterBand } from '@festie/shared/utils';

interface Props {
  festivalName: string;
  kicker: string;
  byline?: string | null;
  children: ReactNode;
}

const CLASH = "'Clash Display', system-ui, sans-serif";

/**
 * Fixed 1080x1920 share-poster frame: one festival-hue band, a left-aligned header with the
 * mark, a body that starts at a fixed y, and a footer. Inline styles only, because CSS variables
 * do not resolve reliably in html-to-image. The mobile frame places the same boxes from
 * POSTER.layout, so a card matches on both apps.
 */
export default function PosterFrame({ festivalName, kicker, byline, children }: Props) {
  const { font, colors, layout, padding } = POSTER;
  return (
    <div
      style={{
        position: 'relative',
        width: POSTER.width,
        height: POSTER.height,
        background: colors.ground,
        color: colors.text,
        fontFamily: 'Space Grotesk, system-ui, -apple-system, sans-serif',
        textAlign: 'left',
        overflow: 'hidden',
      }}
    >
      <div
        data-poster="band"
        style={{ position: 'absolute', top: 0, left: 0, width: POSTER.width, height: POSTER.band.height, background: posterBand(festivalName).colour }}
      />
      <header style={{ position: 'absolute', top: layout.headerTop, left: padding, width: POSTER.width - 2 * padding, height: layout.headerHeight }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20, height: layout.markSize }}>
          <img src="/favicon.svg" alt="" width={layout.markSize} height={layout.markSize} />
          <div
            style={{ fontFamily: CLASH, fontSize: font.wordmark, fontWeight: POSTER.weight, letterSpacing: 6, color: colors.text, lineHeight: 1 }}
          >
            FESTIE
          </div>
        </div>
        <div style={{ fontSize: font.kicker, color: colors.secondary, marginTop: 24, letterSpacing: 3, textTransform: 'uppercase' }}>
          {kicker}
        </div>
        <div
          style={{
            fontFamily: CLASH,
            fontSize: font.festival,
            fontWeight: POSTER.weight,
            marginTop: 12,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {festivalName}
        </div>
        {byline && <div style={{ fontSize: font.byline, color: colors.secondary, marginTop: 8 }}>{byline}</div>}
      </header>

      <section style={{ position: 'absolute', top: layout.bodyTop, left: padding, width: POSTER.width - 2 * padding, bottom: padding + layout.footerHeight + 24 }}>
        {children}
      </section>

      <footer
        style={{ position: 'absolute', left: padding, bottom: padding, height: layout.footerHeight, fontSize: font.footer, color: colors.secondary, letterSpacing: 6 }}
      >
        FESTIE.US
      </footer>
    </div>
  );
}
