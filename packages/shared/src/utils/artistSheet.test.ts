import { describe, it, expect } from 'vitest';
import type { FestivalSet } from '../types/domain';
import { artistNameSegments, artistTargetFromName, enrichArtistTarget } from './artistSheet';

const base = { id: 's1', festivalId: 'f', stageId: 'st', startTime: '', endTime: '', createdAt: '', updatedAt: '' };
const set = (over: Partial<FestivalSet>): FestivalSet => ({ ...base, ...over });

describe('artistNameSegments', () => {
  it('splits a B2B set into one segment per artist', () => {
    const segs = artistNameSegments(set({ artist: 'A b2b B', artists: [{ name: 'A' }, { name: 'B', links: { spotify: 'https://x' } }] }));
    expect(segs.map((s) => s.label)).toEqual(['A', 'B']);
    expect(segs[1]!.target.artists).toEqual([{ name: 'B', links: { spotify: 'https://x' } }]);
  });

  it('keeps a billed name as one segment listing every artist', () => {
    const segs = artistNameSegments(set({ displayName: 'The Duo', artists: [{ name: 'A' }, { name: 'B' }] }));
    expect(segs).toHaveLength(1);
    expect(segs[0]!.label).toBe('The Duo');
    expect(segs[0]!.target.artists.map((a) => a.name)).toEqual(['A', 'B']);
  });

  it('uses the custom B2B separator when it splits', () => {
    const segs = artistNameSegments(set({ artists: [{ name: 'A' }, { name: 'B' }] }), 'x');
    expect(segs.map((s) => s.label)).toEqual(['A', 'B']);
  });

  it('falls back to the plain name when the set has no artist rows', () => {
    const segs = artistNameSegments(set({ artist: 'Solo' }));
    expect(segs).toEqual([{ label: 'Solo', target: { title: 'Solo', artists: [{ name: 'Solo' }] } }]);
  });
});

describe('enrichArtistTarget', () => {
  it('fills a bare name from a loaded set artist, case-insensitively', () => {
    const sets = [set({ artists: [{ name: 'Solo', photo: 'p.jpg', genres: ['house'] }] })];
    const out = enrichArtistTarget(artistTargetFromName('solo'), sets);
    expect(out.artists[0]).toMatchObject({ photo: 'p.jpg' });
  });

  it('leaves a target that already has details alone', () => {
    const target = { title: 'A', artists: [{ name: 'A', genres: ['x'] }] };
    expect(enrichArtistTarget(target, [set({ artists: [{ name: 'A', photo: 'p' }] })])).toBe(target);
  });
});
