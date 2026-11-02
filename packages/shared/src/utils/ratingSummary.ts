import { RATING_LABEL } from '../constants/config';
import type { CrewRating, CrowdRating } from '../services/ratings';

const MAX_NAMES = 4;

export function summarizeSetRatings(args: {
  setId: string;
  crowd: Map<string, CrowdRating> | null;
  crew: Map<string, CrewRating[]> | null;
  myUserId: string | null;
}): { crowd: string | null; crew: string | null } {
  const c = args.crowd?.get(args.setId);
  let crowd: string | null = null;
  if (c) {
    const text = `${c.avg.toFixed(1)} out of 5 from ${c.count} ratings`;
    if (c.count >= 5 && c.avg >= 4.5) crowd = `Crowd favourite · ${text}`;
    else if (c.count >= 3) crowd = `Crowd: ${text}`;
  }

  const others = (args.crew?.get(args.setId) ?? [])
    .filter((r) => r.userId !== args.myUserId)
    .sort((a, b) => b.rating - a.rating || a.username.localeCompare(b.username));
  let crew: string | null = null;
  if (others.length) {
    const names = others.slice(0, MAX_NAMES).map((r) => `${r.username} (${RATING_LABEL[r.rating] ?? r.rating})`);
    const more = others.length - MAX_NAMES;
    crew = `Your crew: ${names.join(', ')}${more > 0 ? ` and ${more} more` : ''}`;
  }
  return { crowd, crew };
}
