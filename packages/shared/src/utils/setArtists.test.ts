import { describe, it, expect } from 'vitest';
import { artistNamesOf, withArtistNames, joinArtistNames } from './setArtists';

describe('setArtists', () => {
  it('artistNamesOf prefers artists, then artist, then a blank entry', () => {
    expect(artistNamesOf({ artist: 'x', artists: [{ name: 'A' }, { name: 'B' }] })).toEqual(['A', 'B']);
    expect(artistNamesOf({ artist: 'Kai' })).toEqual(['Kai']);
    expect(artistNamesOf({ artist: '  ' })).toEqual(['']);
  });

  it('withArtistNames keeps links and photo by index when a middle name is blank', () => {
    const origin = [
      { name: 'A', links: { spotify: 'sa' }, photo: 'pa' },
      { name: 'B', links: { spotify: 'sb' } },
      { name: 'C', links: { spotify: 'sc' }, photo: 'pc' },
    ];
    expect(withArtistNames(origin, ['A', '', 'C'])).toEqual([origin[0], origin[2]]);
  });

  it('withArtistNames gives new artists empty links and trims', () => {
    expect(withArtistNames(undefined, [' Kai '])).toEqual([{ name: 'Kai', links: {} }]);
  });

  it('joinArtistNames uses the separator', () => {
    expect(joinArtistNames(['Kai', 'Mira'])).toBe('Kai b2b Mira');
    expect(joinArtistNames(['Kai', '', 'Mira'], 'vs')).toBe('Kai vs Mira');
  });
});
