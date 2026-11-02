import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { appLink, appOrigin } from '../lib/notifications/links.js';

describe('notifications/links', () => {
  it('appLink strips trailing slashes from PUBLIC_ORIGIN', () => {
    assert.equal(
      appLink({ PUBLIC_ORIGIN: 'https://staging.festie.us//' }, '/set/s1'),
      'https://staging.festie.us/set/s1',
    );
  });

  it('falls back to https://festie.us when PUBLIC_ORIGIN is unset', () => {
    assert.equal(appOrigin({}), 'https://festie.us');
    assert.equal(appOrigin(undefined), 'https://festie.us');
    assert.equal(appLink({ PUBLIC_ORIGIN: '' }, '/picks'), 'https://festie.us/picks');
  });
});
