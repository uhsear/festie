import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const state: Record<string, unknown> = {};
const nav = vi.fn();
let nowMs = 0;

vi.mock('@festie/shared/stores', () => ({
  useFestivalStore: (sel: (s: Record<string, unknown>) => unknown) => sel(state),
  useAuthStore: (sel: (s: Record<string, unknown>) => unknown) => sel(state),
}));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => nav }));
vi.mock('../../hooks/useSetStatus', () => ({ useNow: () => nowMs }));

import NowNextStrip from './NowNextStrip';

const local = (y: number, mo: number, d: number, h: number, mi = 0) => new Date(y, mo, d, h, mi).getTime();
const mk = (id: string, date: string, startTime: string, endTime: string, dayIndex: number) => ({
  id,
  artist: id === 'a' ? 'Alpha' : 'Beta',
  stageId: 'st1',
  startTime,
  endTime,
  dayIndex,
  date,
});

describe('NowNextStrip', () => {
  beforeEach(() => {
    nav.mockClear();
    Object.assign(state, {
      user: { id: 'u1' },
      stages: [{ id: 'st1', name: 'Main Stage' }],
      days: [
        { id: 'd1', date: '2030-06-15', dayIndex: 0 },
        { id: 'd2', date: '2030-06-16', dayIndex: 1 },
      ],
      sets: [mk('a', '2030-06-15', '20:00', '21:00', 0), mk('b', '2030-06-16', '20:00', '21:00', 1)],
      currentProfile: { id: 'p1', picks: { a: 'must', b: 'must' } },
      currentFestival: { id: 'f1', name: 'Fest' },
    });
  });

  it('shows NOW with time left for a pick playing now and navigates on click', () => {
    nowMs = local(2030, 5, 15, 20, 48);
    render(<NowNextStrip />);
    const strip = screen.getByTestId('now-next-strip');
    expect(strip).toHaveTextContent('NOW');
    expect(strip).toHaveTextContent('Alpha');
    expect(strip).toHaveTextContent('Main Stage');
    expect(strip).toHaveTextContent('12m left');
    expect(strip).toHaveAttribute('aria-label', 'Now playing: Alpha at Main Stage, 12m left. Open Now and Next.');
    fireEvent.click(strip);
    expect(nav).toHaveBeenCalledWith({ to: '/festival-mode' });
  });

  it('shows UP NEXT with minutes for a pick later the same day', () => {
    nowMs = local(2030, 5, 15, 19, 35);
    render(<NowNextStrip />);
    const strip = screen.getByTestId('now-next-strip');
    expect(strip).toHaveTextContent('UP NEXT');
    expect(strip).toHaveTextContent('in 25m');
  });

  it('shows the weekday and clock for a pick on another day', () => {
    nowMs = local(2030, 5, 15, 21, 30);
    render(<NowNextStrip />);
    const strip = screen.getByTestId('now-next-strip');
    expect(strip).toHaveTextContent('UP NEXT');
    expect(strip).toHaveTextContent('Beta');
    expect(strip).toHaveTextContent(/Sun/);
  });

  it('renders nothing for a guest', () => {
    nowMs = local(2030, 5, 15, 20, 48);
    state.user = null;
    render(<NowNextStrip />);
    expect(screen.queryByTestId('now-next-strip')).not.toBeInTheDocument();
  });

  it('renders nothing without picks', () => {
    nowMs = local(2030, 5, 15, 20, 48);
    state.currentProfile = { id: 'p1', picks: {} };
    render(<NowNextStrip />);
    expect(screen.queryByTestId('now-next-strip')).not.toBeInTheDocument();
  });
});
