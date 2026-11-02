import { colors } from './colors.js';
export const POSTER = {
  width: 1080, height: 1920, padding: 80,
  glowAlpha: 0.3,
  colors: { text: colors.text.primary, secondary: colors.text.secondary, wordmark: colors.accent.aqua, accent: colors.accent.aqua, glowBottom: colors.accent.aqua },
  font: { wordmark: 96, kicker: 32, festival: 56, byline: 30, heading: 28, headline: 72, artist: 40, secondary: 30, statValue: 56, statLabel: 26, quote: 48, footer: 32 },
} as const;
