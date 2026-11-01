import { describe, it, expect } from 'vitest';
import {
  NOTE_MAX_LENGTH,
  SPLIT_PLAN_PREFIX,
  buildSplitPlan,
  findSplitPlanLine,
  invertChange,
  planClearSplit,
  planKeep,
  planSplit,
  type ClashChange,
  type SplitContext,
} from './clashPlan';
import { buildPickConflicts, type ConflictGroup } from './pickConflicts';
import type { FestivalDay, FestivalSet, Priority } from '../types/domain';

const DAYS: FestivalDay[] = [{ id: 'd0', festivalId: 'f1', date: '2026-06-13', createdAt: '', updatedAt: '' }];

// 0.0036 degrees of latitude is about 400 m: a 6 minute walk.
const STAGES = [
  { id: 'other', latitude: 40.0, longitude: -74.0 },
  { id: 'main', latitude: 40.0036, longitude: -74.0 },
];

const CTX: SplitContext = {
  timeZone: 'UTC',
  stageName: (id) => (id === 'main' ? 'Main Stage' : 'Other Stage'),
};

function makeSet(id: string, startTime: string, endTime: string, stageId = 'other'): FestivalSet {
  return {
    id,
    festivalId: 'f1',
    stageId,
    dayIndex: 0,
    startTime,
    endTime,
    artist: id.toUpperCase(),
    createdAt: '',
    updatedAt: '',
  };
}

function group(sets: FestivalSet[], myPicks: Record<string, Priority>, withStages = true): ConflictGroup {
  const groups = buildPickConflicts({
    sets,
    myPicks,
    selectedDay: 0,
    days: DAYS,
    timeZone: 'UTC',
    ...(withStages ? { stages: STAGES } : {}),
  });
  expect(groups).toHaveLength(1);
  return groups[0]!;
}

const splitGroup = () =>
  group([makeSet('a', '21:00', '22:30'), makeSet('b', '21:30', '23:00', 'main')], { a: 'want-to-see', b: 'must' });

const SPLIT_SENTENCE = 'See the first 24 min of A, leave at 9:24 PM and walk 6 min to Main Stage for B.';

describe('buildSplitPlan', () => {
  it('leaves the earlier set in time to walk to the kept later set', () => {
    const plan = buildSplitPlan(splitGroup(), CTX);
    expect(plan).toEqual({
      leaveSetId: 'a',
      joinSetId: 'b',
      keepSetId: 'b',
      leaveAtMs: Date.UTC(2026, 5, 13, 21, 24),
      walkMinutes: 6,
      sentence: SPLIT_SENTENCE,
    });
  });

  it('catches the end of the later set when the earlier one is kept, without a walk', () => {
    const g = group(
      [makeSet('a', '21:00', '22:30'), makeSet('b', '21:30', '23:00', 'main')],
      { a: 'must', b: 'maybe' },
      false,
    );
    expect(buildSplitPlan(g, CTX)?.sentence).toBe('See all of A, then go to Main Stage for the last 30 min of B.');
  });

  it('has no split when one set contains the other', () => {
    const g = group([makeSet('a', '21:00', '23:00'), makeSet('b', '21:30', '22:30', 'main')], {
      a: 'maybe',
      b: 'must',
    });
    expect(buildSplitPlan(g, CTX)).toBeNull();
  });

  it('has no split when it leaves less than 10 minutes of the set', () => {
    // Leave at 21:09 for a 6 min walk: 9 minutes of A.
    const g = group([makeSet('a', '21:00', '22:00'), makeSet('b', '21:15', '22:30', 'main')], {
      a: 'maybe',
      b: 'must',
    });
    expect(buildSplitPlan(g, CTX)).toBeNull();
  });
});

describe('planKeep', () => {
  it('removes the other pick', () => {
    const change = planKeep(splitGroup(), 'b');
    expect(change).toEqual({
      picks: [{ setId: 'a', from: 'want-to-see', to: null }],
      notes: [],
      message: 'Kept B. A is off your picks.',
    });
  });

  it('removes every other pick of a 3-pick group', () => {
    const g = group([makeSet('a', '20:00', '21:00'), makeSet('b', '20:30', '21:30'), makeSet('c', '21:15', '22:00')], {
      a: 'maybe',
      b: 'must',
      c: 'maybe',
    });
    const change = planKeep(g, 'b');
    expect(change.picks.map((p) => p.setId)).toEqual(['a', 'c']);
    expect(change.picks.every((p) => p.to === null)).toBe(true);
    expect(change.message).toBe('Kept B. 2 sets are off your picks.');
  });
});

describe('planSplit', () => {
  it('writes the plan into an empty note', () => {
    const change = planSplit(splitGroup(), undefined, CTX);
    expect(change).toEqual({
      picks: [],
      notes: [{ setId: 'a', from: undefined, to: SPLIT_PLAN_PREFIX + SPLIT_SENTENCE }],
      message: 'Split plan saved in your note on A.',
    });
  });

  it('appends the plan on a new line to an existing note', () => {
    const change = planSplit(splitGroup(), { a: 'Bring earplugs' }, CTX) as ClashChange;
    expect(change.notes[0]!.to).toBe(`Bring earplugs\n${SPLIT_PLAN_PREFIX}${SPLIT_SENTENCE}`);
  });

  it('refuses when the note would get too long', () => {
    expect(planSplit(splitGroup(), { a: 'x'.repeat(990) }, CTX)).toEqual({
      error: 'Your note on A is full. Shorten it, then try Split again.',
    });
    expect(990 + 1 + SPLIT_PLAN_PREFIX.length + SPLIT_SENTENCE.length).toBeGreaterThan(NOTE_MAX_LENGTH);
  });

  it('refuses when the sets cannot be split', () => {
    const g = group([makeSet('a', '21:00', '23:00'), makeSet('b', '21:30', '22:30', 'main')], {
      a: 'maybe',
      b: 'must',
    });
    expect(planSplit(g, undefined, CTX)).toEqual({ error: 'These sets cannot be split.' });
  });
});

describe('findSplitPlanLine and planClearSplit', () => {
  const line = SPLIT_PLAN_PREFIX + SPLIT_SENTENCE;
  const notes = { a: `Bring earplugs\n${line}\nMeet Sam after` };

  it('finds the plan line in the note of the set you leave', () => {
    expect(findSplitPlanLine(splitGroup(), notes)).toBe(line);
    expect(findSplitPlanLine(splitGroup(), { a: 'Bring earplugs' })).toBeNull();
    expect(findSplitPlanLine(splitGroup(), undefined)).toBeNull();
  });

  it('removes only the plan line', () => {
    expect(planClearSplit(splitGroup(), notes)).toEqual({
      picks: [],
      notes: [{ setId: 'a', from: notes.a, to: 'Bring earplugs\nMeet Sam after' }],
      message: 'Split plan removed.',
    });
    expect(planClearSplit(splitGroup(), { a: 'Bring earplugs' })).toBeNull();
  });
});

describe('invertChange', () => {
  it('swaps every write and inverts back to the original', () => {
    const keep = planKeep(splitGroup(), 'b');
    expect(invertChange(keep).picks).toEqual([{ setId: 'a', from: null, to: 'want-to-see' }]);
    expect(invertChange(invertChange(keep))).toEqual(keep);

    const split = planSplit(splitGroup(), undefined, CTX) as ClashChange;
    expect(invertChange(split).notes).toEqual([
      { setId: 'a', from: SPLIT_PLAN_PREFIX + SPLIT_SENTENCE, to: undefined },
    ]);
    expect(invertChange(invertChange(split))).toEqual(split);
  });
});
