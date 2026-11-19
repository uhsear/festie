import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { planPickerAlerts } from '../lib/picker-alerts';

const fest = (sets: any[], date = '2026-05-01') => ({
  id: 'f1',
  stages: [{ id: 's1', name: 'Main' }],
  days: [{ date, label: 'Fri', sets }],
});
const set = (over: any = {}) => ({ id: 'a', artist: 'A', stageId: 's1', startTime: null, endTime: null, ...over });

function makeStores(released: string[], calls: any = {}) {
  return {
    timeReleases: {
      releasedDates: async (id: string) => {
        calls.released = id;
        return new Set(released);
      },
    },
    profiles: {
      pickersBySet: async (id: string, ids: string[]) => {
        calls.pickers = { id, ids };
        return new Map(ids.map((s) => [s, ['u1']]));
      },
    },
  };
}

describe('planPickerAlerts', () => {
  it('returns nothing and skips the picker lookup when nothing changed', async () => {
    const calls: any = {};
    const f = fest([set({ startTime: '20:00' })]);
    const out = await planPickerAlerts({ stores: makeStores([], calls), before: f, after: f });
    assert.deepEqual(out.changes, []);
    assert.equal(out.pickersBySet.size, 0);
    assert.equal(calls.pickers, undefined);
  });

  it('keeps a first time on a released date', async () => {
    const calls: any = {};
    const out = await planPickerAlerts({
      stores: makeStores(['2026-05-01'], calls),
      before: fest([set()]),
      after: fest([set({ startTime: '20:00' })]),
    });
    assert.equal(out.changes.length, 1);
    assert.deepEqual(out.pickersBySet.get('a'), ['u1']);
    assert.equal(calls.released, 'f1');
    assert.deepEqual(calls.pickers, { id: 'f1', ids: ['a'] });
  });

  it('drops a first time on a date with no release row', async () => {
    const calls: any = {};
    const out = await planPickerAlerts({
      stores: makeStores(['2026-05-02'], calls),
      before: fest([set()]),
      after: fest([set({ startTime: '20:00' })]),
    });
    assert.deepEqual(out.changes, []);
    assert.equal(calls.pickers, undefined);
  });

  it('always alerts a move, without reading releases', async () => {
    const calls: any = {};
    const out = await planPickerAlerts({
      stores: makeStores([], calls),
      before: fest([set({ startTime: '20:00' })]),
      after: fest([set({ startTime: '21:00' })]),
    });
    assert.equal(out.changes.length, 1);
    assert.equal(out.changes[0]?.kind, 'moved');
    assert.equal(calls.released, undefined);
  });

  it('always alerts a removal', async () => {
    const out = await planPickerAlerts({
      stores: makeStores([]),
      before: fest([set({ startTime: '20:00' })]),
      after: fest([]),
    });
    assert.equal(out.changes[0]?.kind, 'removed');
    assert.deepEqual(out.pickersBySet.get('a'), ['u1']);
  });

  it('tbaOnly silences moves and removals but keeps a released first time', async () => {
    const before = fest([set({ id: 'a' }), set({ id: 'b', startTime: '20:00' }), set({ id: 'c', startTime: '20:00' })]);
    const after = fest([set({ id: 'a', startTime: '19:00' }), set({ id: 'b', startTime: '22:00' })]);
    const out = await planPickerAlerts({
      stores: makeStores(['2026-05-01']),
      before,
      after,
      tbaOnly: true,
    });
    assert.deepEqual(out.changes.map((c) => c.setId), ['a']);
  });

  it('drops a first time whose set sits on a day with no date', async () => {
    const mk = (startTime: string | null) => ({
      id: 'f1',
      stages: [],
      days: [{ label: 'Fri', sets: [set({ stageId: null, startTime })] }],
    });
    const out = await planPickerAlerts({ stores: makeStores(['2026-05-01']), before: mk(null), after: mk('20:00') });
    assert.deepEqual(out.changes, []);
  });
});
