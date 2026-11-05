import { describe, it, expect } from 'vitest';
import type { CrewMemberDay, FestivalDay } from '../types/domain';
import {
  attendingDayCount,
  dayShortLabel,
  hasDayAnswers,
  indexCrewDays,
  isAttending,
  memberDayChips,
  myDaysPayload,
} from './crewDays';

const rows: CrewMemberDay[] = [
  { userId: 'a', dayIndex: 0, answer: 'going' },
  { userId: 'a', dayIndex: 1, answer: 'maybe' },
  { userId: 'a', dayIndex: 2, answer: 'no' },
  { userId: 'b', dayIndex: 1, answer: 'no' },
];
const days = [{ date: '2026-09-04' }, { date: '2026-09-05' }, { date: '2026-09-06' }] as FestivalDay[];
const index = indexCrewDays(rows);

describe('isAttending', () => {
  it('is false only for an explicit no', () => {
    expect(isAttending(index, 'nobody', 0)).toBe(true);
    expect(isAttending(index, 'a', 0)).toBe(true);
    expect(isAttending(index, 'a', 1)).toBe(true);
    expect(isAttending(index, 'a', 2)).toBe(false);
    expect(isAttending(index, 'b', 0)).toBe(true);
  });
});

describe('attendingDayCount and hasDayAnswers', () => {
  it('counts days that are not no', () => {
    expect(attendingDayCount(index, 'a', 3)).toBe(2);
    expect(attendingDayCount(index, 'b', 3)).toBe(2);
    expect(attendingDayCount(index, 'nobody', 3)).toBe(3);
  });
  it('detects any answer among the users', () => {
    expect(hasDayAnswers(index, ['nobody', 'b'])).toBe(true);
    expect(hasDayAnswers(index, ['nobody'])).toBe(false);
  });
});

describe('dayShortLabel', () => {
  it('uses the weekday when the date is valid', () => {
    expect(dayShortLabel({ date: '2026-09-05' }, 1)).toBe('Sat');
  });
  it('takes the weekday from a weekday label, not the calendar date', () => {
    expect(dayShortLabel({ date: '2026-11-05', label: 'Sunday' }, 2)).toBe('Sun');
    expect(dayShortLabel({ date: '2026-09-05', label: 'Day 2' }, 1)).toBe('Sat');
  });
  it('falls back to the label, then to Day n', () => {
    expect(dayShortLabel({ date: '', label: '  Friday  ' }, 0)).toBe('Friday');
    expect(dayShortLabel({ date: '' }, 2)).toBe('Day 3');
  });
});

describe('memberDayChips', () => {
  it('returns one chip per answered day in day order with an a11y summary', () => {
    const { chips, a11y } = memberDayChips(index, 'a', days);
    expect(chips).toEqual([
      { dayIndex: 0, label: 'Fri', answer: 'going' },
      { dayIndex: 1, label: 'Sat?', answer: 'maybe' },
      { dayIndex: 2, label: 'Sun', answer: 'no' },
    ]);
    expect(a11y).toBe('going Friday; maybe Saturday; not going Sunday');
  });
  it('returns nothing for a member with no answers', () => {
    expect(memberDayChips(index, 'nobody', days)).toEqual({ chips: [], a11y: null });
  });
});

describe('myDaysPayload', () => {
  it('sets, changes and clears one day, sorted', () => {
    expect(myDaysPayload(index, 'b', 0, 'going').days).toEqual([
      { dayIndex: 0, answer: 'going' },
      { dayIndex: 1, answer: 'no' },
    ]);
    expect(myDaysPayload(index, 'b', 1, 'maybe').days).toEqual([{ dayIndex: 1, answer: 'maybe' }]);
    expect(myDaysPayload(index, 'b', 1, null).days).toEqual([]);
    expect(myDaysPayload(index, 'nobody', 0, 'no').days).toEqual([{ dayIndex: 0, answer: 'no' }]);
  });
});
