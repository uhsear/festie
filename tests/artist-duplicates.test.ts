import assert from 'node:assert/strict';
import { test } from 'node:test';
import { possibleDuplicateIds } from '../lib/artist-duplicates';

const rows = (...keys: string[]) => keys.map((name_key, i) => ({ id: `a${i}`, name_key }));

test('two artists with the same key are possible duplicates', () => {
  assert.deepEqual([...possibleDuplicateIds(rows('hol', 'hol', 'other act'))].sort(), ['a0', 'a1']);
});

test('keys one character apart are possible duplicates: substitution, insertion and deletion', () => {
  assert.deepEqual([...possibleDuplicateIds(rows('sumthin sumthin', 'sumthin sumthim'))].sort(), ['a0', 'a1']);
  assert.deepEqual([...possibleDuplicateIds(rows('quartz harbor', 'quartz harbour'))].sort(), ['a0', 'a1']);
  assert.deepEqual([...possibleDuplicateIds(rows('quartz harbour', 'quartz harbor', 'unrelated name'))].sort(), ['a0', 'a1']);
});

test('keys two characters apart, and short keys one apart, are not', () => {
  assert.equal(possibleDuplicateIds(rows('quartz harbor', 'quartz harboury')).size, 0);
  assert.equal(possibleDuplicateIds(rows('abcd', 'abce')).size, 0);
  assert.equal(possibleDuplicateIds(rows('zedd', 'zed')).size, 0);
});

test('one artist alone is never a duplicate, and an empty list is empty', () => {
  assert.equal(possibleDuplicateIds(rows('only one')).size, 0);
  assert.equal(possibleDuplicateIds([]).size, 0);
});
