import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { artistNameKey, shownSetName } from '../lib/artist-key';
import { lineupNameKey } from '../lib/lineup';

// The key depends on the Node ICU and Unicode version, so this table pins it: a drift fails CI.
// Source: artist repository plan, section 4.1.
const GOLDEN: Array<[string, string]> = [
  ['Fred again..', 'fred again'],
  ['Fred Again', 'fred again'],
  ['FRED AGAIN!', 'fred again'],
  ['Tiësto', 'tiesto'],
  ['Tiesto', 'tiesto'],
  ['Above & Beyond', 'above and beyond'],
  ['Above and Beyond', 'above and beyond'],
  ['&ME', 'and me'],
  ["Sumthin' Sumthin", 'sumthin sumthin'],
  ['Sumthin’ Sumthin', 'sumthin sumthin'],
  ['R.L. Grime', 'rl grime'],
  ['RL Grime', 'rl grime'],
  ['HOL!', 'hol'],
  ['HOL', 'hol'],
  ['roi*', 'roi'],
  ['beastboi.', 'beastboi'],
  ['!!!', '!!!'],
  ['MØ', 'mø'],
  ['Ελένη', 'ελενη'],
  ['Ελενη', 'ελενη'],
];

describe('artistNameKey', () => {
  for (const [input, key] of GOLDEN) {
    test(`${JSON.stringify(input)} -> ${JSON.stringify(key)}`, () => {
      assert.equal(artistNameKey(input), key);
    });
  }

  test('a mark on a non-Latin script keeps two names apart', () => {
    assert.notEqual(artistNameKey('ガ'), artistNameKey('カ'));
  });

  test('the key of a key is the key', () => {
    for (const [input] of GOLDEN) assert.equal(artistNameKey(artistNameKey(input)), artistNameKey(input), input);
  });

  test('an empty fold falls back to the lower-cased, trimmed input', () => {
    assert.equal(artistNameKey('  !!!  '), '!!!');
    assert.equal(artistNameKey(''), '');
  });

  test('it never splits on "&", "x" or "vs", and never on b2b', () => {
    assert.equal(artistNameKey('Gryffin & Illenium'), 'gryffin and illenium');
    assert.equal(artistNameKey('A x B'), 'a x b');
    assert.equal(artistNameKey('A vs B'), 'a vs b');
    assert.equal(artistNameKey('A b2b B'), 'a b2b b');
  });

  test('it keeps a leading "the", unlike lineupNameKey', () => {
    assert.equal(artistNameKey('The Chainsmokers'), 'the chainsmokers');
    assert.equal(lineupNameKey('The Chainsmokers'), 'chainsmokers');
    assert.notEqual(artistNameKey('The Chainsmokers'), artistNameKey('Chainsmokers'));
  });
});

describe('shownSetName matches the shared artistDisplayName on every branch', () => {
  const artists = [{ name: 'JEANIE' }, { name: 'VAMPA' }];

  test('displayName wins', () => {
    assert.equal(shownSetName({ displayName: 'Witching Hour', artist: 'JEANIE b2b VAMPA', artists }), 'Witching Hour');
  });

  test('a flat artist that differs from the joined names wins', () => {
    assert.equal(shownSetName({ artist: 'Jeanie and Vampa', artists }), 'Jeanie and Vampa');
  });

  test('a flat artist equal to the joined names shows the joined names', () => {
    assert.equal(shownSetName({ artist: 'JEANIE b2b VAMPA', artists }), 'JEANIE b2b VAMPA');
  });

  test('no flat artist shows the joined names with the festival separator', () => {
    assert.equal(shownSetName({ artist: '', artists }, 'x'), 'JEANIE x VAMPA');
  });

  test('no artists shows the flat artist, then Unknown', () => {
    assert.equal(shownSetName({ artist: 'Solo', artists: [] }), 'Solo');
    assert.equal(shownSetName({ artist: '', artists: null }), 'Unknown');
  });
});
