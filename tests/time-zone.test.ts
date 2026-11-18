import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

// The backend does not depend on @festie/shared, so setMinuteRange is mirrored in
// lib/time-zone.ts. The parity test below imports the shared copy by relative path.
import { register } from 'tsx/cjs/api';

import { formatClock12, festivalStartMinutes, setMinuteRange } from '../lib/time-zone.js';

register();
const { setMinuteRange: sharedSetMinuteRange } = await import('../packages/shared/src/utils/setStatus.js');

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

describe('time-zone: setMinuteRange', () => {
  it('rolls the end past midnight and counts a start before 06:00 as the night before', () => {
    assert.deepEqual(setMinuteRange({ startTime: '23:30', endTime: '01:00' }), { start: 1410, end: 1500 });
    assert.deepEqual(setMinuteRange({ startTime: '00:30', endTime: '02:00' }), { start: 1470, end: 1560 });
    assert.deepEqual(setMinuteRange({ startTime: '05:00', endTime: '07:00' }), { start: 1740, end: 1860 });
    assert.equal(setMinuteRange({ startTime: '20:00', endTime: null }), null);
  });

  it('matches the shared setMinuteRange', () => {
    for (const startTime of ['00:00', '05:59', '06:00', '12:00', '22:00', '23:59']) {
      for (const endTime of ['00:00', '01:30', '06:00', '21:00', '23:59']) {
        assert.deepEqual(
          setMinuteRange({ startTime, endTime }),
          sharedSetMinuteRange({ startTime, endTime }),
          `${startTime}-${endTime}`,
        );
      }
    }
  });
});
