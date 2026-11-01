import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useFestivalModeStore } from '@festie/shared';
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
