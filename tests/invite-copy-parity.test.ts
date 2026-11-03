// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

// The shared package is not "type": "module", so Node loads its .ts files as
// CommonJS. Register the CommonJS hook above the shared import, as
// tests/ics-parity.test.ts does.
import 'tsx/cjs';

import { INVITE_ERROR_MESSAGES } from '../lib/invite-pages.js';
// The backend does not depend on @festie/shared, so it keeps its own copy of the
// locked-crew message. This test is the drift guard, imported by relative path.
import { inviteStatusMessage } from '../packages/shared/src/utils/invite.js';

describe('locked-crew copy parity (backend and shared)', () => {
  const shared = inviteStatusMessage('locked', true);

  it('shared says the same thing signed in and signed out', () => {
    assert.equal(shared, "This crew isn't taking new members.");
    assert.equal(inviteStatusMessage('locked', false), shared);
  });

  it('the invite page message matches shared', () => {
    assert.equal(INVITE_ERROR_MESSAGES.locked, shared);
  });

  // The two 403 messages are inline literals in the route handlers.
  for (const file of ['routes/crew-invites.ts', 'routes/crews.ts']) {
    it(`${file} sends the shared message with CREW_LOCKED`, () => {
      const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
      assert.ok(
        source.includes(`sendError(res, 403, ${JSON.stringify(shared)}, ErrorCodes.CREW_LOCKED)`),
        `${file} has no 403 CREW_LOCKED with the shared message`,
      );
    });
  }
});
