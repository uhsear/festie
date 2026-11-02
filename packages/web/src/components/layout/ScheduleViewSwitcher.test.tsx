import type React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import ScheduleViewSwitcher from './ScheduleViewSwitcher';

const mockLocation = { pathname: '/grid' };

vi.mock('@tanstack/react-router', () => ({
  useLocation: () => mockLocation,
  Link: ({ to, children, ...rest }: { to: string; children: React.ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

const setScheduleView = vi.fn();
vi.mock('@festie/shared', () => ({
  useFestivalStore: (selector: (s: unknown) => unknown) => selector({ scheduleView: null, setScheduleView }),
}));

describe('ScheduleViewSwitcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders two links and marks only the current view', () => {
    mockLocation.pathname = '/grid';
    render(<ScheduleViewSwitcher />);
    expect(screen.getAllByRole('link')).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'Cards' })).toHaveAttribute('href', '/cards');
    expect(screen.getByRole('link', { name: 'Grid' })).toHaveAttribute('href', '/grid');
    expect(screen.getByRole('link', { name: 'Grid' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Cards' })).not.toHaveAttribute('aria-current');
  });

  it('lists Cards, Grid in order', () => {
    render(<ScheduleViewSwitcher />);
    expect(screen.getAllByRole('link').map((l) => l.textContent)).toEqual(['Cards', 'Grid']);
  });

  it('treats / as the cards view', () => {
    mockLocation.pathname = '/';
    render(<ScheduleViewSwitcher />);
    expect(screen.getByRole('link', { name: 'Cards' })).toHaveAttribute('aria-current', 'page');
  });

  it('records the view on a view route', () => {
    mockLocation.pathname = '/grid';
    render(<ScheduleViewSwitcher />);
    expect(setScheduleView).toHaveBeenCalledWith('grid');
  });

  it('does not record the / alias', () => {
    mockLocation.pathname = '/';
    render(<ScheduleViewSwitcher />);
    expect(setScheduleView).not.toHaveBeenCalled();
  });
});
