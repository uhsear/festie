import { colors } from './colors.js';
export const POSTER = {
  width: 1080, height: 1920, padding: 80,
  colors: {
    ground: colors.bg.primary,
    text: colors.text.primary,
    secondary: colors.text.secondary,
    muted: colors.text.muted,
    accent: colors.accent.aqua,
    /** Rail colour when a row has no stage colour of its own. */
    rail: colors.stage.fallback,
    /** Row dividers and stat tiles: neutral, so the festival hue lives only in the band. */
    rule: colors.border.light,
    tile: colors.bg.secondary,
    // Posters are dark artwork in both themes, so they read the Stage priority colours.
    priority: { must: colors.priority.must, want: colors.priority.want, maybe: colors.priority.maybe },
  },
  /** Clash Display 700 on both platforms: web ships no 900 cut. */
  weight: 700,
  /** The one festival-hue band across the top edge. It replaces both radial glows. */
  band: { height: 24, minContrast: 3, hueExclusion: 25 },
  /**
   * Fixed y positions in poster px. Web and mobile frames both place the header, the dominant
   * object and the rows from these numbers, so one card has the same boxes on both apps.
   */
  layout: { headerTop: 80, headerHeight: 330, bodyTop: 410, dominantHeight: 380, dominantBlock: 520, rowHeight: 150, maxRows: 5, footerHeight: 40, markSize: 72, railWidth: 10, railHeight: 88, timeWidth: 220 },
  /** Dominant typographic object: 360 px or more. */
  dominantSize: 360,
  font: { wordmark: 56, kicker: 32, festival: 56, byline: 30, heading: 28, headline: 72, artist: 40, secondary: 30, statValue: 56, statLabel: 26, quote: 48, footer: 32, time: 36 },
} as const;
