import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useFestivalModeStore } from '@festie/shared';
import { useFestivalStore } from '@festie/shared/stores';
import FestivalModeToggle from './FestivalModeToggle';

let mockPathname = '/cards';
vi.mock('@tanstack/react-router', () => ({
  useLocation: () => ({ pathname: mockPathname }),
  Link: ({ to, children, ...rest }: { to: string; children: React.ReactNode; [k: string]: unknown }) => (
    <a
      href={to}
      {...rest}
      onClick={(e) => {
        e.preventDefault();
        (rest.onClick as (() => void) | undefined)?.();
      }}
    >
      {children}
    </a>
  ),
}));

describe('FestivalModeToggle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useFestivalModeStore.setState({ lowPowerMode: false });
  });

  it('renders a link to /festival-mode with no aria-current elsewhere', () => {
    mockPathname = '/cards';
    render(<FestivalModeToggle />);
    const link = screen.getByTestId('festival-mode-toggle');
    expect(link).toHaveAttribute('href', '/festival-mode');
    expect(link).not.toHaveAttribute('aria-current');
  });

  it('keeps its name when the text hides below 360px', () => {
    mockPathname = '/cards';
    render(<FestivalModeToggle />);
    const link = screen.getByTestId('festival-mode-toggle');
    expect(link).toHaveAccessibleName('Now & Next');
    expect(screen.getByText('Now & Next')).toHaveClass('max-[359px]:hidden');
  });

  it('glows on /festival-mode only while the festival is on', () => {
    mockPathname = '/festival-mode';
    const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
    const set = (offset: number) =>
      useFestivalStore.setState({ currentFestival: { id: 'f1', name: 'F' } as never, days: [{ id: 'd1', label: 'D', date: day(offset) }] as never });
    set(30);
    const { unmount } = render(<FestivalModeToggle />);
    expect(screen.getByTestId('festival-mode-toggle')).toHaveClass('bg-accent-aqua');
    expect(screen.getByTestId('festival-mode-toggle')).not.toHaveClass('shadow-lg');
    unmount();
    set(0);
    render(<FestivalModeToggle />);
    expect(screen.getByTestId('festival-mode-toggle')).toHaveClass('shadow-lg');
    useFestivalStore.setState({ currentFestival: null, days: [] });
  });

  it('marks aria-current=page on /festival-mode', () => {
    mockPathname = '/festival-mode';
    render(<FestivalModeToggle />);
    expect(screen.getByTestId('festival-mode-toggle')).toHaveAttribute('aria-current', 'page');
  });

  it('does not change store state on click', async () => {
    mockPathname = '/cards';
    const before = useFestivalModeStore.getState();
    render(<FestivalModeToggle />);
    await userEvent.click(screen.getByTestId('festival-mode-toggle'));
    expect(useFestivalModeStore.getState()).toBe(before);
  });
});
