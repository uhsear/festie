import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Mock dependencies
const mockNavigate = vi.fn().mockResolvedValue(undefined);
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
  Link: ({ to, children, ...rest }: { to: string; children: React.ReactNode; [k: string]: unknown }) => (
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

vi.mock('../lib/toastContext', () => ({
  useToast: vi.fn(() => ({ toast: vi.fn() })),
}));

vi.mock('../components/layout/RouteErrorBoundary', () => ({
  RenderErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import RegisterPage from './register';
import { useAuth } from '@festie/shared';

describe('RegisterPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it('renders Login and Create Account tabs', () => {
    render(<RegisterPage />);
    // Both auth-method segments are nav links now; "Create Account" also appears
    // on the submit button, so scope to the link role.
    expect(screen.getByRole('link', { name: 'Create Account' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('renders all form fields', () => {
    render(<RegisterPage />);
    expect(screen.getByLabelText('Username')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByLabelText('Confirm password')).toBeInTheDocument();
    expect(screen.getByLabelText(/Email/)).toBeInTheDocument();
  });

  it('renders TOS checkbox and links', () => {
    render(<RegisterPage />);
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    expect(screen.getByText(/I agree to the/)).toBeInTheDocument();
    expect(screen.getByText('Terms of Service')).toBeInTheDocument();
    expect(screen.getByText('Privacy Policy')).toBeInTheDocument();
  });

  it('renders the Create Account button', () => {
    render(<RegisterPage />);
    expect(screen.getByRole('button', { name: 'Create Account' })).toBeInTheDocument();
  });

  it('shows every field error at once on empty submit, each tied to its field', async () => {
    const user = userEvent.setup();
    render(<RegisterPage />);
    await user.click(screen.getByRole('button', { name: 'Create Account' }));
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
    await user.click(screen.getByRole('button', { name: 'Create Account' }));
    expect(screen.getByLabelText('Password')).toHaveFocus();
  });

  it('shows "Password must be at least 8 characters" for short password', async () => {
    const user = userEvent.setup();
    render(<RegisterPage />);
    await user.type(screen.getByLabelText('Password'), 'short');
    await user.click(screen.getByRole('button', { name: 'Create Account' }));
    expect(screen.getByText('Password must be at least 8 characters')).toBeInTheDocument();
  });

  it('shows "Passwords do not match" next to the confirm field', async () => {
    const user = userEvent.setup();
    render(<RegisterPage />);
    await user.type(screen.getByLabelText('Password'), 'password123');
    await user.type(screen.getByLabelText('Confirm password'), 'different99');
    await user.click(screen.getByRole('button', { name: 'Create Account' }));
    const confirm = screen.getByLabelText('Confirm password');
    expect(document.getElementById(confirm.getAttribute('aria-describedby')!)).toHaveTextContent('Passwords do not match');
  });

  it('rejects an under-18 date of birth', async () => {
    const user = userEvent.setup();
    render(<RegisterPage />);
    const year = new Date().getFullYear() - 10;
    fireEvent.change(screen.getByLabelText('Date of birth'), { target: { value: `${year}-01-01` } });
    await user.click(screen.getByRole('button', { name: 'Create Account' }));
    expect(screen.getByText('You must be at least 18 to use Festie')).toBeInTheDocument();
  });

  it('clears a field error once the user edits that field', async () => {
    const user = userEvent.setup();
    render(<RegisterPage />);
    await user.click(screen.getByRole('button', { name: 'Create Account' }));
    expect(screen.getByText('Username is required')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Username'), 'a');
    expect(screen.queryByText('Username is required')).not.toBeInTheDocument();
  });

  it('shows the server error thrown by register', async () => {
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
    await user.type(screen.getByLabelText('Username'), 'alice');
    await user.type(screen.getByLabelText('Password'), 'password123');
    await user.type(screen.getByLabelText('Confirm password'), 'password123');
    fireEvent.change(screen.getByLabelText('Date of birth'), { target: { value: '1995-01-01' } });
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Create Account' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Username already taken');
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

  it('calls register on valid submit', async () => {
    const mockRegister = vi.fn().mockResolvedValue(undefined);
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
    await user.type(screen.getByLabelText('Username'), 'alice');
    await user.type(screen.getByLabelText('Password'), 'password123');
    await user.type(screen.getByLabelText('Confirm password'), 'password123');
    fireEvent.change(screen.getByLabelText('Date of birth'), { target: { value: '1995-01-01' } });
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Create Account' }));
    expect(mockRegister).toHaveBeenCalledWith({
      username: 'alice',
      password: 'password123',
      confirmPassword: 'password123',
      dateOfBirth: '1995-01-01',
      tosAccepted: true,
      email: undefined,
    });
  });

  it('sends the ?ref= source stored on this visit', async () => {
    sessionStorage.setItem('festie-ref', 'tiktok');
    const mockRegister = vi.fn().mockResolvedValue(undefined);
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
    await user.type(screen.getByLabelText('Username'), 'alice');
    await user.type(screen.getByLabelText('Password'), 'password123');
    await user.type(screen.getByLabelText('Confirm password'), 'password123');
    fireEvent.change(screen.getByLabelText('Date of birth'), { target: { value: '1995-01-01' } });
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Create Account' }));
    expect(mockRegister).toHaveBeenCalledWith(expect.objectContaining({ ref: 'tiktok' }));
    sessionStorage.removeItem('festie-ref');
  });
});
