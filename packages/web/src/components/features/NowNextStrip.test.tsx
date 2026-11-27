import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const state: Record<string, unknown> = {};
const nav = vi.fn();
let nowMs = 0;

vi.mock('@festie/shared/stores', () => ({
  useFestivalStore: (sel: (s: Record<string, unknown>) => unknown) => sel(state),
  useAuthStore: (sel: (s: Record<string, unknown>) => unknown) => sel(state),
}));
vi.mock('@festie/shared/hooks', () => ({
  useFestival: () => ({
    getStageName: (id: string) => (state.stages as { id: string; name: string }[]).find((s) => s.id === id)?.name,
  }),
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

  it('hides on another day while the festival runs, and shows on the live day', () => {
    nowMs = local(2030, 5, 15, 20, 48);
    state.selectedDay = 1;
    const { unmount } = render(<NowNextStrip />);
    expect(screen.queryByTestId('now-next-strip')).toBeNull();
    unmount();
    state.selectedDay = 0;
    render(<NowNextStrip />);
    expect(screen.getByTestId('now-next-strip')).toBeInTheDocument();
    delete state.selectedDay;
  });

  it('shows NOW with time left for a pick playing now and navigates on click', () => {
    nowMs = local(2030, 5, 15, 20, 48);
    render(<NowNextStrip />);
    const strip = screen.getByTestId('now-next-strip');
    expect(strip).toHaveTextContent('NOW');
    expect(strip).toHaveTextContent('Alpha');
    expect(strip).toHaveTextContent('Main Stage');
    expect(strip).toHaveTextContent('12m left');
    fireEvent.click(screen.getByRole('button', { name: 'Now playing: Alpha at Main Stage, 12m left. Open Now and Next.' }));
    expect(nav).toHaveBeenCalledWith({ to: '/festival-mode' });
  });

  it('wraps the artist name on two lines and truncates only the stage', () => {
    nowMs = local(2030, 5, 15, 20, 48);
    render(<NowNextStrip />);
    expect(screen.getByText('Alpha').closest('.line-clamp-2')).not.toBeNull();
    expect(screen.getByText('Main Stage')).toHaveClass('truncate');
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

  it('draws a 4px progress bar inset from the rounded corners', () => {
    nowMs = local(2030, 5, 15, 20, 30);
    render(<NowNextStrip />);
    const fill = screen.getByTestId('now-next-progress');
    expect(fill).toHaveStyle({ width: '50%' });
    expect(fill.parentElement).toHaveClass('h-1', 'inset-x-3', 'rounded-full');
  });

  it('keeps the time left right after the title and ends with a chevron, so a wide screen reads as one unit', () => {
    nowMs = local(2030, 5, 15, 20, 48);
    render(<NowNextStrip />);
    const title = screen.getByText('Alpha').closest<HTMLElement>('[class*="max-w-[720px]"]')!;
    expect(title).toHaveClass('max-w-[720px]');
    expect(title).not.toHaveClass('flex-1');
    expect(title.parentElement!.querySelector('svg')).toHaveClass('ml-auto');
  });

  it("says NOW is today's when another day's tab is open, and nothing extra on today's own tab", () => {
    nowMs = local(2030, 5, 15, 20, 48);
    state.selectedDay = 1;
    const { unmount } = render(<NowNextStrip />);
    expect(screen.getByTestId('now-next-strip')).toHaveTextContent('NOW · TODAY');
    unmount();
    state.selectedDay = 0;
    render(<NowNextStrip />);
    expect(screen.getByTestId('now-next-strip')).not.toHaveTextContent('TODAY');
    delete state.selectedDay;
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
