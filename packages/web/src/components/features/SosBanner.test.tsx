import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import type { SosEntry } from '@festie/shared/types';

const mockNavigate = vi.fn();
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => mockNavigate }));
vi.mock('@festie/shared/stores', () => ({
  useAuthStore: (selector: (s: { user: { id: string } }) => unknown) => selector({ user: { id: 'me' } }),
}));
let entries: SosEntry[] = [];
vi.mock('@festie/shared/hooks', () => ({ useActiveSos: () => entries, useLiveLocationCrewSync: () => {} }));

import SosBanner from './SosBanner';

describe('SosBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-12T21:04:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('renders nothing without an active SOS', () => {
    entries = [];
    const { container } = render(<SosBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('names who and when, announces once, and opens the map on the newest raiser', () => {
    entries = [{ crewId: 'c1', userId: 'dani', username: 'Dani', raisedAt: '2026-06-12T21:00:00Z' }];
    render(<SosBanner />);
    expect(screen.getByRole('alert')).toHaveTextContent('Dani needs help');
    // The live region carries no clock, so the minute tick never re-announces.
    expect(screen.getByRole('alert')).not.toHaveTextContent('ago');
    const button = screen.getByRole('button', { name: /Dani needs help, SOS 4m ago/ });
    // Not dismissible: the only control opens the crew.
    expect(screen.getAllByRole('button')).toHaveLength(1);
    fireEvent.click(button);
    expect(mockNavigate).toHaveBeenCalledWith({ to: '/crew', search: { sos: 'dani' } });
  });

  it('summarises several raisers', () => {
    entries = [
      { crewId: 'c1', userId: 'dani', username: 'Dani', raisedAt: '2026-06-12T21:00:00Z' },
      { crewId: 'c1', userId: 'sam', username: 'Sam', raisedAt: '2026-06-12T20:00:00Z' },
    ];
    render(<SosBanner />);
    expect(screen.getByRole('alert')).toHaveTextContent('Dani and 1 other need help');
  });

  it('shows who has seen my own SOS', () => {
    entries = [
      {
        crewId: 'c1',
        userId: 'me',
        username: 'Me',
        raisedAt: '2026-06-12T21:00:00Z',
        seenBy: [
          { userId: 'a', username: 'A' },
          { userId: 'b', username: 'B' },
        ],
      },
    ];
    render(<SosBanner />);
    expect(screen.getByText(/Seen by A and B/)).toBeInTheDocument();
    expect(screen.getByRole('button')).toHaveAccessibleName(/Seen by A and B/);
  });

  it("shows no seen text on someone else's SOS", () => {
    entries = [{ crewId: 'c1', userId: 'dani', username: 'Dani', raisedAt: '2026-06-12T21:00:00Z' }];
    render(<SosBanner />);
    expect(screen.queryByText(/Seen by|Not seen yet/)).toBeNull();
  });

  describe('arrival', () => {
    const animate = vi.fn();
    const arrive = () => {
      entries = [{ crewId: 'c1', userId: 'dani', username: 'Dani', raisedAt: '2026-06-12T21:00:00Z' }];
    };
    beforeEach(() => {
      animate.mockClear();
      Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animate });
    });
    afterEach(() => {
      Reflect.deleteProperty(HTMLElement.prototype, 'animate');
      Reflect.deleteProperty(window, 'matchMedia');
    });

    it('floats from a zero-height slot, so it never moves the content below it', () => {
      arrive();
      render(<SosBanner />);
      const slot = screen.getByTestId('sos-banner');
      expect(slot).toHaveClass('h-0');
      expect(screen.getByRole('button').parentElement).toHaveClass('absolute');
    });

    it('shrinks to a corner pill once the arrival flash is over, so the rows under it stay tappable', () => {
      arrive();
      render(<SosBanner />);
      const wrap = screen.getByRole('button').parentElement!;
      expect(wrap).toHaveClass('inset-x-0');
      act(() => void vi.advanceTimersByTime(10_000));
      expect(wrap).not.toHaveClass('inset-x-0');
      expect(wrap).toHaveClass('right-2', 'max-w-[40vw]');
    });

    it('flashes twice on arrival, once per new raiser, not on the minute tick', () => {
      arrive();
      render(<SosBanner />);
      expect(animate).toHaveBeenCalledTimes(1);
      expect(animate.mock.calls[0]![1]).toMatchObject({ iterations: 2 });
      act(() => void vi.advanceTimersByTime(60_000));
      expect(animate).toHaveBeenCalledTimes(1);
    });

    it('does not flash under reduced motion', () => {
      window.matchMedia = ((q: string) => ({
        matches: q.includes('reduce'),
        media: q,
        addEventListener: () => {},
        removeEventListener: () => {},
      })) as unknown as typeof window.matchMedia;
      arrive();
      render(<SosBanner />);
      expect(screen.getByRole('button')).toBeInTheDocument();
      expect(animate).not.toHaveBeenCalled();
    });
  });
});
