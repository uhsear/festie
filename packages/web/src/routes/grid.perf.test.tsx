import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useRef } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import type { FestivalDay, FestivalSet, Priority, Stage } from '@festie/shared/types';
import { buildPickConflicts, buildClashMarks } from '@festie/shared/utils';

// DOM-size guard for the merged grid on an EDC Orlando-sized lineup. It
// catches a return to one element per 15-minute slot per stage, which is what
// made the old grid slow on a phone. The real TimelineGrid, cells, legend and
// filters render; only the stores and the store-backed hooks are mocked.

const storeState: Record<string, unknown> = {};

vi.mock('@festie/shared/stores', () => ({
  useFestivalStore: vi.fn((sel: (s: Record<string, unknown>) => unknown) => sel(storeState)),
}));

vi.mock('@festie/shared/stores/uiStore', () => ({
  useUIStore: Object.assign(vi.fn((sel: (s: Record<string, unknown>) => unknown) => sel(storeState)), { subscribe: vi.fn() }),
}));

vi.mock('@festie/shared/stores/festivalModeStore', () => ({
  useFestivalModeStore: vi.fn((sel: (s: Record<string, unknown>) => unknown) => sel({ lowPowerMode: false })),
}));

vi.mock('../components/features/LastSyncedBadge', () => ({ default: () => null }));
vi.mock('../components/features/LowPowerIndicator', () => ({ default: () => null }));

vi.mock('../components/layout/RefreshableView', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('../components/layout/RouteErrorBoundary', () => ({
  RenderErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// The pick and clash hooks mirror the shared ones over the mocked store state:
// useDayClashes runs the same pure buildPickConflicts + buildClashMarks.
vi.mock('@festie/shared/hooks', () => {
  const picks = () => (storeState.picks ?? {}) as Record<string, Priority>;
  return {
    usePicks: () => ({
      getMyPick: (id: string) => picks()[id] ?? null,
      getOtherPicks: () => [],
      savePick: vi.fn(),
    }),
    useFestival: () => ({ getStageColor: () => '#00e8d0', getStageName: () => 'Stage' }),
    useDayClashes: () => {
      const groups = buildPickConflicts({
        sets: storeState.sets as FestivalSet[],
        myPicks: picks(),
        selectedDay: storeState.selectedDay as number,
        days: storeState.days as FestivalDay[],
      });
      return { count: groups.length, groups, marks: buildClashMarks(groups, (s) => s.artist) };
    },
  };
});

vi.mock('../hooks/useNowIndicator', () => ({
  useNowIndicator: () => ({ nowIndicator: null, gridRef: useRef<HTMLDivElement | null>(null), scrollToNow: vi.fn() }),
}));

import GridView from './grid';

const STAGES: Stage[] = Array.from({ length: 7 }, (_, k) => ({ id: `st${k}`, name: `Stage ${k + 1}` }) as Stage);
const DAYS: FestivalDay[] = ['2030-11-08', '2030-11-09', '2030-11-10'].map(
  (date, dayIndex) => ({ id: `d${dayIndex}`, date, dayIndex, label: `Day ${dayIndex + 1}` }) as FestivalDay,
);

const hhmm = (min: number) => {
  const m = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

// 3 days x 7 stages x 5 slots = 105 sets, 35 a day. Slot j starts at 14:00 +
// 150 min x j (the last at midnight); stage k starts 5 min later per stage and
// runs 45 to 90 minutes, so the day spans 14:00 to 02:00. Sets in one slot all
// overlap; sets in different slots never do.
const SETS: FestivalSet[] = DAYS.flatMap((d) =>
  STAGES.flatMap((st, k) =>
    Array.from({ length: 5 }, (_, j) => {
      const start = 14 * 60 + 150 * j + 5 * k;
      const length = 45 + ((j + k) % 4) * 15;
      return {
        id: `d${d.dayIndex}-${st.id}-${j}`,
        festivalId: 'edc',
        stageId: st.id,
        dayIndex: d.dayIndex,
        artist: `Artist ${d.dayIndex}${k}${j}`,
        startTime: hhmm(start),
        endTime: hhmm(start + length),
        createdAt: '2030-01-01T00:00:00Z',
        updatedAt: '2030-01-01T00:00:00Z',
      } as FestivalSet;
    }),
  ),
);

// 15 day-1 picks: 3 in each of slots 0-2, 4 in slot 3, 2 in slot 4 → 5 clash groups.
const PICKS: Record<string, Priority> = {};
[3, 3, 3, 4, 2].forEach((n, j) => {
  for (let k = 0; k < n; k++) PICKS[`d0-st${k}-${j}`] = 'want-to-see';
});

// Measured 2026-11-01: 747 elements under the grid root for day 1 at 1024px.
// Budget = measured + 25%.
const DOM_BUDGET = 934;

describe('GridView perf (EDC Orlando-sized lineup)', () => {
  beforeEach(() => {
    Object.keys(storeState).forEach((k) => delete storeState[k]);
    Object.assign(storeState, {
      currentFestival: { id: 'edc', name: 'EDC Orlando' },
      currentProfile: { id: 'p1', picks: PICKS },
      picks: PICKS,
      sets: SETS,
      stages: STAGES,
      days: DAYS,
      selectedDay: 0,
      activeStages: [],
      onlyMine: false,
      setDetailSet: vi.fn(),
    });
  });

  it('renders every day-1 set once, counts the clashes and stays under the DOM budget', () => {
    expect(SETS).toHaveLength(105);
    expect(Object.keys(PICKS)).toHaveLength(15);

    render(<GridView />);
    const root = screen.getByRole('group', { name: /Festival schedule grid/ });
    const day1 = SETS.filter((s) => s.dayIndex === 0);
    expect(day1).toHaveLength(35);
    for (const s of day1) expect(root.querySelectorAll(`[data-set-id="${s.id}"]`)).toHaveLength(1);
    expect(root.querySelectorAll('[data-set-id]')).toHaveLength(35);
    expect(screen.getByRole('button', { name: 'You have 5 schedule clashes. Show the first one.' })).toHaveTextContent(
      '5 clashes',
    );

    const count = root.querySelectorAll('*').length;
    expect(count).toBeLessThan(DOM_BUDGET);

    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(root.style.gridTemplateRows).toContain('29px');
    expect(root.querySelectorAll('*').length).toBe(count);
  });
});
