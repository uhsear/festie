import { describe, it, expect } from 'vitest';
import {
  buildMyDay,
  buildPlanList,
  dayPartForHour,
  dayPartTitle,
  nightLabelFor,
  reminderLeadLabel,
  type BuildMyDayInput,
  type MyDayItem,
} from './myDay';
import { buildPickConflicts } from './pickConflicts';
import type { CrewMeetingPoint, FestivalDay, FestivalSet, Priority } from '../types/domain';

const DAYS: FestivalDay[] = [
  { id: 'd0', festivalId: 'f1', date: '2026-06-13', label: 'Saturday', createdAt: '', updatedAt: '' },
  { id: 'd1', festivalId: 'f1', date: '2026-06-14', createdAt: '', updatedAt: '' },
];
const TZ = 'UTC';

// 0.009 degrees of latitude is about 1 km: a 14 minute walk.
const STAGES = [
  { id: 's1', latitude: 40.0, longitude: -74.0 },
  { id: 's2', latitude: 40.009, longitude: -74.0 },
];

function makeSet(id: string, startTime: string, endTime: string, extra: Partial<FestivalSet> = {}): FestivalSet {
  return {
    id,
    festivalId: 'f1',
    stageId: 's1',
    dayIndex: 0,
    startTime,
    endTime,
    artist: id.toUpperCase(),
    createdAt: '',
    updatedAt: '',
    ...extra,
  };
}

function meet(id: string, meetAt: string, extra: Partial<CrewMeetingPoint> = {}): CrewMeetingPoint {
  return {
    id,
    crew_id: 'c1',
    created_by: 'u1',
    label: `Meet ${id}`,
    location: 'Ferris wheel',
    type: 'during',
    meet_at: meetAt,
    stage_reference: null,
    active: true,
    created_at: '',
    ...extra,
  };
}

function pickAll(sets: FestivalSet[]): Record<string, Priority> {
  return Object.fromEntries(sets.map((s) => [s.id, 'must' as Priority]));
}

function myDay(sets: FestivalSet[], extra: Partial<BuildMyDayInput> = {}) {
  return buildMyDay({ sets, myPicks: pickAll(sets), dayIndex: 0, days: DAYS, timeZone: TZ, ...extra });
}

const keys = (items: MyDayItem[]) => items.map((i) => i.key);

describe('day parts', () => {
  it('splits the festival day at 6, 17 and 21', () => {
    expect([0, 5, 6, 16, 17, 20, 21, 23].map(dayPartForHour)).toEqual([
      'after-midnight',
      'after-midnight',
      'afternoon',
      'afternoon',
      'evening',
      'evening',
      'late-night',
      'late-night',
    ]);
  });

  it('names the night after midnight', () => {
    expect(dayPartTitle('after-midnight', 'Saturday')).toBe('After midnight (Saturday night)');
    expect(dayPartTitle('late-night', 'Saturday')).toBe('Late night');
    expect(nightLabelFor(DAYS[0]!)).toBe('Saturday');
    expect(nightLabelFor(DAYS[1]!)).toBe('Sunday');
  });
});

describe('buildMyDay', () => {
  it('groups picks into day parts in time order', () => {
    const sets = [
      makeSet('late', '00:30', '01:30'),
      makeSet('noon', '12:00', '13:00'),
      makeSet('night', '21:00', '22:00'),
      makeSet('eve', '17:00', '18:00'),
    ];
    const day = myDay(sets);
    expect(day.sections.map((s) => s.title)).toEqual([
      'Afternoon',
      'Evening',
      'Late night',
      'After midnight (Saturday night)',
    ]);
    expect(day.sections.map((s) => s.items.filter((i) => i.kind === 'set').map((i) => i.key))).toEqual([
      ['set:noon'],
      ['set:eve'],
      ['set:night'],
      ['set:late'],
    ]);
    expect(day.pickCount).toBe(4);
  });

  it('adds a free gap of 30 minutes or more, in the next item section', () => {
    const day = myDay([makeSet('a', '16:00', '17:00'), makeSet('b', '17:45', '18:30'), makeSet('c', '18:50', '19:30')]);
    expect(day.sections[0]!.items.map((i) => i.key)).toEqual(['set:a']);
    const evening = day.sections[1]!.items;
    expect(keys(evening)).toEqual([`gap:${Date.UTC(2026, 5, 13, 17)}`, 'set:b', 'set:c']);
    expect(evening[0]).toMatchObject({ kind: 'gap', minutes: 45 });
  });

  it('counts a set that ends later than the next one as busy', () => {
    const day = myDay([
      makeSet('long', '12:00', '15:00'),
      makeSet('short', '12:30', '13:00'),
      makeSet('next', '15:10', '16:00'),
    ]);
    expect(day.sections[0]!.items.some((i) => i.kind === 'gap')).toBe(false);
  });

  it('shows the walk between stages', () => {
    const day = myDay(
      [
        makeSet('a', '12:00', '13:00'),
        makeSet('b', '13:20', '14:30', { stageId: 's2' }),
        makeSet('c', '14:30', '15:00', { stageId: 's2' }),
      ],
      { stages: STAGES },
    );
    const [a, b, c] = day.sections[0]!.items as Array<Extract<MyDayItem, { kind: 'set' }>>;
    expect(a!.walkFromPrev).toBeNull();
    expect(b!.walkFromPrev).toEqual({ minutes: 14, fromStageId: 's1' });
    expect(c!.walkFromPrev).toBeNull();
  });

  it('slots in crew meet-ups for the night of the day', () => {
    const sets = [makeSet('a', '18:00', '19:00'), makeSet('b', '19:00', '20:00')];
    const meetingPoints = [
      meet('once', '2026-06-13T19:00:00Z'),
      meet('daily', '2026-06-13T15:00:00Z', { recurs_daily: true }),
      meet('nextMorning', '2026-06-14T07:00:00Z'),
      meet('lateNight', '2026-06-14T02:00:00Z'),
      meet('off', '2026-06-13T18:30:00Z', { active: false }),
    ];
    const day = myDay(sets, { meetingPoints });
    const all = day.sections.flatMap((s) => s.items);
    expect(keys(all)).toEqual([
      `meet:daily:${Date.UTC(2026, 5, 13, 15)}`,
      `gap:${Date.UTC(2026, 5, 13, 15)}`,
      'set:a',
      `meet:once:${Date.UTC(2026, 5, 13, 19)}`,
      'set:b',
      `gap:${Date.UTC(2026, 5, 13, 20)}`,
      `meet:lateNight:${Date.UTC(2026, 5, 14, 2)}`,
    ]);
    expect(day.sections.map((s) => s.part)).toEqual(['afternoon', 'evening', 'after-midnight']);
    expect(all.find((i) => i.kind === 'meet')).toMatchObject({
      meetingPointId: 'daily',
      label: 'Meet daily',
      location: 'Ferris wheel',
    });

    const sunday = buildMyDay({ sets: [], myPicks: {}, dayIndex: 1, days: DAYS, timeZone: TZ, meetingPoints });
    expect(keys(sunday.sections.flatMap((s) => s.items))).toEqual([
      `meet:nextMorning:${Date.UTC(2026, 5, 14, 7)}`,
      `gap:${Date.UTC(2026, 5, 14, 7)}`,
      `meet:daily:${Date.UTC(2026, 5, 14, 15)}`,
    ]);
  });

  it('puts picks without a time, or without a day, in unscheduled', () => {
    const sets = [
      makeSet('timed', '12:00', '13:00'),
      makeSet('tba', '', ''),
      makeSet('noDay', '12:00', '13:00', { dayIndex: undefined }),
      makeSet('otherDay', '12:00', '13:00', { dayIndex: 1 }),
    ];
    const day = myDay(sets);
    expect(day.unscheduled.map((s) => s.id)).toEqual(['tba', 'noDay']);
    expect(day.pickCount).toBe(3);
  });

  it('labels clashing sets', () => {
    const sets = [makeSet('a', '20:00', '21:00'), makeSet('b', '20:30', '21:30')];
    const conflictGroups = buildPickConflicts({
      sets,
      myPicks: pickAll(sets),
      selectedDay: 0,
      days: DAYS,
      timeZone: TZ,
    });
    const items = myDay(sets, { conflictGroups }).sections.flatMap((s) => s.items);
    expect(items.map((i) => (i.kind === 'set' ? i.clashLabel : null))).toEqual([
      'Clashes with B (30 min)',
      'Clashes with A (30 min)',
    ]);
  });
});

describe('buildPlanList', () => {
  const sets = [
    makeSet('late', '00:30', '01:30'),
    makeSet('sun', '12:00', '13:00', { dayIndex: 1 }),
    makeSet('tba', '12:00', '13:00', { dayIndex: undefined }),
    makeSet('eve', '20:00', '21:00'),
    makeSet('noon', '12:00', '13:00'),
  ];

  it('lists every set with a note, picked or not', () => {
    const list = buildPlanList('notes', {
      sets,
      days: DAYS,
      timeZone: TZ,
      notes: { noon: '  Front left  ', eve: '   ', 'crew:eve': 'Crew note', sun: 'Sunday plan' },
      myPicks: { sun: 'must' },
    });
    expect(list).toEqual([
      { set: sets[4], dayIndex: 0, note: 'Front left', reminderMinutes: null, priority: null },
      { set: sets[1], dayIndex: 1, note: 'Sunday plan', reminderMinutes: null, priority: 'must' },
    ]);
  });

  it('sorts reminders by day, then start, with after-midnight last and unscheduled at the end', () => {
    const list = buildPlanList('reminders', {
      sets,
      days: DAYS,
      timeZone: TZ,
      reminders: { late: 15, sun: 60, tba: 5, eve: 0, noon: 30 },
    });
    expect(list.map((i) => [i.set.id, i.dayIndex, i.reminderMinutes])).toEqual([
      ['noon', 0, 30],
      ['eve', 0, 0],
      ['late', 0, 15],
      ['sun', 1, 60],
      ['tba', null, 5],
    ]);
  });
});

describe('reminderLeadLabel', () => {
  it('reads the lead time', () => {
    expect(reminderLeadLabel(0)).toBe('At start');
    expect(reminderLeadLabel(30)).toBe('30 min before');
    expect(reminderLeadLabel(60)).toBe('1 h before');
    expect(reminderLeadLabel(90)).toBe('1 h 30 min before');
  });
});
