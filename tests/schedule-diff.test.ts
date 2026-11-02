import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildSchedulePushes, diffPickedSchedule } from '../lib/schedule-diff';

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
      [moved('a', 'A'), moved('b', 'B')],
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
      ids.map((id) => moved(id, id.toUpperCase())),
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
