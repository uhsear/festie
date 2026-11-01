import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Mock dependencies
const mockNavigate = vi.fn().mockResolvedValue(undefined);
let mockSearch: { reset?: true } = {};
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
  useSearch: () => mockSearch,
  Link: ({ to, children, ...rest }: { to: string; children: React.ReactNode; [k: string]: unknown }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('@festie/shared', () => ({
  useAuth: vi.fn(() => ({
    login: vi.fn(),
    isLoading: false,
    error: null,
  })),
}));

const mockToast = vi.fn();
vi.mock('../lib/toastContext', () => ({
  useToast: () => ({ toast: mockToast }),
}));

vi.mock('../components/layout/RouteErrorBoundary', () => ({
  RenderErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import LoginPage from './login';
import { useAuth } from '@festie/shared';

describe('LoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearch = {};
    vi.mocked(useAuth).mockReturnValue({
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      forgotPassword: vi.fn(),
      changePassword: vi.fn(),
      uploadAvatar: vi.fn(),
      removeAvatar: vi.fn(),
      isLoading: false,
      error: null,
    });
  });

  it('renders the FESTIE logo', () => {
    render(<LoginPage />);
    expect(screen.getByText('FESTIE')).toBeInTheDocument();
  });

  it('renders the tagline', () => {
    render(<LoginPage />);
    expect(screen.getByText('Plan your sets. Sync with your crew.')).toBeInTheDocument();
  });

  it('renders Sign in and Create account tabs', () => {
    render(<LoginPage />);
    // Both auth-method segments are nav links now; "Sign in" also appears on the
    // submit button, so scope to the link role.
    expect(screen.getByRole('link', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create account' })).toBeInTheDocument();
  });

  it('renders username and password inputs', () => {
    render(<LoginPage />);
    expect(screen.getByLabelText('Username')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
  });

  it('renders the sign in button', () => {
    render(<LoginPage />);
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('renders Forgot password link', () => {
    render(<LoginPage />);
    expect(screen.getByText('Forgot password?')).toBeInTheDocument();
  });

  it('shows "Username is required" when submitting with empty fields', async () => {
    const user = userEvent.setup();
    render(<LoginPage />);
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Username is required');
  });

  it('shows "Password is required" when username is filled but password is empty', async () => {
    const user = userEvent.setup();
    render(<LoginPage />);
    await user.type(screen.getByLabelText('Username'), 'testuser');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Password is required');
  });

  it('shows loading state when isLoading is true', () => {
    vi.mocked(useAuth).mockReturnValue({
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      forgotPassword: vi.fn(),
      changePassword: vi.fn(),
      uploadAvatar: vi.fn(),
      removeAvatar: vi.fn(),
      isLoading: true,
      error: null,
    });
    render(<LoginPage />);
    expect(screen.getByText('Signing in…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Signing in…' })).toBeDisabled();
  });

  it('calls login with username and password on valid submit', async () => {
    const mockLogin = vi.fn().mockResolvedValue(undefined);
    vi.mocked(useAuth).mockReturnValue({
      login: mockLogin,
      register: vi.fn(),
      logout: vi.fn(),
      forgotPassword: vi.fn(),
      changePassword: vi.fn(),
      uploadAvatar: vi.fn(),
      removeAvatar: vi.fn(),
      isLoading: false,
      error: null,
    });
    const user = userEvent.setup();
    render(<LoginPage />);
    await user.type(screen.getByLabelText('Username'), 'alice');
    await user.type(screen.getByLabelText('Password'), 'secret123');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(mockLogin).toHaveBeenCalledWith({ username: 'alice', password: 'secret123' });
  });

  it('shows the server error thrown by login, not the stale hook error', async () => {
    const mockLogin = vi.fn().mockRejectedValue(new Error('Invalid username or password'));
    vi.mocked(useAuth).mockReturnValue({
      login: mockLogin,
      register: vi.fn(),
      logout: vi.fn(),
      forgotPassword: vi.fn(),
      changePassword: vi.fn(),
      uploadAvatar: vi.fn(),
      removeAvatar: vi.fn(),
      isLoading: false,
      error: null,
    });
    const user = userEvent.setup();
    render(<LoginPage />);
    await user.type(screen.getByLabelText('Username'), 'alice');
    await user.type(screen.getByLabelText('Password'), 'wrong-pass');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid username or password');
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('shows the password-changed message when arriving from a reset', () => {
    mockSearch = { reset: true };
    render(<LoginPage />);
    expect(screen.getByRole('status')).toHaveTextContent('Password changed. Sign in with your new password.');
  });

  it('hides the password-changed message otherwise', () => {
    render(<LoginPage />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('links to the schedule for guests', () => {
    render(<LoginPage />);
    expect(screen.getByRole('link', { name: 'Browse without an account' })).toHaveAttribute('href', '/cards');
  });

  it('shows the reactivated toast when login cancelled a deletion', async () => {
    const mockLogin = vi.fn().mockResolvedValue({ reactivated: true });
    vi.mocked(useAuth).mockReturnValue({
      login: mockLogin,
      register: vi.fn(),
      logout: vi.fn(),
      forgotPassword: vi.fn(),
      changePassword: vi.fn(),
      uploadAvatar: vi.fn(),
      removeAvatar: vi.fn(),
      isLoading: false,
      error: null,
    });
    const user = userEvent.setup();
    render(<LoginPage />);
    await user.type(screen.getByLabelText('Username'), 'alice');
    await user.type(screen.getByLabelText('Password'), 'secret123');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith('Welcome back. Your account deletion was cancelled.', 'success'),
    );
  });
});
