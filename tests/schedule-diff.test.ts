import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildSchedulePushes, diffPickedSchedule, formatShiftDelta, isTbaToTime } from '../lib/schedule-diff';

function festival(sets: any[], extraDay: any[] = []) {
  return {
    id: 'fest-1',
    name: 'Coachella',
    stages: [
      { id: 'sahara', name: 'Sahara' },
      { id: 'mojave', name: 'Mojave' },
    ],
    days: [
      { label: 'Fri', sets: [] },
      { label: 'Sat', sets },
      { label: 'Sun', sets: extraDay },
    ],
  };
}

const peggy = { id: 'set-1', artist: 'Peggy Gou', stageId: 'sahara', startTime: '22:00', endTime: '23:00' };
const fred = { id: 'set-2', artist: 'Fred again..', stageId: 'mojave', startTime: '20:00', endTime: '21:00' };

describe('diffPickedSchedule', () => {
  it('reports a set moved by time', () => {
    const changes = diffPickedSchedule(festival([peggy]), festival([{ ...peggy, startTime: '23:30', endTime: '00:30' }]));
    assert.equal(changes.length, 1);
    assert.equal(changes[0]!.kind, 'moved');
    assert.equal(changes[0]!.setId, 'set-1');
  });

  it('reports a set moved by stage', () => {
    const changes = diffPickedSchedule(festival([peggy]), festival([{ ...peggy, stageId: 'mojave' }]));
    assert.equal(changes.length, 1);
    const change = changes[0] as any;
    assert.equal(change.before.stageName, 'Sahara');
    assert.equal(change.after.stageName, 'Mojave');
  });

  it('reports a set moved by day', () => {
    const changes = diffPickedSchedule(festival([peggy]), festival([], [peggy]));
    assert.equal(changes.length, 1);
    const change = changes[0] as any;
    assert.equal(change.before.dayLabel, 'Sat');
    assert.equal(change.after.dayLabel, 'Sun');
  });

  it('reports a removed set', () => {
    const changes = diffPickedSchedule(festival([peggy, fred]), festival([fred]));
    assert.deepEqual(changes, [{ kind: 'removed', setId: 'set-1', artist: 'Peggy Gou' }]);
  });

  it('ignores a rename', () => {
    assert.deepEqual(diffPickedSchedule(festival([peggy]), festival([{ ...peggy, artist: 'Peggy Gou (DJ)' }])), []);
  });

  it('ignores a new set', () => {
    assert.deepEqual(diffPickedSchedule(festival([peggy]), festival([peggy, fred])), []);
  });

  it('ignores a day inserted in front of the others', () => {
    const before = festival([peggy]);
    const after = { ...before, days: [{ label: 'Thu', sets: [] }, ...before.days] };
    assert.deepEqual(diffPickedSchedule(before, after), []);
  });

  it('ignores a dated day inserted in front, even with no labels', () => {
    const days = (extra: any[]) => [...extra, { date: '2026-04-10', sets: [] }, { date: '2026-04-11', sets: [peggy] }];
    const before = { ...festival([peggy]), days: days([]) };
    const after = { ...before, days: days([{ date: '2026-04-09', sets: [] }]) };
    assert.deepEqual(diffPickedSchedule(before, after), []);
  });

  it('ignores a map change and a link change', () => {
    const after = { ...festival([{ ...peggy, linkUrl: 'https://open.spotify.com/x' }]), mapConfig: { imageUrl: 'x' } };
    assert.deepEqual(diffPickedSchedule(festival([peggy]), after), []);
  });
});

describe('buildSchedulePushes', () => {
  const slot = (startTime: string | null, stageName: string | null = 'Sahara', dayLabel = 'Sat') => ({
    dayLabel,
    startTime,
    endTime: null,
    stageName,
  });
  const moved = (setId: string, artist: string) => ({
    kind: 'moved' as const,
    setId,
    artist,
    before: slot('22:00'),
    after: slot('23:30'),
  });
  // A stage move, so a list of these with `moved` is never a bulk time shift.
  const restaged = (setId: string, artist: string) => ({
    kind: 'moved' as const,
    setId,
    artist,
    before: slot('22:00'),
    after: slot('22:00', 'Mojave'),
  });

  it('writes the one-set-moved copy with a set link', () => {
    const pushes = buildSchedulePushes('Coachella', [moved('set-1', 'Peggy Gou')], new Map([['set-1', ['u1']]]));
    assert.deepEqual(pushes, [
      {
        userId: 'u1',
        title: 'Peggy Gou moved',
        body: 'Now Sat 11:30 PM at Sahara. Was Sat 10:00 PM at Sahara.',
        setId: 'set-1',
      },
    ]);
  });

  it('writes the removed copy with no set link', () => {
    const pushes = buildSchedulePushes(
      'Coachella',
      [{ kind: 'removed', setId: 'set-1', artist: 'Peggy Gou' }],
      new Map([['set-1', ['u1']]]),
    );
    assert.equal(pushes[0]!.title, 'Peggy Gou is off the lineup');
    assert.equal(pushes[0]!.body, 'Coachella removed this set, so it is no longer in your picks.');
    assert.equal(pushes[0]!.setId, undefined);
  });

  it('writes the two-change copy', () => {
    const pushes = buildSchedulePushes(
      'Coachella',
      [moved('a', 'A'), restaged('b', 'B')],
      new Map([
        ['a', ['u1']],
        ['b', ['u1']],
      ]),
    );
    assert.equal(pushes.length, 1);
    assert.equal(pushes[0]!.title, '2 of your picks changed');
    assert.equal(pushes[0]!.body, 'Coachella: A and B. Tap to see the new times.');
    assert.equal(pushes[0]!.setId, undefined);
  });

  it('writes the several-changes copy for five changes', () => {
    const ids = ['a', 'b', 'c', 'd', 'e'];
    const pushes = buildSchedulePushes(
      'Coachella',
      ids.map((id) => (id === 'e' ? restaged : moved)(id, id.toUpperCase())),
      new Map(ids.map((id) => [id, ['u1']])),
    );
    assert.equal(pushes[0]!.title, '5 of your picks changed');
    assert.equal(pushes[0]!.body, 'Coachella: A, B and 3 more. Tap to see the new times.');
  });

  it('sends one message per picker and skips sets nobody picked', () => {
    const pushes = buildSchedulePushes(
      'Coachella',
      [moved('a', 'A'), moved('b', 'B')],
      new Map([['a', ['u1', 'u2', 'u2']]]),
    );
    assert.deepEqual(pushes.map((p) => p.userId).sort(), ['u1', 'u2']);
  });

  it('reads a missing time as time to be announced', () => {
    const change = { kind: 'moved' as const, setId: 'a', artist: 'A', before: slot('22:00'), after: slot(null, null) };
    const [push] = buildSchedulePushes('Coachella', [change], new Map([['a', ['u1']]]));
    assert.equal(push!.body, 'Now Sat time to be announced. Was Sat 10:00 PM at Sahara.');
  });

  it('shows the end time when only the end moved', () => {
    const change = {
      kind: 'moved' as const,
      setId: 'a',
      artist: 'A',
      before: { ...slot('22:00'), endTime: '23:00' },
      after: { ...slot('22:00'), endTime: '23:30' },
    };
    const [push] = buildSchedulePushes('Coachella', [change], new Map([['a', ['u1']]]));
    assert.equal(push!.body, 'Now Sat 10:00 PM to 11:30 PM at Sahara. Was Sat 10:00 PM to 11:00 PM at Sahara.');
  });

  it('keeps the body within 200 characters', () => {
    const long = 'X'.repeat(300);
    const [push] = buildSchedulePushes('Coachella', [moved('a', long), moved('b', long)], new Map([
      ['a', ['u1']],
      ['b', ['u1']],
    ]));
    assert.ok(push!.body.length <= 200);
  });
});

describe('buildSchedulePushes shift form', () => {
  const at = (startTime: string | null, endTime: string | null = null, stageName: string | null = 'Sahara', dayLabel = 'Sat') => ({
    dayLabel,
    startTime,
    endTime,
    stageName,
  });
  const change = (setId: string, before: any, after: any) => ({
    kind: 'moved' as const,
    setId,
    artist: setId.toUpperCase(),
    before,
    after,
  });
  const allTo = (userId: string, changes: any[]) => new Map(changes.map((c) => [c.setId, [userId]]));
  const titleOf = (changes: any[]) => buildSchedulePushes('Coachella', changes, allTo('u1', changes))[0]!.title;

  it('titles a bulk shift with the stage, count and delta, and keeps the multi-change body', () => {
    const changes = [
      change('a', at('20:00', '21:00'), at('20:30', '21:30')),
      change('b', at('21:00', '22:00'), at('21:30', '22:30')),
      change('c', at('22:00', '23:00'), at('22:30', '23:30')),
    ];
    const [push] = buildSchedulePushes('Coachella', changes, allTo('u1', changes));
    assert.equal(push!.title, 'Sahara: 3 of your picks moved +30 min');
    assert.equal(push!.body, 'Coachella: A, B and 1 more. Tap to see the new times.');
    assert.equal(push!.setId, undefined);
  });

  it('sends the shift only to the user who picked shifted sets', () => {
    // 20 sets, 30 minutes apart from 12:00, all shifted +30.
    const hhmm = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
    const changes = Array.from({ length: 20 }, (_, i) => change(`s${i}`, at(hhmm(720 + i * 30)), at(hhmm(750 + i * 30))));
    const pickers = new Map([
      ['s0', ['A']],
      ['s5', ['A']],
      ['s9', ['A']],
    ]);
    const pushes = buildSchedulePushes('Coachella', changes, pickers);
    assert.deepEqual(
      pushes.map((p) => [p.userId, p.title]),
      [['A', 'Sahara: 3 of your picks moved +30 min']],
    );
  });

  it('keeps the one-set copy with a set link for a single shifted set', () => {
    const changes = [change('a', at('20:00'), at('20:30'))];
    const [push] = buildSchedulePushes('Coachella', changes, allTo('u1', changes));
    assert.equal(push!.title, 'A moved');
    assert.equal(push!.setId, 'a');
  });

  it('counts a shift across midnight', () => {
    const changes = [change('a', at('23:45'), at('00:15')), change('b', at('22:00'), at('22:30'))];
    assert.equal(titleOf(changes), 'Sahara: 2 of your picks moved +30 min');
  });

  it('never reads a slot that crosses the 06:00 festival-day start as a shift', () => {
    const changes = [change('a', at('05:45'), at('06:15')), change('b', at('05:30'), at('06:00'))];
    assert.equal(titleOf(changes), '2 of your picks changed');
  });

  it('falls back to the changed form for mixed or partial shifts', () => {
    const base = change('a', at('20:00', '21:00'), at('20:30', '21:30'));
    const cases: [string, any][] = [
      ['mixed deltas', change('b', at('21:00'), at('21:15'))],
      ['two stages', change('b', at('21:00', null, 'Mojave'), at('21:30', null, 'Mojave'))],
      ['two days', change('b', at('21:00', null, 'Sahara', 'Sun'), at('21:30', null, 'Sahara', 'Sun'))],
      ['a day change', change('b', at('21:00'), at('21:30', null, 'Sahara', 'Sun'))],
      ['a stage change', change('b', at('21:00'), at('21:30', null, 'Mojave'))],
      ['a TBA', change('b', at(null), at('21:30'))],
      ['a set to TBA', change('b', at('21:00'), at(null))],
      ['no stage', change('b', at('21:00', null, null), at('21:30', null, null))],
      ['an end that moved differently', change('b', at('21:00', '22:00'), at('21:30', '22:00'))],
      ['an end-only move', change('b', at('21:00', '22:00'), at('21:00', '22:30'))],
      ['a removed set', { kind: 'removed', setId: 'b', artist: 'B' }],
    ];
    for (const [name, other] of cases) {
      assert.equal(titleOf([base, other]), '2 of your picks changed', name);
    }
  });

  it('accepts a shift up to 6 hours and rejects more', () => {
    const six = [change('a', at('12:00'), at('18:00')), change('b', at('13:00'), at('19:00'))];
    assert.equal(titleOf(six), 'Sahara: 2 of your picks moved +6 h');
    const more = [change('a', at('12:00'), at('18:15')), change('b', at('13:00'), at('19:15'))];
    assert.equal(titleOf(more), '2 of your picks changed');
  });

  it('reads a backward shift with a minus sign', () => {
    const changes = [change('a', at('22:00', '23:00'), at('21:45', '22:45')), change('b', at('23:00'), at('22:45'))];
    assert.equal(titleOf(changes), 'Sahara: 2 of your picks moved -15 min');
  });
});

describe('formatShiftDelta', () => {
  it('writes minutes, hours, and both', () => {
    assert.equal(formatShiftDelta(30), '+30 min');
    assert.equal(formatShiftDelta(-15), '-15 min');
    assert.equal(formatShiftDelta(60), '+1 h');
    assert.equal(formatShiftDelta(90), '+1 h 30 min');
    assert.equal(formatShiftDelta(-120), '-2 h');
    assert.equal(formatShiftDelta(-90), '-1 h 30 min');
  });
});

describe('isTbaToTime', () => {
  const tba = { ...peggy, startTime: null, endTime: null };
  const only = (before: any[], after: any[], afterExtra: any[] = []) =>
    diffPickedSchedule(festival(before), festival(after, afterExtra))[0]!;

  it('is true when a TBA set gets its first time on the same day and stage', () => {
    assert.equal(isTbaToTime(only([tba], [peggy])), true);
  });

  it('is false when a timed set changes time', () => {
    assert.equal(isTbaToTime(only([peggy], [{ ...peggy, startTime: '23:30', endTime: '00:30' }])), false);
  });

  it('is false when the stage changes too', () => {
    assert.equal(isTbaToTime(only([tba], [{ ...peggy, stageId: 'mojave' }])), false);
  });

  it('is false when the day changes too', () => {
    assert.equal(isTbaToTime(only([tba], [], [peggy])), false);
  });

  it('is false for a removed set', () => {
    assert.equal(isTbaToTime({ kind: 'removed', setId: 'set-1', artist: 'Peggy Gou' }), false);
  });
});
