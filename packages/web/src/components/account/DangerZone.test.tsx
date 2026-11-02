import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DangerZone from './DangerZone';

// --- Mocks ---

const mockNavigate = vi.fn();
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
}));

const mockDeleteAccount = vi.fn();
vi.mock('@festie/shared/stores/authStore', () => ({
  useAuthStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ deleteAccount: mockDeleteAccount }),
  ACCOUNT_DELETION_EXPLAINER: 'explainer',
  accountDeletionNotice: (d: string | null) =>
    `Your account will be deleted on ${d}. Sign in before then to keep it.`,
}));

const mockToast = vi.fn();
vi.mock('../../lib/toastContext', () => ({
  useToast: () => ({ toast: mockToast }),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('DangerZone', () => {
  // --- Delete account section ---

  it('renders the Delete Account section', () => {
    render(<DangerZone />);
    expect(screen.getByText('Delete Account')).toBeInTheDocument();
    expect(screen.getByText('Delete My Account')).toBeInTheDocument();
  });

  it('does not show password field initially', () => {
    render(<DangerZone />);
    expect(screen.queryByPlaceholderText('Password')).not.toBeInTheDocument();
  });

  it('shows confirmation form after clicking Delete My Account', async () => {
    const user = userEvent.setup();
    render(<DangerZone />);
    await user.click(screen.getByText('Delete My Account'));

    expect(screen.getByPlaceholderText('Password')).toBeInTheDocument();
    expect(screen.getByText('Confirm Delete')).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
  });

  it('disables Confirm Delete when password is empty', async () => {
    const user = userEvent.setup();
    render(<DangerZone />);
    await user.click(screen.getByText('Delete My Account'));

    expect(screen.getByText('Confirm Delete').closest('button')).toBeDisabled();
  });

  it('enables Confirm Delete after typing a password', async () => {
    const user = userEvent.setup();
    render(<DangerZone />);
    await user.click(screen.getByText('Delete My Account'));
    await user.type(screen.getByPlaceholderText('Password'), 'mypass123');

    expect(screen.getByText('Confirm Delete').closest('button')).not.toBeDisabled();
  });

  it('hides confirmation and clears password on Cancel', async () => {
    const user = userEvent.setup();
    render(<DangerZone />);
    await user.click(screen.getByText('Delete My Account'));
    await user.type(screen.getByPlaceholderText('Password'), 'secret');
    await user.click(screen.getByText('Cancel'));

    // Back to initial state
    expect(screen.queryByPlaceholderText('Password')).not.toBeInTheDocument();
    expect(screen.getByText('Delete My Account')).toBeInTheDocument();
  });

  it('deletes through the store, shows the deletion notice, and navigates', async () => {
    const user = userEvent.setup();
    mockDeleteAccount.mockResolvedValue({ deletionDate: '30 November 2026' });

    render(<DangerZone />);
    await user.click(screen.getByText('Delete My Account'));
    await user.type(screen.getByPlaceholderText('Password'), 'mypassword');
    await user.click(screen.getByText('Confirm Delete'));

    await waitFor(() => {
      expect(mockDeleteAccount).toHaveBeenCalledWith('mypassword');
    });
    expect(mockToast).toHaveBeenCalledWith(
      expect.stringContaining('Sign in before then to keep it.'),
      'info',
    );
    expect(mockNavigate).toHaveBeenCalledWith({ to: '/login' });
  });

  it('shows error toast when account deletion fails', async () => {
    const user = userEvent.setup();
    mockDeleteAccount.mockRejectedValue(new Error('fail'));

    render(<DangerZone />);
    await user.click(screen.getByText('Delete My Account'));
    await user.type(screen.getByPlaceholderText('Password'), 'mypassword');
    await user.click(screen.getByText('Confirm Delete'));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        "Couldn't delete account. Try again.",
        'error',
      );
    });
  });

  it('does not call handleDelete if password field is empty on submit', async () => {
    const user = userEvent.setup();
    render(<DangerZone />);
    await user.click(screen.getByText('Delete My Account'));

    // Submit form without typing a password (button is disabled, but test the guard)
    const form = screen.getByPlaceholderText('Password').closest('form')!;
    form.dispatchEvent(new Event('submit', { bubbles: true }));

    expect(mockDeleteAccount).not.toHaveBeenCalled();
  });
});
