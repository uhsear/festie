import { describe, it, expect } from 'vitest';
import { searchAdminTargets } from './adminSearch';

const data = {
  festivals: [
    { id: 'f1', name: 'Forbidden Kingdom', location: 'Hesperia, CA' },
    { id: 'f2', name: 'Samba Fest', location: null },
  ],
  crews: [
    { id: 'c1', name: 'Sam Squad', inviteCode: 'ABC123', festivalName: 'Samba Fest' },
    { id: 'c2', name: 'Late crew', inviteCode: 'SAM', festivalName: 'Forbidden Kingdom' },
  ],
};

describe('searchAdminTargets', () => {
  it('returns [] for an empty query', () => {
    expect(searchAdminTargets('   ', data)).toEqual([]);
  });

  it('ranks an exact invite code first', () => {
    const r = searchAdminTargets('sam', data);
    const crews = r.filter((t) => t.kind === 'crew');
    expect(crews[0]).toEqual({
      kind: 'crew',
      id: 'c2',
      label: 'Late crew',
      hint: 'Invite code SAM · Forbidden Kingdom',
    });
    expect(crews[1].id).toBe('c1');
  });

  it('matches festivals by name or location and ends with a user row', () => {
    const r = searchAdminTargets('hesperia', data);
    expect(r[0]).toEqual({ kind: 'festival', id: 'f1', label: 'Forbidden Kingdom', hint: 'Hesperia, CA' });
    expect(r[r.length - 1]).toEqual({
      kind: 'user',
      id: 'hesperia',
      label: 'Search users for "hesperia"',
      hint: 'Opens the user list',
    });
  });

  it('limits kinds with a prefix', () => {
    expect(searchAdminTargets('f sam', data).map((t) => t.kind)).toEqual(['festival']);
    expect(searchAdminTargets('c sam', data).map((t) => t.kind)).toEqual(['crew', 'crew']);
    const u = searchAdminTargets('u sam', data);
    expect(u).toEqual([{ kind: 'user', id: 'sam', label: 'Search users for "sam"', hint: 'Opens the user list' }]);
  });

  it('holds the limit', () => {
    const many = {
      festivals: Array.from({ length: 9 }, (_, i) => ({ id: `f${i}`, name: `Fest ${i}` })),
      crews: [],
    };
    expect(searchAdminTargets('fest', many, 3).filter((t) => t.kind === 'festival')).toHaveLength(3);
  });
});
