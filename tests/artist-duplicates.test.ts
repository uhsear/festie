import assert from 'node:assert/strict';
import { test } from 'node:test';
import { duplicatePartners } from '../lib/artist-duplicates';

const rows = (...keys: string[]) => keys.map((name_key, i) => ({ id: `a${i}`, name_key }));
const ids = (...keys: string[]) => [...duplicatePartners(rows(...keys)).keys()].sort();

test('two artists with the same key are possible duplicates, each other\'s partner', () => {
  assert.deepEqual(ids('hol', 'hol', 'other act'), ['a0', 'a1']);
  assert.deepEqual(duplicatePartners(rows('hol', 'hol', 'other act')).get('a0'), ['a1']);
});

test('keys one character apart are possible duplicates: substitution, insertion and deletion', () => {
  assert.deepEqual(ids('sumthin sumthin', 'sumthin sumthim'), ['a0', 'a1']);
  assert.deepEqual(ids('quartz harbor', 'quartz harbour'), ['a0', 'a1']);
  assert.deepEqual(ids('quartz harbour', 'quartz harbor', 'unrelated name'), ['a0', 'a1']);
  assert.deepEqual(duplicatePartners(rows('quartz harbour', 'quartz harbor', 'unrelated name')).get('a1'), ['a0']);
});

test('the partner of a first-letter difference is named, even when the names sort far apart', () => {
  const found = duplicatePartners(rows('xuartz harbor', 'mid act here', 'quartz harbor'));
  assert.deepEqual(found.get('a0'), ['a2']);
  assert.deepEqual(found.get('a2'), ['a0']);
  assert.equal(found.has('a1'), false);
});

test('keys two characters apart, a transposition, and short keys one apart, are not', () => {
  assert.equal(duplicatePartners(rows('quartz harbor', 'quartz harboury')).size, 0);
  assert.equal(duplicatePartners(rows('kaskade', 'kaskdae')).size, 0);
  assert.equal(duplicatePartners(rows('abcd', 'abce')).size, 0);
  assert.equal(duplicatePartners(rows('zedd', 'zed')).size, 0);
});

test('one artist alone is never a duplicate, and an empty list is empty', () => {
  assert.equal(duplicatePartners(rows('only one')).size, 0);
  assert.equal(duplicatePartners([]).size, 0);
});
