import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  SET_MOVE_WINDOW_MS,
  dayKeyOf,
  dayKeysOf,
  isFreshMove,
  nextMoveMark,
  planMoveMarks,
  withFreshMoves,
  type SlotAt,
} from '../lib/set-moves';

const NOW = new Date('2026-11-02T12:00:00Z');
const HOUR = 60 * 60 * 1000;
const ago = (ms: number) => new Date(NOW.getTime() - ms);

const slot = (over: Partial<SlotAt> = {}): SlotAt => ({
  dayKey: '2026-04-11',
  dayIndex: 1,
  stageId: 'sahara',
  start: '22:00',
  end: '23:00',
  ...over,
});
const from = (over: Partial<SlotAt> = {}) => {
  const { dayKey: _k, ...rest } = slot(over);
  return rest;
};

describe('nextMoveMark', () => {
  it('rule 2: same slot keeps a fresh prior and drops a stale one', () => {
    const fresh = { movedAt: ago(HOUR), movedFrom: from({ start: '21:00' }) };
    assert.equal(nextMoveMark(fresh, slot(), slot(), NOW), fresh);
    const stale = { movedAt: ago(49 * HOUR), movedFrom: from({ start: '21:00' }) };
    assert.equal(nextMoveMark(stale, slot(), slot(), NOW), null);
    assert.equal(nextMoveMark(null, slot(), slot(), NOW), null);
  });

  it('rule 3: TBA to a time on the same day and stage is not a move', () => {
    assert.equal(nextMoveMark(null, slot({ start: null, end: null }), slot(), NOW), null);
    const fresh = { movedAt: ago(HOUR), movedFrom: from({ start: '20:00' }) };
    assert.equal(nextMoveMark(fresh, slot({ start: null, end: null }), slot(), NOW), fresh);
  });

  it('TBA to a time on another stage is a move', () => {
    const mark = nextMoveMark(null, slot({ start: null, end: null }), slot({ stageId: 'mojave' }), NOW);
    assert.deepEqual(mark, { movedAt: NOW, movedFrom: from({ start: null, end: null }) });
  });

  it('time to TBA is a move', () => {
    const mark = nextMoveMark(null, slot(), slot({ start: null, end: null }), NOW);
    assert.deepEqual(mark, { movedAt: NOW, movedFrom: from() });
  });

  it('rule 4: moving back to the first slot clears a fresh mark', () => {
    const fresh = { movedAt: ago(HOUR), movedFrom: from() };
    assert.equal(nextMoveMark(fresh, slot({ start: '22:30', end: '23:30' }), slot(), NOW), null);
  });

  it('rule 5: a burst of fixes keeps the first slot', () => {
    const first = nextMoveMark(null, slot(), slot({ start: '22:30', end: '23:30' }), NOW)!;
    const second = nextMoveMark(
      first,
      slot({ start: '22:30', end: '23:30' }),
      slot({ start: '23:00', end: '00:00' }),
      NOW,
    )!;
    const third = nextMoveMark(
      second,
      slot({ start: '23:00', end: '00:00' }),
      slot({ start: '23:30', end: '00:30' }),
      NOW,
    )!;
    assert.equal(third.movedFrom.start, '22:00');
    assert.equal(third.movedAt, NOW);
  });

  it('rule 6: a first move records the old slot; a stale prior is replaced', () => {
    assert.deepEqual(nextMoveMark(null, slot(), slot({ stageId: 'mojave' }), NOW), {
      movedAt: NOW,
      movedFrom: from(),
    });
    const stale = { movedAt: ago(49 * HOUR), movedFrom: from({ start: '18:00' }) };
    const mark = nextMoveMark(stale, slot(), slot({ start: '22:30' }), NOW)!;
    assert.equal(mark.movedFrom.start, '22:00');
  });

  it('past midnight: 23:30 to 00:30 on the same day is a move', () => {
    const mark = nextMoveMark(
      null,
      slot({ start: '23:30', end: '00:30' }),
      slot({ start: '00:30', end: '01:30' }),
      NOW,
    )!;
    assert.equal(mark.movedFrom.start, '23:30');
  });

  it("normalises '' to null on both sides", () => {
    assert.equal(nextMoveMark(null, slot({ stageId: '', end: '' }), slot({ stageId: null, end: null }), NOW), null);
    assert.equal(nextMoveMark(null, slot({ start: '', end: '' }), slot(), NOW), null);
    const mark = nextMoveMark(null, slot({ end: '' }), slot({ start: '22:30', end: null }), NOW)!;
    assert.equal(mark.movedFrom.end, null);
  });
});

describe('dayKeyOf / dayKeysOf', () => {
  it('prefers date, then label, then position', () => {
    assert.equal(dayKeyOf({ date: '2026-04-11', label: 'Sat' }, 1), '2026-04-11');
    assert.equal(dayKeyOf({ date: '', label: 'Sat' }, 1), 'Sat');
    assert.equal(dayKeyOf({ date: null, label: null }, 1), '#1');
    assert.equal(dayKeyOf({}, 3), '#3');
  });

  it('falls back to positions for the whole layout on a key collision', () => {
    const keys = dayKeysOf([
      { dayIndex: 0, label: 'Day', date: '' },
      { dayIndex: 1, label: 'Day', date: '' },
      { dayIndex: 2, label: 'Sun', date: '' },
    ]);
    assert.deepEqual([...keys.values()], ['#0', '#1', '#2']);
  });
});

describe('planMoveMarks', () => {
  const days = [
    { dayIndex: 0, label: 'Fri', date: '2026-04-10' },
    { dayIndex: 1, label: 'Sat', date: '2026-04-11' },
  ];
  const set = { id: 's1', dayIndex: 1, stageId: 'sahara', start: '22:00', end: '23:00' };

  it('marks a moved set and leaves the others alone', () => {
    const other = { id: 's2', dayIndex: 0, stageId: 'sahara', start: '20:00', end: '21:00' };
    const marks = planMoveMarks(days, [set, other], days, [{ ...set, start: '22:30' }, other], NOW);
    assert.deepEqual(marks, [
      { id: 's1', movedAt: NOW, movedFrom: { dayIndex: 1, stageId: 'sahara', start: '22:00', end: '23:00' } },
    ]);
  });

  it('a day move records the old day index', () => {
    const marks = planMoveMarks(days, [set], days, [{ ...set, dayIndex: 0 }], NOW);
    assert.equal(marks[0]!.movedFrom.dayIndex, 1);
  });

  it('new sets get no mark', () => {
    assert.deepEqual(planMoveMarks(days, [], days, [set], NOW), []);
  });

  it('inserting a new first day marks nothing and shifts an existing mark', () => {
    const marked = {
      ...set,
      start: '22:30',
      movedAt: ago(HOUR),
      movedFrom: { dayIndex: 1, stageId: 'sahara', start: '22:00', end: '23:00' },
    };
    const newDays = [
      { dayIndex: 0, label: 'Thu', date: '2026-04-09' },
      ...days.map((d) => ({ ...d, dayIndex: d.dayIndex + 1 })),
    ];
    const quiet = { id: 's2', dayIndex: 0, stageId: 'sahara', start: '20:00', end: '21:00' };
    const marks = planMoveMarks(
      days,
      [marked, quiet],
      newDays,
      [
        { ...marked, dayIndex: 2 },
        { ...quiet, dayIndex: 1 },
      ],
      NOW,
    );
    assert.equal(marks.length, 1);
    assert.equal(marks[0]!.id, 's1');
    assert.equal(marks[0]!.movedFrom.dayIndex, 2);
    assert.deepEqual(marks[0]!.movedAt, marked.movedAt);
  });

  it('a later save that does not touch a marked set keeps its mark', () => {
    const marked = {
      ...set,
      start: '22:30',
      movedAt: ago(HOUR).toISOString(),
      movedFrom: { dayIndex: 1, stageId: 'sahara', start: '22:00', end: '23:00' },
    };
    const marks = planMoveMarks(days, [marked], days, [{ ...set, start: '22:30' }], NOW);
    assert.equal(marks.length, 1);
    assert.equal(marks[0]!.movedFrom.start, '22:00');
  });

  it('a stale mark is cleared by a save that keeps the set in place', () => {
    const marked = {
      ...set,
      movedAt: ago(49 * HOUR),
      movedFrom: { dayIndex: 1, stageId: 'sahara', start: '21:00', end: '22:00' },
    };
    assert.deepEqual(planMoveMarks(days, [marked], days, [set], NOW), []);
  });

  it('a removed old day maps to -1 and drops a prior whose movedFrom day is gone', () => {
    const moved = planMoveMarks(days, [set], [days[0]!], [{ ...set, dayIndex: 0, start: '21:00' }], NOW);
    assert.equal(moved[0]!.movedFrom.dayIndex, -1);
    assert.deepEqual(planMoveMarks(days, [set], [days[0]!], [{ ...set, dayIndex: 0 }], NOW), []);
    const marked = {
      ...set,
      dayIndex: 0,
      movedAt: ago(HOUR),
      movedFrom: { dayIndex: 1, stageId: 'sahara', start: '21:00', end: '22:00' },
    };
    const marks = planMoveMarks(days, [marked], [days[0]!], [{ ...marked, start: '23:00' }], NOW);
    assert.deepEqual(marks[0]!.movedFrom, { dayIndex: 0, stageId: 'sahara', start: '22:00', end: '23:00' });
  });

  it('relabelling a dateless day in place marks nothing', () => {
    const before = [{ dayIndex: 0, label: 'Day 1', date: '' }];
    const after = [{ dayIndex: 0, label: 'Friday', date: '' }];
    const quiet = { id: 's1', dayIndex: 0, stageId: 'sahara', start: '20:00', end: '21:00' };
    assert.deepEqual(planMoveMarks(before, [quiet], after, [quiet], NOW), []);
    const moved = planMoveMarks(before, [quiet], after, [{ ...quiet, start: '20:30' }], NOW);
    assert.deepEqual(moved[0]!.movedFrom, { dayIndex: -1, stageId: 'sahara', start: '20:00', end: '21:00' });
  });

  it('fixing a duplicated date marks nothing on either day', () => {
    const before = [
      { dayIndex: 0, label: 'Fri', date: '2026-04-10' },
      { dayIndex: 1, label: 'Sat', date: '2026-04-10' },
    ];
    const after = [before[0]!, { ...before[1]!, date: '2026-04-11' }];
    const a = { id: 's1', dayIndex: 0, stageId: 'sahara', start: '20:00', end: '21:00' };
    const b = { id: 's2', dayIndex: 1, stageId: 'sahara', start: '22:00', end: '23:00' };
    assert.deepEqual(planMoveMarks(before, [a, b], after, [a, b], NOW), []);
  });

  it('inserting a day into a collided layout marks nothing and drops positional priors', () => {
    const before = [
      { dayIndex: 0, label: 'Friday', date: '' },
      { dayIndex: 1, label: 'Friday', date: '' },
    ];
    const after = [
      { dayIndex: 0, label: 'Thursday', date: '' },
      ...before.map((d) => ({ ...d, dayIndex: d.dayIndex + 1 })),
    ];
    const quiet = { id: 's1', dayIndex: 0, stageId: 'sahara', start: '20:00', end: '21:00' };
    const marked = {
      id: 's2',
      dayIndex: 1,
      stageId: 'sahara',
      start: '22:30',
      end: '23:00',
      movedAt: ago(HOUR),
      movedFrom: { dayIndex: 0, stageId: 'sahara', start: '22:00', end: '23:00' },
    };
    assert.deepEqual(
      planMoveMarks(
        before,
        [quiet, marked],
        after,
        [
          { ...quiet, dayIndex: 1 },
          { ...marked, dayIndex: 2 },
        ],
        NOW,
      ),
      [],
    );
  });
});

describe('isFreshMove', () => {
  const nowMs = NOW.getTime();
  it('rejects a bad or missing date', () => {
    assert.equal(isFreshMove('not a date', nowMs), false);
    assert.equal(isFreshMove(null, nowMs), false);
    assert.equal(isFreshMove(undefined, nowMs), false);
    assert.equal(isFreshMove(12345, nowMs), false);
  });
  it('is fresh at 47 h and stale at 48 h', () => {
    assert.equal(isFreshMove(ago(47 * HOUR).toISOString(), nowMs), true);
    assert.equal(isFreshMove(ago(SET_MOVE_WINDOW_MS).toISOString(), nowMs), false);
    assert.equal(isFreshMove(ago(47 * HOUR), nowMs), true);
  });
  it('counts a future date as fresh', () => {
    assert.equal(isFreshMove(new Date(nowMs + HOUR).toISOString(), nowMs), true);
  });
});

describe('withFreshMoves', () => {
  const nowMs = NOW.getTime();
  const movedFrom = { dayIndex: 0, stageId: 'sahara', start: '22:00', end: '23:00' };
  const fresh = { id: 'a', movedAt: ago(HOUR).toISOString(), movedFrom };
  const stale = { id: 'b', movedAt: ago(49 * HOUR).toISOString(), movedFrom };
  const plain = { id: 'c' };

  it('removes stale marks, keeps fresh ones, and does not mutate the input', () => {
    const festival = {
      id: 'f',
      days: [
        { label: 'Sat', sets: [fresh, stale] },
        { label: 'Sun', sets: [plain] },
      ],
    };
    const snapshot = structuredClone(festival);
    const out = withFreshMoves(festival, nowMs);
    assert.notEqual(out, festival);
    assert.deepEqual(out.days[0]!.sets, [fresh, { id: 'b' }]);
    assert.equal(out.days[1], festival.days[1]);
    assert.deepEqual(festival, snapshot);
  });

  it('returns the same object when nothing is stale', () => {
    const festival = { id: 'f', days: [{ sets: [fresh, plain] }] };
    assert.equal(withFreshMoves(festival, nowMs), festival);
    const noDays = { id: 'f' };
    assert.equal(withFreshMoves(noDays, nowMs), noDays);
  });
});
