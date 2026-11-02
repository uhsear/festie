// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DEFAULT_CREW_MAX_MEMBERS,
  MAX_CREWS_PER_FESTIVAL,
  MAX_OPEN_POLLS_PER_CREW,
  PICK_PRIORITY_VALUES,
} from '../lib/constants.js';
// The root backend deliberately does NOT depend on @festie/shared (separate npm
// vs pnpm install trees), so the pick-priority enum is hand-mirrored in the
// shared package's UI constants. This test is the drift guard for that mirror —
// imported by relative path since tsx resolves workspace TS source directly.
import * as shared from '../packages/shared/src/constants/config.js';

const { PRIORITY_OPTIONS } = shared;

describe('root ↔ @festie/shared constant parity', () => {
  it('pick priority values match shared PRIORITY_OPTIONS exactly (order included)', () => {
    assert.deepStrictEqual(
      PRIORITY_OPTIONS.map((o) => o.value),
      [...PICK_PRIORITY_VALUES],
      'packages/shared/src/constants/config.ts PRIORITY_OPTIONS drifted from lib/constants.ts PICK_PRIORITY_VALUES',
    );
  });

  it('shared sort order matches root declaration order', () => {
    const sorted = [...PRIORITY_OPTIONS].sort((a, b) => a.sort - b.sort).map((o) => o.value);
    assert.deepStrictEqual(sorted, [...PICK_PRIORITY_VALUES]);
  });

  it('crew limits match the shared mirror', () => {
    assert.deepStrictEqual(
      {
        MAX_CREWS_PER_FESTIVAL: shared.MAX_CREWS_PER_FESTIVAL,
        MAX_OPEN_POLLS_PER_CREW: shared.MAX_OPEN_POLLS_PER_CREW,
        DEFAULT_CREW_MAX_MEMBERS: shared.DEFAULT_CREW_MAX_MEMBERS,
      },
      { MAX_CREWS_PER_FESTIVAL, MAX_OPEN_POLLS_PER_CREW, DEFAULT_CREW_MAX_MEMBERS },
    );
  });
});
