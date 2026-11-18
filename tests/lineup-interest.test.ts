// planInterestConversion is the pure core of server conversion (lib/lineup.ts): which marks become
// converted, which picks are added, when a converted mark reopens and when a profile is full.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { planInterestConversion, type LineupCover } from '../lib/lineup';

const NOW = '2027-01-05T12:00:00.000Z';
const cover = (state: LineupCover['state'], setIds: string[] = []): LineupCover => ({ setIds, state, dayIndex: 0 });

const plan = (input: Partial<Parameters<typeof planInterestConversion>[0]>) =>
  planInterestConversion({
    marks: {},
    picks: {},
    cover: {},
    existingSetIds: new Set<string>(),
    maxPicks: 500,
    now: NOW,
    ...input,
  });

describe('planInterestConversion', () => {
  test('an open mark on a covered act becomes converted with want-to-see picks on every covering set', () => {
    const result = plan({
      marks: { a: { state: 'open' } },
      cover: { a: cover('scheduled', ['s1', 's2']) },
      existingSetIds: new Set(['s1', 's2']),
    });
    assert.deepEqual(result.added, { s1: 'want-to-see', s2: 'want-to-see' });
    assert.deepEqual(result.marks.a, { state: 'converted', sets: ['s1', 's2'], added: ['s1', 's2'], at: NOW });
    assert.equal(result.changed, true);
  });

  test('a mark lists as `added` only the picks conversion made, not ones the profile already had', () => {
    const result = plan({
      marks: { a: { state: 'open' } },
      picks: { s1: 'want-to-see' },
      cover: { a: cover('scheduled', ['s1', 's2']) },
      existingSetIds: new Set(['s1', 's2']),
    });
    assert.deepEqual(result.marks.a, { state: 'converted', sets: ['s1', 's2'], added: ['s2'], at: NOW });
  });

  test('an act with no set, or a cancelled one, stays open and changes nothing', () => {
    const result = plan({
      marks: { a: { state: 'open' }, b: { state: 'open' } },
      cover: { a: cover('announced'), b: cover('cancelled', ['s9']) },
      existingSetIds: new Set(['s9']),
    });
    assert.equal(result.changed, false);
    assert.deepEqual(result.added, {});
    assert.deepEqual(result.marks.a, { state: 'open' });
    assert.deepEqual(result.marks.b, { state: 'open' });
  });

  test('a pick the profile already has stays as it is and is not added again', () => {
    const result = plan({
      marks: { a: { state: 'open' } },
      picks: { s1: 'must' },
      cover: { a: cover('scheduled', ['s1', 's2']) },
      existingSetIds: new Set(['s1', 's2']),
    });
    assert.deepEqual(result.added, { s2: 'want-to-see' });
    assert.deepEqual(result.marks.a?.sets, ['s1', 's2']);
  });

  test('a second run changes nothing', () => {
    const first = plan({
      marks: { a: { state: 'open' } },
      cover: { a: cover('scheduled', ['s1']) },
      existingSetIds: new Set(['s1']),
    });
    const second = plan({
      marks: first.marks,
      picks: first.added,
      cover: { a: cover('scheduled', ['s1']) },
      existingSetIds: new Set(['s1']),
    });
    assert.equal(second.changed, false);
    assert.deepEqual(second.added, {});
  });

  test('a converted mark stays converted while any of its sets exists, even with no pick left', () => {
    const result = plan({
      marks: { a: { state: 'converted', sets: ['s1', 's2'], at: NOW } },
      picks: {},
      cover: { a: cover('scheduled', ['s1', 's2']) },
      existingSetIds: new Set(['s2']),
    });
    assert.equal(result.changed, false);
    assert.deepEqual(result.added, {});
  });

  test('a converted mark reopens when none of its sets exists, then converts onto the new set', () => {
    const result = plan({
      marks: { a: { state: 'converted', sets: ['old'], at: '2027-01-01T00:00:00.000Z' } },
      cover: { a: cover('scheduled', ['new']) },
      existingSetIds: new Set(['new']),
    });
    assert.deepEqual(result.added, { new: 'want-to-see' });
    assert.deepEqual(result.marks.a, { state: 'converted', sets: ['new'], added: ['new'], at: NOW });
  });

  test('a converted mark whose sets are gone and that nothing covers goes back to open', () => {
    const result = plan({
      marks: { a: { state: 'converted', sets: ['old'], at: NOW } },
      cover: { a: cover('announced') },
    });
    assert.deepEqual(result.marks.a, { state: 'open' });
    assert.equal(result.changed, true);
  });

  test('conversion stops at maxPicks: the act that does not fit stays open', () => {
    const result = plan({
      marks: { a: { state: 'open' }, b: { state: 'open' } },
      picks: { x: 'must' },
      cover: { a: cover('scheduled', ['s1']), b: cover('scheduled', ['s2', 's3']) },
      existingSetIds: new Set(['s1', 's2', 's3']),
      maxPicks: 3,
    });
    assert.deepEqual(result.added, { s1: 'want-to-see' });
    assert.equal(result.marks.a?.state, 'converted');
    assert.deepEqual(result.marks.b, { state: 'open' });
  });

  test('a mark on an entry that left the lineup is kept as it is', () => {
    const result = plan({ marks: { gone: { state: 'open' } }, cover: {} });
    assert.equal(result.changed, false);
    assert.deepEqual(result.marks.gone, { state: 'open' });
  });

  test('at most ten covering sets are picked and recorded', () => {
    const ids = Array.from({ length: 12 }, (_, i) => `s${i}`);
    const result = plan({
      marks: { a: { state: 'open' } },
      cover: { a: cover('scheduled', ids) },
      existingSetIds: new Set(ids),
    });
    assert.equal(Object.keys(result.added).length, 10);
    assert.equal(result.marks.a?.sets?.length, 10);
  });
});
