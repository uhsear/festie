import type { LineupEntry } from '@festie/shared/types';

export type LineupView = 'poster' | 'az';

/** AsyncStorage key for the Poster / A-Z choice, kept per device (web uses the same key in localStorage). */
export const LINEUP_VIEW_KEY = 'festie.lineupView';

/** A missing or unknown stored value falls back to Poster, the default view. */
export function parseLineupView(raw: string | null | undefined): LineupView {
  return raw === 'az' ? 'az' : 'poster';
}

/** The admin editor's read-only line: cancelled entries are not announced acts. Null when there is nothing to say. */
export function announcedActsLine(lineup: readonly Pick<LineupEntry, 'status'>[] | undefined): string | null {
  const count = (lineup ?? []).filter((entry) => entry.status !== 'cancelled').length;
  if (count === 0) return null;
  return `${count} announced ${count === 1 ? 'act' : 'acts'}. Edit them on the web.`;
}
