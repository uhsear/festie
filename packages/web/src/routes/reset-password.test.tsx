import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockNavigate = vi.fn().mockResolvedValue(undefined);
let mockSearch: { token?: string } = { token: 'a'.repeat(64) };
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
  useSearch: () => mockSearch,
  Link: ({ to, children, ...rest }: { to: string; children: React.ReactNode; [k: string]: unknown }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

const mockResetPassword = vi.fn();
vi.mock('@festie/shared', () => ({
  useAuthStore: { getState: () => ({ resetPassword: mockResetPassword }) },
}));

vi.mock('../components/layout/RouteErrorBoundary', () => ({
  RenderErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import ResetPasswordPage from './reset-password';

async function fill(user: ReturnType<typeof userEvent.setup>, password: string, confirm: string) {
  await user.type(screen.getByLabelText('New password'), password);
  await user.type(screen.getByLabelText('Confirm new password'), confirm);
  await user.click(screen.getByRole('button', { name: 'Reset password' }));
}

describe('ResetPasswordPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearch = { token: 'a'.repeat(64) };
  });

  it('blocks mismatched passwords without calling resetPassword', async () => {
    const user = userEvent.setup();
    render(<ResetPasswordPage />);
    await fill(user, 'password123', 'different99');
    expect(screen.getByText('Passwords do not match')).toBeInTheDocument();
    expect(mockResetPassword).not.toHaveBeenCalled();
  });

  it('navigates to /login with the reset flag on success', async () => {
    mockResetPassword.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<ResetPasswordPage />);
    await fill(user, 'password123', 'password123');
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith({ to: '/login', search: { reset: true }, replace: true }),
    );
    expect(mockResetPassword).toHaveBeenCalledWith({
      token: 'a'.repeat(64),
      newPassword: 'password123',
      confirmPassword: 'password123',
    });
  });

  it('shows the expired panel when the server says the link expired', async () => {
    mockResetPassword.mockRejectedValue(
      Object.assign(new Error('expired'), { name: 'ApiClientError', status: 400, code: 'TOKEN_EXPIRED' }),
    );
    const user = userEvent.setup();
    render(<ResetPasswordPage />);
    await fill(user, 'password123', 'password123');
    expect(await screen.findByText('This reset link has expired')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Send a new link' })).toHaveAttribute('href', '/forgot-password');
  });

  it('shows the expired panel at once when there is no token', () => {
    mockSearch = {};
    render(<ResetPasswordPage />);
    expect(screen.getByText('This reset link has expired')).toBeInTheDocument();
    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument();
  });

  it('shows a policy error under the New password field', async () => {
    mockResetPassword.mockRejectedValue(
      Object.assign(new Error('That password is too common — please choose something harder to guess'), {
        name: 'ApiClientError',
        status: 400,
        code: 'INVALID_INPUT',
      }),
    );
    const user = userEvent.setup();
    render(<ResetPasswordPage />);
    await fill(user, 'password123', 'password123');
    const field = screen.getByLabelText('New password');
    await waitFor(() => expect(field).toHaveAttribute('aria-invalid', 'true'));
    const target = document.getElementById(field.getAttribute('aria-describedby')!.split(' ')[0]);
    expect(target).toHaveTextContent('That password is too common');
  });
});
