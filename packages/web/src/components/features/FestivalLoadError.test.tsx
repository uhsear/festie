import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const state = vi.hoisted(() => ({
  error: null as string | null,
  festivals: [] as Array<{ id: string; name: string; startDate: string; endDate: string }>,
  currentFestival: null as unknown,
  loadFestivals: vi.fn(),
  selectFestival: vi.fn(),
}));

vi.mock('@festie/shared/stores', () => ({
  useFestivalStore: Object.assign((sel: (s: typeof state) => unknown) => sel(state), { getState: () => state }),
}));

import FestivalLoadError from './FestivalLoadError';

beforeEach(() => {
  vi.clearAllMocks();
  state.error = null;
  state.currentFestival = null;
  state.festivals = [];
  state.loadFestivals.mockResolvedValue(undefined);
  state.selectFestival.mockResolvedValue(undefined);
});

describe('FestivalLoadError', () => {
  it('shows the store message', () => {
    state.error = 'Network down';
    render(<FestivalLoadError />);
    expect(screen.getByText("Couldn't load festivals")).toBeInTheDocument();
    expect(screen.getByText('Network down')).toBeInTheDocument();
  });

  it('falls back to the default body when the store has no message', () => {
    render(<FestivalLoadError />);
    expect(screen.getByText('Check your connection, then try again.')).toBeInTheDocument();
  });

  it('retry loads festivals, then selects the default one', async () => {
    state.festivals = [{ id: 'f1', name: 'Fest', startDate: '2099-01-01', endDate: '2099-01-02' }];
    render(<FestivalLoadError />);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(state.selectFestival).toHaveBeenCalledWith('f1'));
    expect(state.loadFestivals).toHaveBeenCalledTimes(1);
  });

  it('retry swallows a failed load and selects nothing', async () => {
    state.loadFestivals.mockRejectedValue(new Error('down'));
    render(<FestivalLoadError />);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(state.loadFestivals).toHaveBeenCalled());
    expect(state.selectFestival).not.toHaveBeenCalled();
  });
});
