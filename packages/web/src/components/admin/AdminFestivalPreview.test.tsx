import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useFestivalStore } from '@festie/shared/stores';
import AdminFestivalPreview from './AdminFestivalPreview';

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}));

const mockPreview = vi.fn();
vi.mock('@festie/shared/services/admin', () => ({
  fetchFestivalPreview: (...a: unknown[]) => mockPreview(...a),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockPreview.mockResolvedValue({
    name: 'EDC',
    dateRange: 'May 15–17',
    location: 'Orlando',
    days: [
      {
        key: 'd1',
        label: 'Day 1',
        date: '2026-05-15',
        sets: [
          { id: 's1', time: '8:00 PM', artist: 'First Act', stageName: 'Kinetic', stageColor: '#ff0000' },
          { id: 's2', time: '9:00 PM', artist: 'Second Act', stageName: 'Circuit', stageColor: undefined },
        ],
      },
    ],
    stages: [
      { id: 'k', name: 'Kinetic', color: '#ff0000', pinned: true },
      { id: 'c', name: 'Circuit', color: undefined, pinned: false },
    ],
    warnings: ['1 stage has no map pin: Circuit.'],
  });
});

describe('AdminFestivalPreview', () => {
  it('renders sets in order, the unpinned warning, and never selects the festival', async () => {
    const spy = vi.spyOn(useFestivalStore.getState(), 'selectFestival');
    render(<AdminFestivalPreview festivalId="f1" />);

    expect(await screen.findByText('Preview: EDC')).toBeInTheDocument();
    expect(screen.getByText('1 stage has no map pin: Circuit.')).toBeInTheDocument();
    const artists = screen.getAllByText(/Act$/).map((el) => el.textContent);
    expect(artists).toEqual(['First Act', 'Second Act']);
    expect(screen.getByText('No map pin')).toBeInTheDocument();
    expect(mockPreview).toHaveBeenCalledWith('f1');
    expect(spy).not.toHaveBeenCalled();
  });
});
