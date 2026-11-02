import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Mock TanStack Router
const mockNavigate = vi.fn();
vi.mock('@tanstack/react-router', () => ({
  useLocation: vi.fn(() => ({ pathname: '/cards' })),
  useNavigate: vi.fn(() => mockNavigate),
  Link: ({ to, children, ...rest }: { to: string; children: React.ReactNode; [k: string]: unknown }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

// Mock auth store
const mockAuthStore = vi.fn();
let mockConnected = true;
const mockFestival = { scheduleView: null as string | null, sets: [], days: [], currentFestival: null };
vi.mock('@festie/shared', () => ({
  useFestivalStore: (selector: (s: typeof mockFestival) => unknown) => selector(mockFestival),
  useAuthStore: (selector: (s: { user: unknown }) => unknown) => selector({ user: mockAuthStore() }),
  useUIStore: (selector: (s: { connected: boolean }) => unknown) => selector({ connected: mockConnected }),
}));

vi.mock('@festie/shared/utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@festie/shared/utils')>()),
}));

// Mock UserMenu to avoid complex child rendering
vi.mock('./UserMenu', () => ({
  default: ({ user }: { user: { username: string } }) => <div data-testid="user-menu">{user.username}</div>,
}));

// Mock FestivalModeToggle
vi.mock('../features/FestivalModeToggle', () => ({
  default: () => <div data-testid="festival-mode-toggle" />,
}));

import Header from './Header';
import { useUIStore as useRealUIStore } from '@festie/shared/stores/uiStore';
import { useLocation } from '@tanstack/react-router';

describe('Header', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthStore.mockReturnValue(null);
    mockConnected = true;
    mockFestival.scheduleView = null;
    document.documentElement.removeAttribute('data-theme');
  });

  it('renders the FESTIE logo', () => {
    render(<Header />);
    expect(screen.getByLabelText('FESTIE home')).toBeInTheDocument();
    expect(screen.getByText('FESTIE')).toBeInTheDocument();
  });

  it('renders connection status indicator for signed-in users', () => {
    mockAuthStore.mockReturnValue({ id: '1', username: 'test' });
    render(<Header />);
    expect(screen.getByRole('status', { name: 'Connected' })).toBeInTheDocument();
    expect(screen.queryByText('Offline')).not.toBeInTheDocument();
  });

  it('hides the connection indicator for guests', () => {
    render(<Header />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows an Offline label next to the dot when a signed-in user is disconnected', () => {
    mockAuthStore.mockReturnValue({ id: '1', username: 'test' });
    mockConnected = false;
    render(<Header />);
    expect(screen.getByRole('status', { name: 'Disconnected' })).toBeInTheDocument();
    expect(screen.getByText('Offline')).toBeInTheDocument();
  });

  it('renders main navigation landmark', () => {
    render(<Header />);
    expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeInTheDocument();
  });

  describe('desktop tabs for guest users', () => {
    it('shows Lineup, Picks, Crew and Map but no More button', () => {
      mockAuthStore.mockReturnValue(null);
      render(<Header />);
      for (const name of ['Lineup', 'Picks', 'Crew', 'Map']) {
        expect(screen.getByRole('link', { name })).toBeInTheDocument();
      }
      expect(screen.queryByRole('link', { name: 'More' })).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'Timeline' })).not.toBeInTheDocument();
    });
  });

  describe('desktop tabs for logged-in users', () => {
    it('shows the five sections in shared order', () => {
      mockAuthStore.mockReturnValue({ id: '1', username: 'test' });
      render(<Header />);
      const nav = screen.getByRole('navigation', { name: 'Main navigation' });
      expect(within(nav).getAllByRole('link').map((b) => b.textContent)).toEqual([
        'Lineup',
        'Picks',
        'Crew',
        'Map',
        'More',
      ]);
    });

    it('has no Wrap tab', () => {
      mockAuthStore.mockReturnValue({ id: '1', username: 'test' });
      render(<Header />);
      expect(screen.queryByRole('link', { name: 'Wrap' })).not.toBeInTheDocument();
    });
  });

  it('sends the Lineup tab to the remembered view', () => {
    mockFestival.scheduleView = 'grid';
    render(<Header />);
    expect(screen.getByRole('link', { name: 'Lineup' })).toHaveAttribute('href', '/grid');
  });

  describe('active tab detection', () => {
    it('marks Lineup as active on /cards', () => {
      vi.mocked(useLocation).mockReturnValue({ pathname: '/cards' } as ReturnType<typeof useLocation>);
      render(<Header />);
      expect(screen.getByRole('link', { name: 'Lineup' })).toHaveAttribute('aria-current', 'page');
    });

    it('marks Lineup as active on /', () => {
      vi.mocked(useLocation).mockReturnValue({ pathname: '/' } as ReturnType<typeof useLocation>);
      render(<Header />);
      expect(screen.getByRole('link', { name: 'Lineup' })).toHaveAttribute('aria-current', 'page');
    });

    it('keeps Lineup active on the timeline and grid views', () => {
      vi.mocked(useLocation).mockReturnValue({ pathname: '/timeline' } as ReturnType<typeof useLocation>);
      render(<Header />);
      expect(screen.getByRole('link', { name: 'Lineup' })).toHaveAttribute('aria-current', 'page');
    });

    it('keeps Crew active on /crew-plan', () => {
      vi.mocked(useLocation).mockReturnValue({ pathname: '/crew-plan' } as ReturnType<typeof useLocation>);
      render(<Header />);
      expect(screen.getByRole('link', { name: 'Crew' })).toHaveAttribute('aria-current', 'page');
    });
  });

  describe('tab navigation', () => {
    it('renders tabs as real links', () => {
      mockAuthStore.mockReturnValue({ id: '1', username: 'test' });
      render(<Header />);
      expect(screen.getByRole('link', { name: 'Picks' })).toHaveAttribute('href', '/picks');
    });
  });

  describe('theme preference', () => {
    beforeEach(() => {
      act(() => useRealUIStore.getState().setTheme('stage'));
      document.head.insertAdjacentHTML('beforeend', '<meta name="theme-color" content="#080810" />');
    });

    it('renders the Daylight toggle, unpressed by default', () => {
      render(<Header />);
      expect(screen.getByLabelText('Daylight mode')).toHaveAttribute('aria-pressed', 'false');
    });

    it('stage theme leaves data-theme unset and keeps the dark chrome colour', () => {
      document.documentElement.setAttribute('data-theme', 'daylight');
      render(<Header />);
      expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
      expect(document.documentElement.style.colorScheme).toBe('dark');
      expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe('#0a0a0a');
    });

    it('tapping the toggle switches to daylight and back', async () => {
      const user = userEvent.setup();
      render(<Header />);
      await user.click(screen.getByLabelText('Daylight mode'));
      expect(document.documentElement.dataset.theme).toBe('daylight');
      expect(document.documentElement.style.colorScheme).toBe('light');
      expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe('#f4f4f7');
      expect(screen.getByLabelText('Daylight mode')).toHaveAttribute('aria-pressed', 'true');
      await user.click(screen.getByLabelText('Daylight mode'));
      expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    });
  });

  describe('user menu', () => {
    it('renders UserMenu when user is logged in', () => {
      mockAuthStore.mockReturnValue({ id: '1', username: 'alice' });
      render(<Header />);
      expect(screen.getByTestId('user-menu')).toBeInTheDocument();
      expect(screen.getByText('alice')).toBeInTheDocument();
    });

    it('does not render UserMenu when user is not logged in', () => {
      mockAuthStore.mockReturnValue(null);
      render(<Header />);
      expect(screen.queryByTestId('user-menu')).not.toBeInTheDocument();
    });
  });

  it('hides the Install App button until a prompt is captured', () => {
    render(<Header />);
    // No beforeinstallprompt has fired (Firefox/Safari/jsdom): button no-ops, so
    // it must not render.
    expect(screen.queryByTestId('install-app-btn')).not.toBeInTheDocument();
  });

  it('reveals the Install App button after beforeinstallprompt fires', () => {
    render(<Header />);
    const evt = new Event('beforeinstallprompt');
    Object.assign(evt, { prompt: vi.fn(), userChoice: Promise.resolve({ outcome: 'accepted' }) });
    act(() => {
      window.dispatchEvent(evt);
    });
    expect(screen.getByTestId('install-app-btn')).toBeInTheDocument();
  });

  describe('guest sign-in entry', () => {
    it('renders a Sign in link to /login for guests', () => {
      mockAuthStore.mockReturnValue(null);
      render(<Header />);
      const link = screen.getByRole('link', { name: 'Sign in' });
      expect(link).toHaveAttribute('href', '/login');
    });

    it('does not render the Sign in link when logged in', () => {
      mockAuthStore.mockReturnValue({ id: '1', username: 'alice' });
      render(<Header />);
      expect(screen.queryByRole('link', { name: 'Sign in' })).not.toBeInTheDocument();
    });
  });

  it('renders Support Me link', () => {
    render(<Header />);
    const link = screen.getByText(/Support Me/);
    expect(link).toBeInTheDocument();
    expect(link.closest('a')).toHaveAttribute('href', 'https://paypal.me/uhsear');
  });

  it('renders FestivalModeToggle', () => {
    render(<Header />);
    expect(screen.getByTestId('festival-mode-toggle')).toBeInTheDocument();
  });
});
