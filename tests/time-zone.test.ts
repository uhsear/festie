import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { formatClock12, festivalStartMinutes } from '../lib/time-zone.js';

describe('time-zone: festival day helpers', () => {
  it('festivalStartMinutes adds a day to starts before 06:00', () => {
    assert.equal(festivalStartMinutes('01:00'), 1500);
    assert.equal(festivalStartMinutes('05:59'), 1799);
    assert.equal(festivalStartMinutes('06:00'), 360);
    assert.equal(festivalStartMinutes('23:30'), 1410);
  });

  it('formatClock12 matches the shared formatTime', () => {
    assert.equal(formatClock12('00:15'), '12:15 AM');
    assert.equal(formatClock12('12:00'), '12:00 PM');
    assert.equal(formatClock12('21:30'), '9:30 PM');
  });
});
