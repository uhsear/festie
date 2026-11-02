import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const storeState: Record<string, unknown> = {};

vi.mock('@festie/shared/stores', () => ({
  useFestivalStore: vi.fn((sel: (s: Record<string, unknown>) => unknown) => sel(storeState)),
}));

vi.mock('../ui/EmptyState', () => ({
  default: ({
    title,
    description,
    cta,
  }: {
    title: string;
    description?: string;
    cta?: { label: string; onClick: () => void };
  }) => (
    <div>
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {cta && <button onClick={cta.onClick}>{cta.label}</button>}
    </div>
  ),
}));

import ScheduleEmptyState from './ScheduleEmptyState';

const dayFallback = { title: 'Day empty', description: 'Try another day.' };
const setSearchQuery = vi.fn();
const setOnlyMine = vi.fn();
const setActiveStages = vi.fn();

function setStore(overrides: Record<string, unknown> = {}) {
  Object.keys(storeState).forEach((k) => delete storeState[k]);
  Object.assign(storeState, {
    searchQuery: '',
    onlyMine: false,
    activeStages: [],
    stages: [
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
    ],
    currentProfile: { picks: { s1: 'must' } },
    sets: [],
    selectedDay: 0,
    setSearchQuery,
    setOnlyMine,
    setActiveStages,
    ...overrides,
  });
}

describe('ScheduleEmptyState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setStore();
  });

  it('search: shows the search copy and Clear search', () => {
    setStore({ searchQuery: 'zzz' });
    render(<ScheduleEmptyState dayLabel="Friday" dayFallback={dayFallback} />);
    expect(screen.getByText('No artist called “zzz” in this lineup')).toBeInTheDocument();
    screen.getByText('Clear search').click();
    expect(setSearchQuery).toHaveBeenCalledWith('');
  });

  it('search: blames the filter and clears it when a day match is hidden', () => {
    setStore({
      searchQuery: 'justice',
      onlyMine: true,
      sets: [{ id: 's9', stageId: 'a', artist: 'Justice', dayIndex: 0 }],
    });
    render(<ScheduleEmptyState dayLabel="Friday" dayFallback={dayFallback} />);
    expect(screen.getByText('“justice” is hidden by your filters')).toBeInTheDocument();
    screen.getByText('Clear filters').click();
    expect(setOnlyMine).toHaveBeenCalledWith(false);
    expect(setActiveStages).toHaveBeenCalledWith([]);
    expect(setSearchQuery).not.toHaveBeenCalled();
  });

  it('search: renders otherDayMatches and the other-day copy', () => {
    setStore({ searchQuery: 'zzz' });
    render(
      <ScheduleEmptyState dayLabel="Friday" dayFallback={dayFallback} otherDayMatches={<div>other-days-node</div>} />,
    );
    expect(screen.getByText('No “zzz” on Friday')).toBeInTheDocument();
    expect(screen.getByText('other-days-node')).toBeInTheDocument();
  });

  it('picks: shows the picks copy and Show all sets', () => {
    setStore({ onlyMine: true });
    render(<ScheduleEmptyState dayLabel="Sunday" dayFallback={dayFallback} />);
    expect(screen.getByText('No picks for this day yet')).toBeInTheDocument();
    screen.getByText('Show all sets').click();
    expect(setOnlyMine).toHaveBeenCalledWith(false);
  });

  it('stages: names the day and offers All stages', () => {
    setStore({ activeStages: ['a'] });
    render(<ScheduleEmptyState dayLabel="Sunday" dayFallback={dayFallback} />);
    expect(screen.getByText('Nothing on these stages on Sunday')).toBeInTheDocument();
    screen.getByText('All stages').click();
    expect(setActiveStages).toHaveBeenCalledWith([]);
  });

  it('day: uses the fallback and has no button', () => {
    render(<ScheduleEmptyState dayLabel="Sunday" dayFallback={dayFallback} />);
    expect(screen.getByText('Day empty')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
