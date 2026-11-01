import { describe, it, expect } from 'vitest';
import {
  crewCapState,
  crewCopy,
  crewFestivalChoices,
  festivalLabel,
  groupCrewsByFestival,
  handOverCandidates,
  memberAvatarUrl,
  memberCountLabel,
  openPollState,
  ownedCrewsForDeletion,
} from './crewManage';
import type { Crew, CrewMember, Festival } from '../types/domain';

const NOW = new Date('2026-11-06T12:00:00');

const fest = (id: string, name: string, startDate: string, endDate = startDate): Festival =>
  ({ id, name, startDate, endDate }) as Festival;
const crew = (id: string, festivalId?: string, extra: Partial<Crew> = {}): Crew => ({
  id,
  name: id,
  owner: 'u1',
  festivalId,
  members: [],
  createdAt: '',
  updatedAt: '',
  ...extra,
});

const current = fest('cur', 'EDC Orlando', '2026-11-06', '2026-11-08');
const upcoming = fest('up', 'Ultra 2027', '2027-03-26');
const later = fest('later', 'Sunfest', '2027-05-01');
const past = fest('past', 'Lost Lands 2026', '2026-09-18');
const oldPast = fest('old', 'Tomorrowland', '2025-07-18');

describe('festivalLabel', () => {
  it('adds the start year when the name has none', () => {
    expect(festivalLabel({ name: 'EDC Orlando', startDate: '2026-11-06' })).toBe('EDC Orlando 2026');
  });
  it('keeps a name that has a year', () => {
    expect(festivalLabel({ name: 'Lost Lands 2026', startDate: '2026-09-18' })).toBe('Lost Lands 2026');
  });
  it('keeps the name when the date is not a year', () => {
    expect(festivalLabel({ name: 'Mystery', startDate: '' })).toBe('Mystery');
  });
});

describe('groupCrewsByFestival', () => {
  const festivals = [past, upcoming, current, later, oldPast];

  it('orders current, upcoming, past, then unknown', () => {
    const crews = [crew('a', 'past'), crew('b', 'up'), crew('c', 'cur'), crew('d', 'nope'), crew('e')];
    const groups = groupCrewsByFestival(crews, festivals, 'cur', NOW);
    expect(groups.map((g) => g.festivalId)).toEqual(['cur', 'up', 'past', null]);
    expect(groups[0].isCurrent).toBe(true);
    expect(groups[2].status).toBe('past');
    expect(groups[3].label).toBeNull();
    expect(groups[3].crews.map((c) => c.id)).toEqual(['d', 'e']);
  });

  it('sorts upcoming ascending and past descending', () => {
    const crews = [crew('a', 'old'), crew('b', 'past'), crew('c', 'later'), crew('d', 'up')];
    const groups = groupCrewsByFestival(crews, festivals, null, NOW);
    expect(groups.map((g) => g.festivalId)).toEqual(['up', 'later', 'past', 'old']);
  });

  it('keeps server order inside a group and puts optimistic crews with unknown festivals last', () => {
    const crews = [crew('x', 'cur'), crew('opt', undefined, { _optimistic: true }), crew('y', 'cur')];
    const groups = groupCrewsByFestival(crews, festivals, 'cur', NOW);
    expect(groups[0].crews.map((c) => c.id)).toEqual(['x', 'y']);
    expect(groups[1].festivalId).toBeNull();
    expect(groups[1].crews[0].id).toBe('opt');
  });

  it('puts everything in the unknown group with no festivals', () => {
    const groups = groupCrewsByFestival([crew('a', 'cur')], [], 'cur', NOW);
    expect(groups).toHaveLength(1);
    expect(groups[0].festivalId).toBeNull();
  });

  it('returns no groups for no crews', () => {
    expect(groupCrewsByFestival([], festivals, 'cur', NOW)).toEqual([]);
  });
});

describe('crewFestivalChoices', () => {
  it('drops past festivals, puts the current first, sorts the rest by start', () => {
    const out = crewFestivalChoices([later, past, upcoming, current], 'cur', NOW);
    expect(out.map((f) => f.id)).toEqual(['cur', 'up', 'later']);
  });
  it('keeps the current festival when it is past', () => {
    const out = crewFestivalChoices([upcoming, past], 'past', NOW);
    expect(out.map((f) => f.id)).toEqual(['past', 'up']);
  });
  it('returns an empty list for no festivals', () => {
    expect(crewFestivalChoices([], 'cur', NOW)).toEqual([]);
  });
});

describe('crewCapState', () => {
  it('has no text with no festival or no crews', () => {
    expect(crewCapState([], 'cur').text).toBeNull();
    expect(crewCapState([crew('a', 'cur')], null).text).toBeNull();
  });
  it('shows the count below the cap', () => {
    const s = crewCapState([crew('a', 'cur'), crew('b', 'cur'), crew('c', 'up')], 'cur');
    expect(s).toMatchObject({ count: 2, max: 3, atCap: false, text: '2 of 3 crews for this festival' });
  });
  it('flags the cap and ignores optimistic crews', () => {
    const crews = [crew('a', 'cur'), crew('b', 'cur'), crew('c', 'cur'), crew('d', 'cur', { _optimistic: true })];
    const s = crewCapState(crews, 'cur');
    expect(s.count).toBe(3);
    expect(s.atCap).toBe(true);
    expect(s.text).toBe("You're in 3 of 3 crews for this festival. Leave one to start another.");
  });
});

describe('memberCountLabel', () => {
  it('handles singular and plural without a max', () => {
    expect(memberCountLabel(1, 30)).toBe('1 member');
    expect(memberCountLabel(4)).toBe('4 members');
    expect(memberCountLabel(4, null)).toBe('4 members');
  });
  it('shows the max near the cap and when full', () => {
    expect(memberCountLabel(24, 30)).toBe('24 members');
    expect(memberCountLabel(25, 30)).toBe('25 of 30 members');
    expect(memberCountLabel(28, 30)).toBe('28 of 30 members');
    expect(memberCountLabel(30, 30)).toBe('30 of 30 members · full');
  });
});

describe('openPollState', () => {
  const now = Date.parse('2026-11-06T12:00:00Z');
  it('counts open polls and flags the cap', () => {
    const s = openPollState([{}, { closes_at: null }, { closesAt: '2026-12-01T00:00:00Z' }], now);
    expect(s).toEqual({ open: 3, atCap: true, text: crewCopy.pollCap });
  });
  it('does not count closed or expired polls', () => {
    const s = openPollState([{}, {}, { closed: true }, { closes_at: '2026-11-01T00:00:00Z' }], now);
    expect(s).toEqual({ open: 2, atCap: false, text: null });
  });
});

describe('memberAvatarUrl', () => {
  it('builds the upload path', () => {
    expect(memberAvatarUrl({ avatarKey: 'u1', avatarVersion: '3' }, 'https://festie.us')).toBe(
      'https://festie.us/uploads/avatars/u1.webp?v=3',
    );
  });
  it('trims a trailing slash and defaults to a relative path', () => {
    expect(memberAvatarUrl({ avatarKey: 'u1', avatarVersion: '3' }, 'https://festie.us/')).toBe(
      'https://festie.us/uploads/avatars/u1.webp?v=3',
    );
    expect(memberAvatarUrl({ avatarKey: 'u1', avatarVersion: '3' })).toBe('/uploads/avatars/u1.webp?v=3');
  });
  it('is undefined without both fields', () => {
    expect(memberAvatarUrl({ avatarKey: 'u1', avatarVersion: null })).toBeUndefined();
    expect(memberAvatarUrl({ avatarKey: null, avatarVersion: '3' })).toBeUndefined();
  });
});

describe('handOverCandidates', () => {
  const m = (userId: string, joinedAt?: string): CrewMember => ({ userId, joinedAt });
  it('excludes self, sorts by joinedAt, puts missing last, keeps ties in input order', () => {
    const members = [
      m('self', '2026-01-01'),
      m('none1'),
      m('late', '2026-03-01'),
      m('tieA', '2026-02-01'),
      m('tieB', '2026-02-01'),
      m('none2'),
    ];
    expect(handOverCandidates(members, 'self').map((x) => x.userId)).toEqual([
      'tieA',
      'tieB',
      'late',
      'none1',
      'none2',
    ]);
  });
});

describe('ownedCrewsForDeletion', () => {
  const members = (...ids: string[]): CrewMember[] => ids.map((userId) => ({ userId }));
  it('splits owned crews into handover and solo, and skips crews the user does not own', () => {
    const crews = [
      crew('a', 'cur', { role: 'owner', members: members('me', 'x', 'y') }),
      crew('b', 'cur', { owner: 'me', members: members('me') }),
      crew('c', 'cur', { owner: 'other', role: 'member', members: members('me', 'other') }),
    ];
    const out = ownedCrewsForDeletion(crews, 'me');
    expect(out.soloCount).toBe(1);
    expect(out.handover).toHaveLength(1);
    expect(out.handover[0].crew.id).toBe('a');
    expect(out.handover[0].defaultOwnerId).toBe('x');
  });
});

describe('crewCopy.deleteSolo', () => {
  it('uses the singular for 1', () => {
    expect(crewCopy.deleteSolo(1)).toBe("You're the only member of 1 crew. It is deleted with your account after 30 days.");
  });
  it('uses the plural for more', () => {
    expect(crewCopy.deleteSolo(2)).toBe(
      "You're the only member of 2 crews. They are deleted with your account after 30 days.",
    );
  });
});
