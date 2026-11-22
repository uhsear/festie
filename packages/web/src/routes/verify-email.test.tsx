import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

let mockSearch: { token?: string } = { token: 'a'.repeat(64) };
vi.mock('@tanstack/react-router', () => ({
  useSearch: () => mockSearch,
  Link: ({ to, children, ...rest }: { to: string; children: React.ReactNode; [k: string]: unknown }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

const mockVerifyEmail = vi.fn();
vi.mock('@festie/shared', () => ({
  useAuthStore: { getState: () => ({ verifyEmail: mockVerifyEmail }) },
}));

vi.mock('../components/layout/RouteErrorBoundary', () => ({
  RenderErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import VerifyEmailPage from './verify-email';

describe('VerifyEmailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearch = { token: 'a'.repeat(64) };
  });

  it('does not consume the token until the button is pressed', async () => {
    render(<VerifyEmailPage />);
    expect(mockVerifyEmail).not.toHaveBeenCalled();
    mockVerifyEmail.mockResolvedValue({ email: 'a@b.co', sessionsRevoked: false });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Confirm my email' }));
    expect(mockVerifyEmail).toHaveBeenCalledWith('a'.repeat(64));
    expect(await screen.findByText('Email confirmed')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open Festie' }).getAttribute('href')).toBe('/');
  });

  it('tells the person to sign in again when the login address moved', async () => {
    mockVerifyEmail.mockResolvedValue({ email: 'a@b.co', sessionsRevoked: true });
    render(<VerifyEmailPage />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Confirm my email' }));
    expect(await screen.findByText('Email changed')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to sign in' }).getAttribute('href')).toBe('/login');
  });

  it('shows the expired view for a dead link', async () => {
    const { ApiClientError } = await import('@festie/shared/services/api');
    mockVerifyEmail.mockRejectedValue(new ApiClientError('expired', 400, 'INVALID_INPUT'));
    render(<VerifyEmailPage />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Confirm my email' }));
    expect(await screen.findByText('This confirmation link has expired')).toBeTruthy();
  });

  it('says the address is taken, not that the link expired, on a 409', async () => {
    const { ApiClientError } = await import('@festie/shared/services/api');
    mockVerifyEmail.mockRejectedValue(new ApiClientError('That address is now in use by another account.', 409, 'CONFLICT'));
    render(<VerifyEmailPage />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Confirm my email' }));
    expect(await screen.findByText('Address already in use')).toBeTruthy();
    expect(screen.getByText('That address is now in use by another account.')).toBeTruthy();
    expect(screen.queryByText('This confirmation link has expired')).toBeNull();
  });

  it('shows the expired view when the link has no token', () => {
    mockSearch = {};
    render(<VerifyEmailPage />);
    expect(screen.getByText('This confirmation link has expired')).toBeTruthy();
  });
});
