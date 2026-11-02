import { describe, it, expect } from 'vitest';
import { crewTabBadge, badgeA11yLabel, balanceCents, openPollIds } from './crewBadge';

const poll = (id: string, extra: Record<string, unknown> = {}) => ({ id, closed: false, votes: [], ...extra });
const base = { myBalance: 0, userId: 'u1', seen: undefined };

describe('crewTabBadge', () => {
  it('counts an unvoted open poll', () => {
    expect(crewTabBadge({ ...base, polls: [poll('p1')] })).toEqual({ count: 1, dot: false, label: '1' });
  });

  it('ignores voted, closed and seen polls', () => {
    const polls = [
      poll('voted', { votes: [{ user_id: 'u1' }] }),
      poll('closed', { closed: true }),
      poll('seen'),
    ];
    const r = crewTabBadge({ ...base, polls, seen: { pollIds: ['seen'], balanceCents: null } });
    expect(r.count).toBe(0);
  });

  it('skips null votes', () => {
    const r = crewTabBadge({ ...base, polls: [poll('p', { votes: [null, { user_id: null }] })] });
    expect(r.count).toBe(1);
  });

  it('caps the label at 9+', () => {
    const polls = Array.from({ length: 10 }, (_, i) => poll(`p${i}`));
    expect(crewTabBadge({ ...base, polls }).label).toBe('9+');
  });

  it('balance dot appears, clears when seen, returns on change', () => {
    const dot = (myBalance: number, seen?: number) =>
      crewTabBadge({
        polls: [],
        myBalance,
        userId: 'u1',
        seen: seen === undefined ? undefined : { pollIds: [], balanceCents: seen },
      });
    expect(dot(5.5)).toEqual({ count: 0, dot: true, label: '' });
    expect(dot(5.5, 550).dot).toBe(false);
    expect(dot(7, 550).dot).toBe(true);
    expect(dot(0).dot).toBe(false);
  });

  it('gives nothing without a user', () => {
    expect(crewTabBadge({ ...base, userId: null, polls: [poll('p')], myBalance: 5 })).toEqual({
      count: 0,
      dot: false,
      label: null,
    });
  });

  it('helpers', () => {
    expect(balanceCents(12.34)).toBe(1234);
    expect(balanceCents(null)).toBe(0);
    expect(openPollIds([poll('a'), poll('b', { closed: true })])).toEqual(['a']);
  });
});

describe('badgeA11yLabel', () => {
  it('words count, dot and none', () => {
    expect(badgeA11yLabel('Crew', { count: 2, dot: false })).toBe('Crew, 2 new');
    expect(badgeA11yLabel('Crew', { count: 0, dot: true })).toBe('Crew, needs attention');
    expect(badgeA11yLabel('Crew', { count: 0, dot: false })).toBe('Crew');
  });
});
