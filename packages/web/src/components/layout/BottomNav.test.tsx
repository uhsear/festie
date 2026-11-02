import type React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import BottomNav from './BottomNav';

const mockLocation = { pathname: '/cards' };

vi.mock('@tanstack/react-router', () => ({
  useLocation: () => mockLocation,
  Link: ({ to, children, ...rest }: { to: string; children: React.ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

let mockUser: { id: string; username: string } | null = null;
vi.mock('@festie/shared', () => ({
  useAuthStore: (selector: (s: { user: typeof mockUser }) => unknown) => selector({ user: mockUser }),
}));

vi.mock('@festie/shared/utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@festie/shared/utils')>()),
  isFestivalOver: () => true,
}));

describe('BottomNav', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUser = null;
    mockLocation.pathname = '/cards';
  });

  it('renders the five sections in shared order for a signed-in user', () => {
    mockUser = { id: 'u1', username: 'alice' };
    render(<BottomNav />);
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((l) => l.getAttribute('aria-label'))).toEqual([
      'View Lineup',
      'View Picks',
      'View Crew',
      'View Map',
      'View More',
    ]);
    expect(links.map((l) => l.getAttribute('href'))).toEqual(['/cards', '/picks', '/crew', '/map', '/account']);
  });

  it('shows all five slots for guests, with Sign in in the More slot', () => {
    render(<BottomNav />);
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    expect(within(nav).getAllByRole('link')).toHaveLength(5);
    expect(screen.getByLabelText('View Sign in')).toHaveTextContent('Sign in');
    expect(screen.getByLabelText('View Sign in')).toHaveAttribute('href', '/login');
    expect(screen.queryByLabelText('View More')).not.toBeInTheDocument();
  });

  it('never renders a Wrap tab, even when the festival is over', () => {
    mockUser = { id: 'u1', username: 'alice' };
    render(<BottomNav />);
    expect(screen.queryByLabelText('View Wrap')).not.toBeInTheDocument();
  });

  it('marks the active item with aria-current=page', () => {
    render(<BottomNav />);
    expect(screen.getByLabelText('View Lineup')).toHaveAttribute('aria-current', 'page');
  });

  it('does not mark inactive items as current', () => {
    mockUser = { id: 'u1', username: 'alice' };
    render(<BottomNav />);
    expect(screen.getByLabelText('View Crew')).not.toHaveAttribute('aria-current');
  });

  it('treats "/" as equivalent to "/cards" for active state', () => {
    mockLocation.pathname = '/';
    render(<BottomNav />);
    expect(screen.getByLabelText('View Lineup')).toHaveAttribute('aria-current', 'page');
  });

  it('keeps Lineup active across the timeline and grid views', () => {
    mockLocation.pathname = '/timeline';
    const { unmount } = render(<BottomNav />);
    expect(screen.getByLabelText('View Lineup')).toHaveAttribute('aria-current', 'page');
    unmount();
    mockLocation.pathname = '/grid';
    render(<BottomNav />);
    expect(screen.getByLabelText('View Lineup')).toHaveAttribute('aria-current', 'page');
  });

  it('keeps Crew active on /compare and /crew-plan', () => {
    mockUser = { id: 'u1', username: 'alice' };
    mockLocation.pathname = '/compare';
    const { unmount } = render(<BottomNav />);
    expect(screen.getByLabelText('View Crew')).toHaveAttribute('aria-current', 'page');
    unmount();
    mockLocation.pathname = '/crew-plan';
    render(<BottomNav />);
    expect(screen.getByLabelText('View Crew')).toHaveAttribute('aria-current', 'page');
  });

  it('renders tabs as real links with hrefs', () => {
    render(<BottomNav />);
    expect(screen.getByRole('link', { name: 'View Lineup' })).toHaveAttribute('href', '/cards');
  });

  it('renders a navigation landmark', () => {
    render(<BottomNav />);
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeInTheDocument();
  });

  it('keeps every nav item keyboard-reachable (no roving tabindex)', () => {
    mockUser = { id: 'u1', username: 'alice' };
    render(<BottomNav />);
    expect(screen.getByLabelText('View Lineup')).not.toHaveAttribute('tabindex', '-1');
    expect(screen.getByLabelText('View Crew')).not.toHaveAttribute('tabindex', '-1');
  });

  it('gives Picks its own icon, not the star', () => {
    mockUser = { id: 'u1', username: 'alice' };
    render(<BottomNav />);
    const picks = screen.getByLabelText('View Picks').querySelector('svg')!;
    expect(picks.getAttribute('class')).toContain('lucide-list-checks');
    expect(picks.getAttribute('class')).not.toContain('lucide-star');
  });

  it('renders label text for each section', () => {
    mockUser = { id: 'u1', username: 'alice' };
    render(<BottomNav />);
    for (const label of ['Lineup', 'Picks', 'Crew', 'Map', 'More']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });
});
