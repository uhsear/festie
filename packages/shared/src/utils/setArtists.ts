import type { Artist } from '../types/domain';

export function artistNamesOf(set: { artist?: string; artists?: Artist[] }): string[] {
  if (set.artists?.length) return set.artists.map((a) => a.name);
  return [set.artist?.trim() ? set.artist : ''];
}

/**
 * Maps first and filters second, so each artist keeps its own id, links and photo when a middle name
 * is blank. A slot whose name matches no earlier artist is a different artist: it drops the id and everything that
 * came with it, so the server matches the typed name again. A typo is fixed on the Artists tab.
 */
export function withArtistNames(origin: Artist[] | undefined, names: string[]): Artist[] {
  return names
    .map((n, i) => {
      const name = n.trim();
      // The same slot first, then the same name anywhere: a B2B reorder keeps each artist.
      const before = origin?.[i]?.name === name ? origin[i] : origin?.find((o) => o?.name === name);
      return before ? { ...before } : { links: {}, name };
    })
    .filter((a) => a.name);
}

export function joinArtistNames(names: string[], separator = 'b2b'): string {
  return names
    .map((n) => n.trim())
    .filter(Boolean)
    .join(` ${separator.trim() || 'b2b'} `);
}
