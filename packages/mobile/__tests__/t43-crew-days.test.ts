import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { indexCrewDays, memberDayChips, myDaysPayload } from '@festie/shared/utils';
import type { FestivalDay } from '@festie/shared/types';

const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

const day = (i: number, date: string, label?: string): FestivalDay => ({
  id: `d${i}`,
  festivalId: 'f1',
  date,
  label,
  dayIndex: i,
  createdAt: '',
  updatedAt: '',
});
const days = [day(0, '2026-11-06'), day(1, '2026-11-07'), day(2, '2026-11-08')];

describe('t43 member day chips', () => {
  const index = indexCrewDays([
    { userId: 'u1', dayIndex: 0, answer: 'going' },
    { userId: 'u1', dayIndex: 1, answer: 'maybe' },
    { userId: 'u1', dayIndex: 2, answer: 'no' },
  ]);

  it('builds the chips and the accessible name parts', () => {
    const { chips, a11y } = memberDayChips(index, 'u1', days);
    expect(chips.map((c) => c.label)).toEqual(['Fri', 'Sat?', 'Sun']);
    expect(a11y).toBe('going Friday; maybe Saturday; not going Sunday');
  });

  it('shows no chips for a member with no answers', () => {
    expect(memberDayChips(index, 'u2', days)).toEqual({ chips: [], a11y: null });
  });

  it('tapping the selected answer clears it', () => {
    expect(myDaysPayload(index, 'u1', 1, null).days.map((d) => d.dayIndex)).toEqual([0, 2]);
  });
});

describe('t43 mobile wiring', () => {
  it('CrewMyDays offers the three answers and the group name', () => {
    const src = read('components/CrewMyDays.tsx');
    for (const needle of ["'Going'", "'Maybe'", "'Not going'", 'Your days', ': are you going?', "Couldn't save your days. Try again."]) {
      expect(src).toContain(needle);
    }
  });

  it('MemberDayChips names the group from the shared helper', () => {
    const src = read('components/MemberDayChips.tsx');
    expect(src).toContain('memberDayChips(');
    expect(src).toContain('accessibilityLabel={`${name}: ${a11y}`}');
    expect(src).toContain('line-through');
  });

  it('meeting points show the button, count and store call', () => {
    const src = read('components/CrewMeetingPoints.tsx');
    expect(src).toContain("`I'll be there: ${point.label}`");
    expect(src).toContain("comingMine ? 'Coming' : \"I'll be there\"");
    expect(src).toContain('{comingCount} coming');
    expect(src).toContain('setMeetingPointComing(crewId, point.id, currentUserId, coming)');
  });

  it('crew screen and compare mount the new pieces', () => {
    const crew = read('app/(tabs)/crew.tsx');
    expect(crew).toContain('<CrewMyDays');
    expect(crew).toContain('<MemberDayChips');
    const compare = read('app/crew-compare.tsx');
    expect(compare).toContain('Not there ');
    expect(compare).toContain('notThere');
  });
});
