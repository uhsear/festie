import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ScheduleResultsRow from './ScheduleResultsRow';

const storeState = {
  stages: [{ id: 's1' }, { id: 's2' }, { id: 's3' }],
  activeStages: [] as string[],
  activeGenres: [] as string[],
  searchQuery: '',
  onlyMine: false,
  currentProfile: { picks: {} as Record<string, string> },
  setSearchQuery: vi.fn(),
  setOnlyMine: vi.fn(),
  setActiveStages: vi.fn(),
  setActiveGenres: vi.fn(),
  setHiddenDays: vi.fn(),
};

vi.mock('@festie/shared/stores', () => ({
  useFestivalStore: (selector: (s: typeof storeState) => unknown) => selector(storeState),
}));

let viewAs: { name: string } | null = null;
const clearViewAs = vi.fn();

vi.mock('@festie/shared/hooks', () => ({
  useViewAs: () => ({ target: viewAs, clear: clearViewAs }),
  useFestival: () => ({
    getFilteredSets: () => [
      { id: 'a', startTime: '2026-05-29T20:00:00Z', endTime: '2026-05-29T21:00:00Z' },
      { id: 'b', startTime: '2026-05-29T21:00:00Z', endTime: '2026-05-29T22:00:00Z' },
    ],
  }),
}));

vi.mock('@tanstack/react-router', () => ({
  useLocation: () => ({ pathname: '/cards' }),
}));

afterEach(() => {
  storeState.activeStages = [];
  storeState.activeGenres = [];
  viewAs = null;
  vi.clearAllMocks();
});

describe('ScheduleResultsRow', () => {
  it('renders nothing with no filter', () => {
    const { container } = render(<ScheduleResultsRow />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the count for a stage filter and Clear all resets the filters but not hidden days', () => {
    storeState.activeStages = ['s1'];
    render(<ScheduleResultsRow />);
    expect(screen.getByText('2 sets · 1 stage')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear all filters' }));
    expect(storeState.setSearchQuery).toHaveBeenCalledWith('');
    expect(storeState.setOnlyMine).toHaveBeenCalledWith(false);
    expect(storeState.setActiveStages).toHaveBeenCalledWith([]);
    expect(storeState.setHiddenDays).not.toHaveBeenCalled();
  });

  it('shows for a genre filter alone and Clear all clears genres', () => {
    storeState.activeGenres = ['house'];
    render(<ScheduleResultsRow />);
    expect(screen.getByText('2 sets · 1 genre')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear all filters' }));
    expect(storeState.setActiveGenres).toHaveBeenCalledWith([]);
  });

  it('shows with only View as on, names the member, and Clear all ends it', () => {
    viewAs = { name: 'Ana' };
    render(<ScheduleResultsRow />);
    expect(screen.getByText("2 sets · Ana's picks")).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear all filters' }));
    expect(clearViewAs).toHaveBeenCalledOnce();
  });
});
