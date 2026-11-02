import type { Artist } from '../types/domain';

export function artistNamesOf(set: { artist?: string; artists?: Artist[] }): string[] {
  if (set.artists?.length) return set.artists.map((a) => a.name);
  return [set.artist?.trim() ? set.artist : ''];
}

/** Maps first and filters second, so each artist keeps its own links and photo when a middle name is blank. */
export function withArtistNames(origin: Artist[] | undefined, names: string[]): Artist[] {
  return names.map((n, i) => ({ ...(origin?.[i] ?? { links: {} }), name: n.trim() })).filter((a) => a.name);
}

export function joinArtistNames(names: string[], separator = 'b2b'): string {
  return names
    .map((n) => n.trim())
    .filter(Boolean)
    .join(` ${separator.trim() || 'b2b'} `);
}
