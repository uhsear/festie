/**
 * Elevation tokens for React Native, where one shadow needs iOS props plus an
 * Android `elevation`. Web has no equivalent: it uses `--shadow-*` strings.
 *
 * `low` lifts a small floating control (scroll-to-top pill, FAB). `high` lifts a
 * card that floats over content (map place card). Spread into a style:
 * `{ ...elevation.low }`. The shadow is always black, so it needs no theme.
 */
export const elevation = {
  low: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 4,
  },
  high: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 8,
  },
} as const;

export type Elevation = typeof elevation;
