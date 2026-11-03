import type { PickInsight } from './pickInsight';

// Test fixture shared by the shared and web pick-insight tests.
export const pickInsightSet = (over: Partial<PickInsight['sets'][number]>): PickInsight['sets'][number] => ({
  setId: 'a',
  dayIndex: 0,
  dayLabel: 'Friday',
  date: '2026-11-06',
  stageName: 'Main',
  artist: 'Alpha',
  startTime: '23:00',
  endTime: '01:00',
  picks: 8,
  must: 3,
  want: 3,
  maybe: 2,
  ...over,
});

export const pickInsightFixture: PickInsight = {
  festivalId: 'f1',
  festivalName: 'Fest',
  minPairPeople: 5,
  generatedAt: '2026-11-02T00:00:00.000Z',
  sets: [
    pickInsightSet({}),
    pickInsightSet({ setId: 'b', artist: '=Beta', stageName: '', startTime: '00:30', endTime: '02:00' }),
    pickInsightSet({ setId: 'tba', artist: 'Tba', startTime: null, endTime: null, picks: 0, must: 0, want: 0, maybe: 0 }),
  ],
  clashes: [
    { aSetId: 'a', bSetId: 'b', people: 8 },
    { aSetId: 'a', bSetId: 'tba', people: 5 },
    { aSetId: 'x', bSetId: 'a', people: 5 },
  ],
};
