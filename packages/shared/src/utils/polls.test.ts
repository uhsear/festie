import { describe, it, expect } from 'vitest';
import type { CrewMember, CrewPoll } from '../types/domain';
import {
  tallyPoll,
  isPollClosed,
  splitPolls,
  nextVoteIndexes,
  pollPercent,
  pollDecision,
  decisionSetId,
  pollClosesAt,
  meetWherePollOptions,
  pollNonVoterIds,
  voterNamesLine,
  joinNames,
  crewMemberName,
} from './polls';

const poll = (over: Partial<CrewPoll> = {}): CrewPoll => ({
  id: 'p',
  crew_id: 'c',
  created_by: 'u1',
  question: 'Q',
  options: ['Tacos', 'Pizza', 'Sushi'],
  votes: [],
  closes_at: null,
  closed: false,
  created_at: '2026-06-06T10:00:00.000Z',
  ...over,
});

describe('tallyPoll', () => {
  it('counts a multi-answer voter once in voterCount', () => {
    const t = tallyPoll(
      poll({ votes: [{ option: 0, user_id: 'a' }, { option: 2, user_id: 'a' }, { option: 0, user_id: 'b' }] }),
      'a',
    );
    expect(t.counts).toEqual([2, 0, 1]);
    expect(t.voterCount).toBe(2);
    expect(t.myIndexes).toEqual([0, 2]);
    expect(t.voters[0]).toEqual(['a', 'b']);
  });
  it('lists both leaders on a tie and skips bad votes', () => {
    const t = tallyPoll(
      poll({ votes: [{ option: 0, user_id: 'a' }, { option: 1, user_id: 'b' }, { option: 9, user_id: 'c' }, { option: 0, user_id: null }] }),
      null,
    );
    expect(t.leaders).toEqual([0, 1]);
    expect(t.voterCount).toBe(2);
  });
  it('has no leaders with zero votes', () => {
    expect(tallyPoll(poll(), 'a').leaders).toEqual([]);
  });
});

describe('isPollClosed', () => {
  const now = Date.parse('2026-06-06T12:00:00.000Z');
  it('handles closed, past and future end times', () => {
    expect(isPollClosed({ closed: true, closes_at: null }, now)).toBe(true);
    expect(isPollClosed({ closed: false, closes_at: '2026-06-06T11:00:00.000Z' }, now)).toBe(true);
    expect(isPollClosed({ closed: false, closes_at: '2026-06-06T13:00:00.000Z' }, now)).toBe(false);
  });
});

describe('splitPolls', () => {
  it('keeps open order and sorts decided newest first', () => {
    const now = Date.parse('2026-06-06T12:00:00.000Z');
    const a = poll({ id: 'a' });
    const b = poll({ id: 'b', closed: true, closed_at: '2026-06-06T09:00:00.000Z' });
    const c = poll({ id: 'c', closed: true, closed_at: '2026-06-06T11:00:00.000Z' });
    const d = poll({ id: 'd' });
    const r = splitPolls([a, b, c, d], now);
    expect(r.open.map((p) => p.id)).toEqual(['a', 'd']);
    expect(r.decided.map((p) => p.id)).toEqual(['c', 'b']);
  });
});

describe('nextVoteIndexes', () => {
  it('single answer: same tap clears, other tap replaces', () => {
    expect(nextVoteIndexes({ multi_answer: false }, [1], 1)).toEqual([]);
    expect(nextVoteIndexes({ multi_answer: false }, [1], 2)).toEqual([2]);
  });
  it('multi answer toggles on and off', () => {
    expect(nextVoteIndexes({ multi_answer: true }, [2], 0)).toEqual([0, 2]);
    expect(nextVoteIndexes({ multi_answer: true }, [0, 2], 0)).toEqual([2]);
  });
});

describe('pollPercent', () => {
  it('rounds and guards zero', () => {
    expect(pollPercent(1, 3)).toBe(33);
    expect(pollPercent(1, 0)).toBe(0);
  });
});

describe('pollDecision / decisionSetId', () => {
  const p = poll();
  it('winner', () => {
    const t = tallyPoll({ ...p, votes: [{ option: 0, user_id: 'a' }] }, null);
    expect(pollDecision(p, t)).toEqual({ kind: 'winner', text: 'Decided: Tacos', winnerIndex: 0 });
  });
  it('tie of 3', () => {
    const t = tallyPoll({ ...p, votes: [{ option: 0, user_id: 'a' }, { option: 1, user_id: 'b' }, { option: 2, user_id: 'c' }] }, null);
    expect(pollDecision(p, t)).toEqual({ kind: 'tie', text: 'Tie: Tacos, Pizza and Sushi', winnerIndex: null });
  });
  it('none', () => {
    expect(pollDecision(p, tallyPoll(p, null))).toEqual({ kind: 'none', text: 'No votes', winnerIndex: null });
  });
  it('set id is null on a tie and read from set_refs on a win', () => {
    const refs = [{ setId: 's1', label: 'L', stageReference: null, meetAt: null }, null, null];
    expect(decisionSetId({ set_refs: refs }, { winnerIndex: null })).toBeNull();
    expect(decisionSetId({ set_refs: refs }, { winnerIndex: 0 })).toBe('s1');
    expect(decisionSetId({ set_refs: refs }, { winnerIndex: 1 })).toBeNull();
  });
});

describe('pollClosesAt', () => {
  const now = Date.parse('2026-06-06T12:00:00.000Z');
  it('adds durations', () => {
    expect(pollClosesAt('none', now)).toBeUndefined();
    expect(pollClosesAt('30m', now)).toBe('2026-06-06T12:30:00.000Z');
    expect(pollClosesAt('1h', now)).toBe('2026-06-06T13:00:00.000Z');
  });
  it('set start needs more than 1 minute of lead', () => {
    expect(pollClosesAt('setStart', now, now + 30_000)).toBeUndefined();
    expect(pollClosesAt('setStart', now, null)).toBeUndefined();
    expect(pollClosesAt('setStart', now, now + 120_000)).toBe('2026-06-06T12:02:00.000Z');
  });
});

describe('meetWherePollOptions', () => {
  it('orders, de-duplicates case-insensitively and caps at 4', () => {
    const out = meetWherePollOptions({
      homeBase: ' Camp ',
      meetingPoints: [{ label: 'Ferris wheel' }, { label: 'Old', active: false }],
      stages: [{ name: 'Main Stage' }, { name: 'main stage' }, { name: 'Bass' }, { name: 'Wave' }],
    });
    expect(out).toEqual(['Camp', 'Ferris wheel', 'Main Stage', 'Bass']);
  });
});

describe('names helpers', () => {
  const members: CrewMember[] = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ userId: id, name: id.toUpperCase() }));
  it('voterNamesLine', () => {
    expect(voterNamesLine(['a', 'b', 'c', 'd', 'e'], members)).toBe('A, B, C +2');
    expect(voterNamesLine(['a', 'zz'], members)).toBe('A, Someone');
    expect(voterNamesLine([], members)).toBe('');
  });
  it('joinNames', () => {
    expect(joinNames([])).toBe('');
    expect(joinNames(['A'])).toBe('A');
    expect(joinNames(['A', 'B'])).toBe('A and B');
    expect(joinNames(['A', 'B', 'C'])).toBe('A, B and C');
  });
  it('crewMemberName and pollNonVoterIds', () => {
    expect(crewMemberName({ username: 'sam' })).toBe('sam');
    expect(crewMemberName(undefined)).toBe('Someone');
    expect(pollNonVoterIds({ votes: [{ option: 0, user_id: 'a' }] }, ['a', 'b'])).toEqual(['b']);
  });
});
