import { describe, it, expect } from 'vitest';
import {
  COPY, FESTIVAL_STATUS_LABEL, MEETING_POINT_KINDS, clashCount, clashPromptCopy, meetingPointKind,
} from './copy';

// Mirrors MEETING_POINT_TYPES in lib/constants.ts:21; shared cannot import backend code.
const SERVER_TYPES = ['pre-show', 'during', 'post-show', 'post-event', 'emergency', 'general'];

describe('meetingPointKind', () => {
  it('labels emergency as Emergency spot', () => {
    expect(meetingPointKind('emergency').label).toBe('Emergency spot');
  });
  it.each(['pre-show', 'during', 'post-show', 'post-event', 'general', 'mystery'])('reads %s as Meet-up', (t) => {
    expect(meetingPointKind(t).label).toBe('Meet-up');
  });
  it('only offers types the server accepts', () => {
    for (const k of MEETING_POINT_KINDS) expect(SERVER_TYPES).toContain(k.type);
  });
});

describe('clashPromptCopy', () => {
  it.each([true, false])('never says conflict (hard=%s)', (hard) => {
    for (const at of ['9:00 PM', null]) {
      const c = clashPromptCopy({ hard, at, currentName: 'A', otherName: 'B' });
      expect(`${c.title} ${c.body}`.toLowerCase()).not.toContain('conflict');
    }
  });
  it('builds hard and soft titles', () => {
    expect(clashPromptCopy({ hard: true, at: '9:00 PM', currentName: 'A', otherName: 'B' }).title)
      .toBe('You have a clash at 9:00 PM: keep one');
    expect(clashPromptCopy({ hard: false, at: null, currentName: 'A', otherName: 'B' }).title)
      .toBe('2 sets: keep one');
  });
});

describe('clashCount', () => {
  it('pluralises', () => {
    expect(clashCount(1)).toBe('Schedule clash');
    expect(clashCount(3)).toBe('3 schedule clashes');
  });
});

describe('status words', () => {
  it('calls a running festival Happening now', () => {
    expect(FESTIVAL_STATUS_LABEL.ongoing).toBe('Happening now');
  });
  it('reserves Live for location sharing', () => {
    const { liveLocation, ...rest } = COPY.status;
    expect(liveLocation).toBe('Live');
    for (const v of Object.values(rest)) expect(v).not.toBe('Live');
  });
});
