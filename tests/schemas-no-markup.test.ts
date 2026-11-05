import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { crewCreateSchema, crewUpdateSchema, displayNameChangeSchema } from '../lib/schemas.js';

describe('names refuse angle brackets', () => {
  it('display name', () => {
    assert.equal(displayNameChangeSchema.safeParse({ displayName: '<script>alert(1)</script>' }).success, false);
    assert.equal(displayNameChangeSchema.safeParse({ displayName: "Tom & Jerry's" }).success, true);
  });
  it('crew create and update', () => {
    assert.equal(crewCreateSchema.safeParse({ name: '<img src=x onerror=alert(1)>', festivalId: 'edc' }).success, false);
    assert.equal(crewCreateSchema.safeParse({ name: 'Rave Fam', festivalId: 'edc' }).success, true);
    assert.equal(crewUpdateSchema.safeParse({ name: 'a>b' }).success, false);
  });
});
