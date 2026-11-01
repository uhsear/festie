import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Mock dependencies
const mockNavigate = vi.fn().mockResolvedValue(undefined);
let mockSearch: { next?: string } = {};
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
  useSearch: () => mockSearch,
  Link: ({ to, children, search: _search, ...rest }: { to: string; children: React.ReactNode; [k: string]: unknown }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('@festie/shared', () => ({
  useAuth: vi.fn(() => ({
    register: vi.fn(),
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

import RegisterPage from './register';
import { useAuth } from '@festie/shared';

async function fillValid(user: ReturnType<typeof userEvent.setup>, opts: { email?: string } = {}) {
  await user.type(screen.getByLabelText('Username'), 'alice');
  await user.type(screen.getByLabelText('Password'), 'password123');
  await user.type(screen.getByLabelText('Confirm password'), 'password123');
  fireEvent.change(screen.getByLabelText('Date of birth'), { target: { value: '1995-01-01' } });
  if (opts.email !== '') await user.type(screen.getByLabelText('Email'), opts.email ?? 'a@b.co');
  await user.click(screen.getByRole('checkbox'));
}

describe('RegisterPage', () => {
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
    render(<RegisterPage />);
    expect(screen.getByText('FESTIE')).toBeInTheDocument();
  });

  it('renders the tagline', () => {
    render(<RegisterPage />);
    expect(screen.getByText('Plan your sets. Sync with your crew.')).toBeInTheDocument();
  });

  it('renders Login and Create account tabs', () => {
    render(<RegisterPage />);
    // Both auth-method segments are nav links now; "Create Account" also appears
    // on the submit button, so scope to the link role.
    expect(screen.getByRole('link', { name: 'Create account' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('renders all form fields', () => {
    render(<RegisterPage />);
    expect(screen.getByLabelText('Username')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByLabelText('Confirm password')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
  });

  it('renders TOS checkbox and links', () => {
    render(<RegisterPage />);
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    expect(screen.getByText(/I agree to the/)).toBeInTheDocument();
    expect(screen.getByText('Terms of Service')).toBeInTheDocument();
    expect(screen.getByText('Privacy Policy')).toBeInTheDocument();
  });

  it('renders the Create account button', () => {
    render(<RegisterPage />);
    expect(screen.getByRole('button', { name: 'Create account' })).toBeInTheDocument();
  });

  it('shows every field error at once on empty submit, each tied to its field', async () => {
    const user = userEvent.setup();
    render(<RegisterPage />);
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    const alerts = screen.getAllByRole('alert').map((a) => a.textContent);
    expect(alerts).toEqual(
      expect.arrayContaining([
        'Username is required',
        'Password is required',
        'Date of birth is required',
        'You must accept the Terms of Service and Privacy Policy',
      ]),
    );
    const username = screen.getByLabelText('Username');
    expect(username).toHaveAttribute('aria-invalid', 'true');
    expect(username.getAttribute('aria-describedby')).toBeTruthy();
    expect(document.getElementById(username.getAttribute('aria-describedby')!)).toHaveTextContent('Username is required');
    expect(screen.getByLabelText('Date of birth')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('checkbox')).toHaveAttribute('aria-describedby', 'authTos-error');
  });

  it('moves focus to the first invalid field', async () => {
    const user = userEvent.setup();
    render(<RegisterPage />);
    await user.type(screen.getByLabelText('Username'), 'alice');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(screen.getByLabelText('Password')).toHaveFocus();
  });

  it('shows "Password must be at least 8 characters" for short password', async () => {
    const user = userEvent.setup();
    render(<RegisterPage />);
    await user.type(screen.getByLabelText('Password'), 'short');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(screen.getByText('Password must be at least 8 characters')).toBeInTheDocument();
  });

  it('shows "Passwords do not match" next to the confirm field', async () => {
    const user = userEvent.setup();
    render(<RegisterPage />);
    await user.type(screen.getByLabelText('Password'), 'password123');
    await user.type(screen.getByLabelText('Confirm password'), 'different99');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    const confirm = screen.getByLabelText('Confirm password');
    expect(document.getElementById(confirm.getAttribute('aria-describedby')!)).toHaveTextContent('Passwords do not match');
  });

  it('rejects an under-18 date of birth', async () => {
    const user = userEvent.setup();
    render(<RegisterPage />);
    const year = new Date().getFullYear() - 10;
    fireEvent.change(screen.getByLabelText('Date of birth'), { target: { value: `${year}-01-01` } });
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(screen.getByText('You must be at least 18 to use Festie')).toBeInTheDocument();
  });

  it('clears a field error once the user edits that field', async () => {
    const user = userEvent.setup();
    render(<RegisterPage />);
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(screen.getByText('Username is required')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Username'), 'a');
    expect(screen.queryByText('Username is required')).not.toBeInTheDocument();
  });

  it('puts a username server error on the username field, not the form alert', async () => {
    vi.mocked(useAuth).mockReturnValue({
      login: vi.fn(),
      register: vi.fn().mockRejectedValue(new Error('Username already taken')),
      logout: vi.fn(),
      forgotPassword: vi.fn(),
      changePassword: vi.fn(),
      uploadAvatar: vi.fn(),
      removeAvatar: vi.fn(),
      isLoading: false,
      error: null,
    });
    const user = userEvent.setup();
    render(<RegisterPage />);
    await fillValid(user);
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    const username = screen.getByLabelText('Username');
    await waitFor(() => expect(username).toHaveAttribute('aria-invalid', 'true'));
    const described = username.getAttribute('aria-describedby')!.split(' ').map((id) => document.getElementById(id));
    expect(described.some((el) => el?.textContent === 'Username already taken')).toBe(true);
    expect(username).toHaveFocus();
  });

  it('shows a non-field server error in the form alert', async () => {
    vi.mocked(useAuth).mockReturnValue({
      login: vi.fn(),
      register: vi.fn().mockRejectedValue(new Error('Maximum users reached')),
      logout: vi.fn(),
      forgotPassword: vi.fn(),
      changePassword: vi.fn(),
      uploadAvatar: vi.fn(),
      removeAvatar: vi.fn(),
      isLoading: false,
      error: null,
    });
    const user = userEvent.setup();
    render(<RegisterPage />);
    await fillValid(user);
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Maximum users reached');
  });

  it('shows the username rule when the field loses focus', async () => {
    const user = userEvent.setup();
    render(<RegisterPage />);
    await user.type(screen.getByLabelText('Username'), 'a');
    await user.tab();
    expect(screen.getByText('Use 2 to 30 letters, numbers, spaces, hyphens or underscores.')).toBeInTheDocument();
  });

  it('blocks submit with an empty email', async () => {
    const mockRegister = vi.fn();
    vi.mocked(useAuth).mockReturnValue({
      login: vi.fn(),
      register: mockRegister,
      logout: vi.fn(),
      forgotPassword: vi.fn(),
      changePassword: vi.fn(),
      uploadAvatar: vi.fn(),
      removeAvatar: vi.fn(),
      isLoading: false,
      error: null,
    });
    const user = userEvent.setup();
    render(<RegisterPage />);
    await fillValid(user, { email: '' });
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(screen.getByText('Email is required to reset your password later.')).toBeInTheDocument();
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it('toasts the verification notice with the email when one was sent', async () => {
    vi.mocked(useAuth).mockReturnValue({
      login: vi.fn(),
      register: vi.fn().mockResolvedValue({ emailVerificationSent: true }),
      logout: vi.fn(),
      forgotPassword: vi.fn(),
      changePassword: vi.fn(),
      uploadAvatar: vi.fn(),
      removeAvatar: vi.fn(),
      isLoading: false,
      error: null,
    });
    const user = userEvent.setup();
    render(<RegisterPage />);
    await fillValid(user);
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() => expect(mockToast).toHaveBeenCalled());
    expect(mockToast.mock.calls[0][0]).toContain('a@b.co');
    expect(mockToast.mock.calls[0][1]).toBe('success');
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
    render(<RegisterPage />);
    expect(screen.getByText('Creating account…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Creating account…' })).toBeDisabled();
    expect(screen.getByRole('checkbox')).toBeDisabled();
  });

  async function submitRegister() {
    const user = userEvent.setup();
    vi.mocked(useAuth).mockReturnValue({
      login: vi.fn(),
      register: vi.fn().mockResolvedValue({ emailVerificationSent: false }),
      logout: vi.fn(),
      forgotPassword: vi.fn(),
      changePassword: vi.fn(),
      uploadAvatar: vi.fn(),
      removeAvatar: vi.fn(),
      isLoading: false,
      error: null,
    });
    render(<RegisterPage />);
    await fillValid(user);
    await user.click(screen.getByRole('button', { name: 'Create account' }));
  }

  it('returns to the next path after sign-up', async () => {
    mockSearch = { next: '/set/abc' };
    await submitRegister();
    expect(mockNavigate).toHaveBeenCalledWith({ href: '/set/abc' });
  });

  it('goes to /cards after sign-up without a next path', async () => {
    await submitRegister();
    expect(mockNavigate).toHaveBeenCalledWith({ to: '/cards' });
  });

  it('calls register on valid submit', async () => {
    const mockRegister = vi.fn().mockResolvedValue({ emailVerificationSent: false });
    vi.mocked(useAuth).mockReturnValue({
      login: vi.fn(),
      register: mockRegister,
      logout: vi.fn(),
      forgotPassword: vi.fn(),
      changePassword: vi.fn(),
      uploadAvatar: vi.fn(),
      removeAvatar: vi.fn(),
      isLoading: false,
      error: null,
    });
    const user = userEvent.setup();
    render(<RegisterPage />);
    await fillValid(user);
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(mockRegister).toHaveBeenCalledWith({
      username: 'alice',
      password: 'password123',
      confirmPassword: 'password123',
      dateOfBirth: '1995-01-01',
      tosAccepted: true,
      email: 'a@b.co',
    });
  });

  it('sends the ?ref= source stored on this visit', async () => {
    sessionStorage.setItem('festie-ref', 'tiktok');
    const mockRegister = vi.fn().mockResolvedValue({ emailVerificationSent: false });
    vi.mocked(useAuth).mockReturnValue({
      login: vi.fn(),
      register: mockRegister,
      logout: vi.fn(),
      forgotPassword: vi.fn(),
      changePassword: vi.fn(),
      uploadAvatar: vi.fn(),
      removeAvatar: vi.fn(),
      isLoading: false,
      error: null,
    });
    const user = userEvent.setup();
    render(<RegisterPage />);
    await fillValid(user);
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(mockRegister).toHaveBeenCalledWith(expect.objectContaining({ ref: 'tiktok' }));
    sessionStorage.removeItem('festie-ref');
  });
});
