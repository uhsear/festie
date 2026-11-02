import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

let mockSearch: { expired?: true } = {};
vi.mock('@tanstack/react-router', () => ({
  useSearch: () => mockSearch,
  Link: ({ to, children, ...rest }: { to: string; children: React.ReactNode; [k: string]: unknown }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

const mockForgot = vi.fn();
vi.mock('@festie/shared', () => ({
  useAuth: () => ({ forgotPassword: mockForgot, isLoading: false, error: null }),
}));

vi.mock('../components/layout/RouteErrorBoundary', () => ({
  RenderErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import ForgotPasswordPage from './forgot-password';

describe('ForgotPasswordPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearch = {};
    mockForgot.mockResolvedValue(undefined);
  });

  async function submit(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByLabelText('Email'), 'a@b.co');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));
  }

  it('words the success panel without promising an account exists', async () => {
    const user = userEvent.setup();
    render(<ForgotPasswordPage />);
    await submit(user);
    expect(await screen.findByText('If an account uses a@b.co, a reset link is on its way.')).toBeInTheDocument();
  });

  it('returns to the form with the email kept', async () => {
    const user = userEvent.setup();
    render(<ForgotPasswordPage />);
    await submit(user);
    await user.click(await screen.findByRole('button', { name: 'Use a different email' }));
    expect(screen.getByLabelText('Email')).toHaveValue('a@b.co');
  });

  it('shows the expired notice when the search flag is set', () => {
    mockSearch = { expired: true };
    render(<ForgotPasswordPage />);
    expect(screen.getByRole('status')).toHaveTextContent('That reset link has expired or was already used.');
  });

  it('shows no expired notice by default', () => {
    render(<ForgotPasswordPage />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows the support hint with a mailto link', () => {
    render(<ForgotPasswordPage />);
    expect(screen.getByRole('link', { name: 'support@festie.us' })).toHaveAttribute('href', 'mailto:support@festie.us');
  });
});
