import { describe, it, expect } from 'vitest';
import { buildGridCrewAvatars, buildGridCrewAvatarsBySet, type GridCrewProfile } from './gridCrewAvatars';

const profiles: GridCrewProfile[] = [
  { id: 'p1', userId: 'u1', name: 'Zed', avatarUrl: 'https://x/z.png' },
  { id: 'p2', userId: 'u2', name: 'Amy' },
  { id: 'p3', userId: 'u3', name: 'Bo' },
  { id: 'p4', userId: 'u4', name: 'Cy' },
  { id: 'p1b', userId: 'u1', name: 'Zed' },
];
const byId = new Map(profiles.map((p) => [p.id, p]));

describe('buildGridCrewAvatars', () => {
  it('returns null when nobody picked the set', () => {
    expect(buildGridCrewAvatars([], byId)).toBeNull();
  });

  it('orders by priority then name and caps at 3 with an overflow count', () => {
    const r = buildGridCrewAvatars(
      [
        { profileId: 'p1', priority: 'maybe' },
        { profileId: 'p2', priority: 'want-to-see' },
        { profileId: 'p3', priority: 'must' },
        { profileId: 'p4', priority: 'must' },
      ],
      byId,
    )!;
    expect(r.shown.map((a) => a.name)).toEqual(['Bo', 'Cy', 'Amy']);
    expect(r.total).toBe(4);
    expect(r.overflow).toBe(1);
    expect(r.label).toBe('4 crew members picked this');
  });

  it('dedupes one avatar per human and keeps their strongest pick', () => {
    const r = buildGridCrewAvatars(
      [
        { profileId: 'p1', priority: 'maybe' },
        { profileId: 'p1b', priority: 'must' },
      ],
      byId,
    )!;
    expect(r.total).toBe(1);
    expect(r.shown).toHaveLength(1);
    expect(r.shown[0].priority).toBe('must');
    expect(r.label).toBe('1 crew member picked this');
  });

  it('keeps unknown profiles as anonymous crew members', () => {
    const r = buildGridCrewAvatars([{ profileId: 'ghost', priority: 'must' }], byId)!;
    expect(r.shown[0]).toMatchObject({ key: 'ghost', name: 'Crew member' });
  });
});

describe('buildGridCrewAvatarsBySet', () => {
  it('only includes sets with crew picks and uses the crew-scoped picker', () => {
    const picks: Record<string, { profileId: string; priority: 'must' }[]> = { a: [{ profileId: 'p2', priority: 'must' }] };
    const m = buildGridCrewAvatarsBySet(['a', 'b'], (id) => picks[id] ?? [], profiles);
    expect([...m.keys()]).toEqual(['a']);
    expect(m.get('a')!.shown[0].name).toBe('Amy');
  });
});
