import type { ReactNode } from 'react';
import { POSTER } from '@festie/shared/tokens';
import { festivalTint } from '@festie/shared/utils';

interface Props {
  festivalName: string;
  kicker: string;
  byline?: string | null;
  children: ReactNode;
}

const rgba = (hex: string, alpha: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
};

/**
 * Fixed 1080x1920 share-poster frame: header, centred body, footer. Inline styles only,
 * because CSS variables do not resolve reliably in html-to-image. The mobile frame draws
 * the same layout, so a card looks identical on both apps.
 */
export default function PosterFrame({ festivalName, kicker, byline, children }: Props) {
  const tint = festivalTint(festivalName);
  const { font, colors } = POSTER;
  return (
    <div
      style={{
        width: POSTER.width,
        height: POSTER.height,
        background: tint.bg,
        backgroundImage:
          `radial-gradient(60% 45% at 50% 0%, ${rgba(tint.active, POSTER.glowAlpha)}, transparent 60%), ` +
          `radial-gradient(60% 45% at 50% 100%, ${rgba(colors.glowBottom, POSTER.glowAlpha)}, transparent 60%)`,
        color: colors.text,
        fontFamily: 'Space Grotesk, system-ui, -apple-system, sans-serif',
        textAlign: 'left',
        padding: POSTER.padding,
        display: 'flex',
        flexDirection: 'column',
        boxSizing: 'border-box',
      }}
    >
      <header style={{ textAlign: 'center' }}>
        <div
          style={{
            fontFamily: "'Clash Display', system-ui, sans-serif",
            fontSize: font.wordmark,
            fontWeight: 900,
            letterSpacing: 8,
            color: colors.wordmark,
            lineHeight: 1,
          }}
        >
          FESTIE
        </div>
        <div
          style={{
            fontSize: font.kicker,
            color: colors.secondary,
            marginTop: 16,
            letterSpacing: 3,
            textTransform: 'uppercase',
          }}
        >
          {kicker}
        </div>
        <div
          style={{
            fontSize: font.festival,
            fontWeight: 700,
            marginTop: 18,
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

      <section style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: 0 }}>
        {children}
      </section>

      <footer
        style={{
          textAlign: 'center',
          fontSize: font.footer,
          color: colors.secondary,
          letterSpacing: 6,
        }}
      >
        FESTIE.US
      </footer>
    </div>
  );
}
