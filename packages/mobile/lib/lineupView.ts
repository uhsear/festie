export type LineupView = 'poster' | 'az' | 'interested';

/** AsyncStorage key for the Poster / A-Z choice, kept per device (web uses the same key in localStorage). */
export const LINEUP_VIEW_KEY = 'festie.lineupView';

/** A missing or unknown stored value falls back to Poster, the default view. */
export function parseLineupView(raw: string | null | undefined): LineupView {
  return raw === 'az' || raw === 'interested' ? raw : 'poster';
}
