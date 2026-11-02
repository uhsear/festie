import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ACCOUNT_SECTIONS } from '@festie/shared/constants';

// Mock the router — account.tsx redirects to /login via useNavigate when no user.
const mockNavigate = vi.fn().mockResolvedValue(undefined);
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
  Link: ({ children, to, ...rest }: { children: React.ReactNode; to: string }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

// account.tsx imports the auth store from the deep path, not the barrel.
const storeState: Record<string, unknown> = {};
vi.mock('@festie/shared/stores/authStore', () => ({
  useAuthStore: vi.fn((sel: (s: Record<string, unknown>) => unknown) => sel(storeState)),
}));

// Stub the section sub-components and Avatar so the page is isolated; we only
// assert that each section renders, not its internals (covered by their own tests).
vi.mock('../components/account/ProfileSection', () => ({
  default: () => <div data-testid="profile-section" />,
}));
vi.mock('../components/account/PasswordSection', () => ({
  default: () => <div data-testid="password-section" />,
}));
vi.mock('../components/account/NotificationSection', () => ({
  default: () => <div data-testid="notification-section" />,
}));
vi.mock('../components/account/NotificationPrefsSection', () => ({
  default: () => <div data-testid="notification-prefs-section" />,
}));
vi.mock('../components/account/DangerZone', () => ({
  default: () => <div data-testid="danger-zone" />,
}));
vi.mock('../components/account/PaymentHandlesSection', () => ({
  default: () => <div data-testid="payment-handles-section" />,
}));
vi.mock('../components/account/PublicScheduleSection', () => ({
  default: () => <div data-testid="public-schedule-section" />,
}));
vi.mock('../components/account/ReplayIntroRow', () => ({
  default: () => <div data-testid="replay-intro-row" />,
}));
vi.mock('../components/account/HistorySection', () => ({
  default: () => <div data-testid="history-section" />,
}));
vi.mock('../components/account/AccountIdentityCard', () => ({
  default: () => <div data-testid="identity-card" />,
}));
vi.mock('../components/account/EmailSection', () => ({
  default: () => <div data-testid="email-section" />,
}));
vi.mock('../components/account/ThemeSection', () => ({
  default: () => <div data-testid="theme-section" />,
}));
vi.mock('../components/account/HapticsSection', () => ({
  default: () => <div data-testid="haptics-section" />,
}));
vi.mock('../components/account/DataExportSection', () => ({
  default: () => <div data-testid="data-export-section" />,
}));
vi.mock('../components/features/LowPowerToggle', () => ({
  default: () => <div data-testid="low-power-toggle" />,
}));

// Pass-through error boundary so a render throw isn't swallowed in tests.
vi.mock('../components/layout/RouteErrorBoundary', () => ({
  RenderErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import AccountPage from './account';

const mockLogout = vi.fn().mockResolvedValue(undefined);

function setStoreState(overrides: Record<string, unknown> = {}) {
  Object.keys(storeState).forEach((k) => delete storeState[k]);
  Object.assign(storeState, {
    user: {
      id: 'u1',
      name: 'Test User',
      username: 'testuser',
      email: 'test@festie.us',
    },
    isAdmin: false,
    logout: mockLogout,
    ...overrides,
  });
}

describe('AccountPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setStoreState();
  });

  it('renders the identity card and the page title', () => {
    render(<AccountPage />);
    expect(screen.getByTestId('identity-card')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Account' })).toBeInTheDocument();
  });

  it('redirects to /login when there is no user', () => {
    setStoreState({ user: null });
    const { container } = render(<AccountPage />);
    expect(mockNavigate).toHaveBeenCalledWith({ to: '/login' });
    // Inner component returns null while the redirect is in-flight.
    expect(container.firstChild).toBeNull();
  });

  it('renders all section sub-components when logged in', () => {
    render(<AccountPage />);
    expect(screen.getByTestId('profile-section')).toBeInTheDocument();
    expect(screen.getByTestId('password-section')).toBeInTheDocument();
    expect(screen.getByTestId('notification-section')).toBeInTheDocument();
    expect(screen.getByTestId('notification-prefs-section')).toBeInTheDocument();
    expect(screen.getByTestId('danger-zone')).toBeInTheDocument();
  });

  const labels = ACCOUNT_SECTIONS.filter((sec) => sec.label !== '');

  it('renders the section headings in ACCOUNT_SECTIONS order, without Admin for a normal user', () => {
    render(<AccountPage />);
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(labels.filter((sec) => !('adminOnly' in sec)).map((sec) => sec.label));
  });

  it('shows Admin after Help and legal for an admin', () => {
    setStoreState({ isAdmin: true });
    render(<AccountPage />);
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(labels.map((sec) => sec.label));
    expect(screen.getByRole('link', { name: /Admin/ })).toHaveAttribute('href', '/admin');
  });

  it('confirms before signing out, then logs out and goes to /login', async () => {
    const user = userEvent.setup();
    render(<AccountPage />);
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(mockLogout).not.toHaveBeenCalled();
    // Radix hides the page behind the open dialog, so only the confirm button matches.
    await user.click(await screen.findByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(mockLogout).toHaveBeenCalledTimes(1));
    expect(mockNavigate).toHaveBeenCalledWith({ to: '/login' });
  });
});
