import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import ScheduleViewSwitcher from './ScheduleViewSwitcher';

let mockPathname = '/timeline';
vi.mock('@tanstack/react-router', () => ({
  useLocation: () => ({ pathname: mockPathname }),
  useNavigate: () => vi.fn(),
}));

const setScheduleView = vi.fn();
vi.mock('@festie/shared', () => ({
  useFestivalStore: (selector: (s: unknown) => unknown) => selector({ scheduleView: null, setScheduleView }),
}));

describe('ScheduleViewSwitcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists Cards, Timeline, Grid in order', () => {
    render(<ScheduleViewSwitcher />);
    const labels = screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'));
    expect(labels).toEqual(['Cards view', 'Timeline view', 'Grid view']);
  });

  it('records the view on a view route', () => {
    mockPathname = '/timeline';
    render(<ScheduleViewSwitcher />);
    expect(setScheduleView).toHaveBeenCalledWith('timeline');
  });

  it('does not record the / alias', () => {
    mockPathname = '/';
    render(<ScheduleViewSwitcher />);
    expect(setScheduleView).not.toHaveBeenCalled();
  });
});
