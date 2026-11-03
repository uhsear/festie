/**
 * overlappingClashes (lib/helpers/pick-clashes.ts). Pure function: no database.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { overlappingClashes } from '../lib/helpers/pick-clashes';

const set = (id: string, startTime: string | null, endTime: string | null) => ({ id, startTime, endTime });
const festival = {
  days: [
    {
      sets: [
        set('a', '10:00', '11:00'),
        set('b', '10:30', '11:30'),
        set('c', '11:00', '12:00'),
        set('late', '23:00', '01:00'),
        set('later', '00:30', '02:00'),
        set('tba', null, null),
        set('bad', '25:00', '26:00'),
        set('same', '10:00', '10:45'),
      ],
    },
  ],
};

describe('overlappingClashes', () => {
  test('keeps overlapping pairs and drops ones that do not overlap', () => {
    const out = overlappingClashes(festival, [
      { aId: 'a', bId: 'b', people: 5 },
      { aId: 'a', bId: 'late', people: 9 },
    ]);
    assert.deepEqual(out, [{ aSetId: 'a', bSetId: 'b', people: 5 }]);
  });

  test('back-to-back sets do not overlap', () => {
    assert.deepEqual(overlappingClashes(festival, [{ aId: 'a', bId: 'c', people: 6 }]), []);
  });

  test('past-midnight sets on one day clash, with the 23:00 set first', () => {
    assert.deepEqual(overlappingClashes(festival, [{ aId: 'later', bId: 'late', people: 5 }]), [
      { aSetId: 'late', bSetId: 'later', people: 5 },
    ]);
  });

  test('TBA, invalid times and unknown ids are never in a clash', () => {
    const out = overlappingClashes(festival, [
      { aId: 'a', bId: 'tba', people: 5 },
      { aId: 'a', bId: 'bad', people: 5 },
      { aId: 'a', bId: 'missing', people: 5 },
    ]);
    assert.deepEqual(out, []);
  });

  test('orders each pair by start, then by lower id on equal starts', () => {
    const out = overlappingClashes(festival, [
      { aId: 'b', bId: 'a', people: 5 },
      { aId: 'same', bId: 'a', people: 6 },
    ]);
    assert.deepEqual(out, [
      { aSetId: 'a', bSetId: 'same', people: 6 },
      { aSetId: 'a', bSetId: 'b', people: 5 },
    ]);
  });

  test('sorts by people, then the later start, then aSetId, and applies the limit', () => {
    const candidates = [
      { aId: 'late', bId: 'later', people: 5 },
      { aId: 'a', bId: 'b', people: 5 },
      { aId: 'b', bId: 'c', people: 7 },
      { aId: 'a', bId: 'same', people: 5 },
    ];
    assert.deepEqual(overlappingClashes(festival, candidates), [
      { aSetId: 'b', bSetId: 'c', people: 7 },
      { aSetId: 'a', bSetId: 'same', people: 5 },
      { aSetId: 'a', bSetId: 'b', people: 5 },
      { aSetId: 'late', bSetId: 'later', people: 5 },
    ]);
    assert.equal(overlappingClashes(festival, candidates, 2).length, 2);
  });
});
