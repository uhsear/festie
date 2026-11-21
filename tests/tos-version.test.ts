// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createUserWithProfile } from '../lib/auth/sign-in.js';
import { TOS_VERSION } from '../lib/constants.js';

describe('TOS_VERSION', () => {
  it('is a positive integer that matches the column type', () => {
    assert.ok(Number.isInteger(TOS_VERSION) && TOS_VERSION >= 1);
  });

  it('registration stores TOS_VERSION as the accepted terms version', async () => {
    let created: { tosVersion?: number; tosAcceptedAt?: string } | undefined;
    const stores = {
      users: { create: async (u: any) => ((created = u), { id: u.id }) },
      profiles: { claimOrphanProfiles: async () => undefined },
    };
    const deps = { stores, config: {}, log: { error() {} }, invalidateUserCache() {} };
    await createUserWithProfile(
      { cleanUsername: 'tosuser', passwordHash: 'x', newUserId: 'u1', cleanEmail: null, dateOfBirth: null },
      deps,
    );
    assert.equal(created?.tosVersion, TOS_VERSION);
    assert.ok(created?.tosAcceptedAt);
  });
});
