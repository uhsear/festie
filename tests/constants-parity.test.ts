// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DEFAULT_CREW_MAX_MEMBERS,
  MAX_ARTISTS_PER_SET,
  MAX_CREWS_PER_FESTIVAL,
  MAX_OPEN_POLLS_PER_CREW,
  PICK_PRIORITY_VALUES,
} from '../lib/constants.js';
// The pick-priority enum is hand-mirrored in the shared package's UI constants
// (the root backend only bundles shared leaf modules by relative path). This test is the drift guard for that mirror —
// imported by relative path since tsx resolves workspace TS source directly.
import { MAX_SHARE_WINDOW_MS, POSITION_TTL_MS } from '../lib/live-location-cache.js';
import { mergeMustSeeLeads } from '../lib/reminder-scheduler.js';
import * as shared from '../packages/shared/src/constants/config.js';
import { effectiveReminders } from '../packages/shared/src/utils/reminderSchedule.js';
import { toCents as sharedToCents } from '../packages/shared/src/utils/money.js';
import { toCents } from '../lib/helpers/export-utils.js';

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

  it('artists per set matches the shared mirror', () => {
    assert.equal(shared.MAX_ARTISTS_PER_SET, MAX_ARTISTS_PER_SET);
  });

  it('toCents matches the shared mirror', () => {
    for (const v of [12.4, '12.40', '0.1', 1.005, '-3.2', 'abc', '', NaN, Infinity]) {
      assert.equal(toCents(v), sharedToCents(v), `toCents(${String(v)})`);
    }
  });

  it('live-location TTLs are read from shared', () => {
    assert.equal(POSITION_TTL_MS, shared.LIVE_LOCATION.STALE_MS);
    assert.equal(MAX_SHARE_WINDOW_MS, shared.LIVE_SHARE_MAX_MS);
  });

  it('reminder lead merge matches shared effectiveReminders', () => {
    const cases: Array<[Record<string, number>, string[], number | null]> = [
      [{}, ['a', 'b'], 15],
      [{ a: 5 }, ['a', 'b'], 15],
      [{ c: 45 }, ['a'], 0],
      [{ a: 5 }, ['a'], null],
      [{}, [], 30],
    ];
    for (const [reminders, mustIds, lead] of cases) {
      const picks = Object.fromEntries(mustIds.map((id) => [id, 'must' as const]));
      assert.deepStrictEqual(
        mergeMustSeeLeads(reminders, mustIds, lead),
        effectiveReminders(reminders, picks, lead),
        JSON.stringify({ reminders, mustIds, lead }),
      );
    }
  });
});
