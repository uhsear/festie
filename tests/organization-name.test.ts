import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSafeOrganizationName } from '../lib/schemas/organization';

test('organization names that read as a web address are refused', () => {
  for (const name of ['evil1.com', 'x-y.io', 'a).com', 'Fest.example', 'bit.ly', 'Promo 2.0', 'see http://x', 'a@b']) {
    assert.equal(isSafeOrganizationName(name), false, name);
  }
});

test('ordinary organization names are accepted', () => {
  for (const name of ['St. Louis Fest', 'Fest Inc.', 'Rock & Roll (Live)', "O'Brien Presents", 'Club 54', 'Sound, Vision + More!']) {
    assert.equal(isSafeOrganizationName(name), true, name);
  }
});
