import { describe, it, expect } from 'vitest';
import type { FestivalSet } from '../types/domain';
import type { LineupEntry } from '../types/domain';
import { artistNameSegments, artistTargetFromName, enrichArtistTarget, lineupEntrySegments } from './artistSheet';

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

describe('enrichArtistTarget by id', () => {
  it('matches an artist with an id by id, never by a shared name', () => {
    const sets = [set({ artists: [{ id: 'a2', name: 'Solo', photo: 'other.jpg' }] })];
    const out = enrichArtistTarget({ title: 'Solo', artists: [{ id: 'a1', name: 'Solo' }] }, sets);
    expect(out.artists[0]).toEqual({ id: 'a1', name: 'Solo' });
  });

  it('fills an artist with an id from the set artist with the same id', () => {
    const sets = [set({ artists: [{ id: 'a1', name: 'Solo', photo: 'p.jpg' }] })];
    const out = enrichArtistTarget({ title: 'Solo', artists: [{ id: 'a1', name: 'Solo' }] }, sets);
    expect(out.artists[0]).toMatchObject({ photo: 'p.jpg' });
  });
});

describe('lineupEntrySegments', () => {
  const entry = (over: Partial<LineupEntry>): LineupEntry =>
    ({ id: 'e1', artists: [{ name: 'A' }, { name: 'B' }], ...over }) as LineupEntry;

  it('splits a B2B act into one piece per artist without the interest id', () => {
    const segs = lineupEntrySegments(entry({}), undefined, true);
    expect(segs.map((s) => s.label)).toEqual(['A', 'B']);
    expect(segs[0]!.target.entryId).toBeUndefined();
  });

  it('adds the entry id to a single piece only for an announced act', () => {
    const one = entry({ artists: [{ name: 'A' }] });
    expect(lineupEntrySegments(one, undefined, true)[0]!.target.entryId).toBe('e1');
    expect(lineupEntrySegments(one, undefined, false)[0]!.target.entryId).toBeUndefined();
  });

  it('keeps a billed name as one piece', () => {
    const segs = lineupEntrySegments(entry({ displayName: 'The Duo' }), undefined, false);
    expect(segs).toHaveLength(1);
    expect(segs[0]!.label).toBe('The Duo');
  });
});
