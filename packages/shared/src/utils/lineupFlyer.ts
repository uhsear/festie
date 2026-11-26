import type { Festival, FestivalDay, FestivalSet } from '../types/domain';
import { artistDisplayName } from './format';
import { lineupEntryName, lineupDays, setTimesBannerKind } from './lineup';
import { coverLineup, lineupNameKey } from './lineupCover';

/** Type step on the flyer. Tier 1 is the headline, tier 2 the second line, everything else the small print. */
export type FlyerSize = 'headliner' | 'support' | 'rest';

export interface LineupFlyerRow {
  key: string;
  name: string;
  size: FlyerSize;
}

export interface LineupFlyerModel {
  /** Acts in billing order: by tier, then the order the organizer entered them; acts with no tier last. */
  rows: LineupFlyerRow[];
}

const sizeForTier = (tier: number | null): FlyerSize => (tier === 1 ? 'headliner' : tier === 2 ? 'support' : 'rest');

/**
 * The lineup as a flyer, for a published festival whose sets all lack a start time. Null when any set has
 * a time, the festival is a draft or over, or it has no sets: the cards and the announced lineup take over.
 * Acts come from the announced lineup (which carries the billing tier) plus any set that no entry covers.
 */
export function lineupFlyerModel(
  festival: Festival | null | undefined,
  days: readonly FestivalDay[] | null | undefined,
  sets: readonly FestivalSet[] | null | undefined,
  now: number = Date.now(),
): LineupFlyerModel | null {
  const allSets = sets ?? [];
  if (!festival || allSets.length === 0 || setTimesBannerKind(festival, days, allSets, now) === null) return null;

  const separator = festival.b2bSeparator;
  const lineup = (festival.lineup ?? []).filter((entry) => entry.status !== 'cancelled');
  const cover = coverLineup(lineup, lineupDays([...(days ?? [])], [...allSets]), separator || 'b2b');
  const covered = new Set(lineup.flatMap((entry) => cover[entry.id]?.setIds ?? []));

  const seen = new Set<string>();
  const rows: LineupFlyerRow[] = [];
  const add = (key: string, name: string, size: FlyerSize) => {
    const nameKey = lineupNameKey(name);
    if (!nameKey || seen.has(nameKey)) return;
    seen.add(nameKey);
    rows.push({ key, name, size });
  };
  const tierRank = (tier: number | null) => tier ?? Infinity;
  [...lineup]
    .sort((a, b) => tierRank(a.tier) - tierRank(b.tier))
    .forEach((entry) => add(entry.id, lineupEntryName(entry, separator), sizeForTier(entry.tier)));
  for (const set of allSets) {
    if (covered.has(set.id)) continue;
    const named = set.displayName || set.artist || set.artists?.length;
    if (named) add(set.id, artistDisplayName(set, separator), 'rest');
  }
  return rows.length > 0 ? { rows } : null;
}
