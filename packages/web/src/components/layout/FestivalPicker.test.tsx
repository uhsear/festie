import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import FestivalPicker from './FestivalPicker';

interface TestFestival {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  location?: string;
}

const day = (offset: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const state = {
  festivals: [] as TestFestival[],
  currentFestival: null as { id: string; name: string } | null,
  selectFestival: vi.fn(async (_id: string) => {}),
  isLoading: false,
};

vi.mock('@festie/shared/stores', () => ({
  useFestivalStore: (selector: (s: typeof state) => unknown) => selector(state),
}));
vi.mock('../../lib/toastContext', () => ({
  useToast: () => ({ toast: vi.fn(), toastError: vi.fn() }),
}));

const fest = (id: string, name: string, start: number, end: number, location?: string): TestFestival => ({
  id,
  name,
  startDate: day(start),
  endDate: day(end),
  location,
});

afterEach(() => {
  state.festivals = [];
  state.currentFestival = null;
  state.isLoading = false;
  vi.clearAllMocks();
});

describe('FestivalPicker trigger', () => {
  it('shows the current festival name', () => {
    state.currentFestival = { id: 'a', name: 'Alpha Fest' };
    render(<FestivalPicker />);
    const trigger = screen.getByTestId('festival-select');
    expect(trigger).toHaveTextContent('Alpha Fest');
    expect(trigger).toHaveAttribute('data-festival-id', 'a');
    expect(trigger).toHaveAttribute('aria-label', 'Festival: Alpha Fest. Change festival');
  });

  it('shows a placeholder while loading and "Choose a festival" after', () => {
    state.isLoading = true;
    const { unmount, container } = render(<FestivalPicker />);
    expect(container.querySelector('.skeleton-shimmer')).toBeInTheDocument();
    expect(screen.queryByText('Select Festival')).not.toBeInTheDocument();
    unmount();
    state.isLoading = false;
    render(<FestivalPicker />);
    expect(screen.getByTestId('festival-select')).toHaveTextContent('Choose a festival');
  });
});

describe('FestivalPicker dialog', () => {
  it('groups festivals in order with dates and place, and marks the current one', () => {
    state.festivals = [
      fest('past', 'Past Fest', -30, -28, 'Orlando'),
      fest('up', 'Upcoming Fest', 20, 22, 'Miami'),
      fest('live', 'Live Fest', -1, 1, 'Tampa'),
    ];
    state.currentFestival = { id: 'live', name: 'Live Fest' };
    render(<FestivalPicker />);
    fireEvent.click(screen.getByTestId('festival-select'));
    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual(['Live now', 'Upcoming', 'Past']);
    expect(screen.getByTestId('festival-option-up')).toHaveTextContent('Miami');
    expect(screen.getByTestId('festival-option-up')).toHaveTextContent(' · ');
    expect(screen.getByTestId('festival-option-live')).toHaveAttribute('aria-current', 'true');
    expect(screen.getByTestId('festival-option-past')).not.toHaveAttribute('aria-current');
  });

  it('shows search only above 8 festivals and filters by name or location', () => {
    state.festivals = Array.from({ length: 8 }, (_, i) => fest(`f${i}`, `Fest ${i}`, 10 + i, 12 + i));
    const { unmount } = render(<FestivalPicker />);
    fireEvent.click(screen.getByTestId('festival-select'));
    expect(screen.queryByLabelText('Search festivals')).not.toBeInTheDocument();
    unmount();

    state.festivals.push(fest('f8', 'Needle', 30, 31, 'Haystack City'));
    render(<FestivalPicker />);
    fireEvent.click(screen.getByTestId('festival-select'));
    fireEvent.change(screen.getByLabelText('Search festivals'), { target: { value: 'haystack' } });
    expect(screen.getByTestId('festival-option-f8')).toBeInTheDocument();
    expect(screen.queryByTestId('festival-option-f0')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Search festivals'), { target: { value: 'zzz' } });
    expect(screen.getByText('No festival matches "zzz".')).toBeInTheDocument();
  });

  it('calls selectFestival and closes when a row is chosen', async () => {
    state.festivals = [fest('a', 'Alpha', 5, 6), fest('b', 'Beta', 8, 9)];
    render(<FestivalPicker />);
    fireEvent.click(screen.getByTestId('festival-select'));
    fireEvent.click(screen.getByTestId('festival-option-b'));
    expect(state.selectFestival).toHaveBeenCalledWith('b');
    await waitFor(() => expect(screen.queryByTestId('festival-option-b')).not.toBeInTheDocument());
  });

  it('says "No festivals yet." for an empty loaded list', () => {
    render(<FestivalPicker />);
    fireEvent.click(screen.getByTestId('festival-select'));
    expect(screen.getByText('No festivals yet.')).toBeInTheDocument();
  });
});
