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
const mockLoadCrews = vi.fn().mockResolvedValue(undefined);
let mockCrews: unknown[] = [];
vi.mock('@festie/shared/stores/crewStore', () => ({
  useCrewStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ crews: mockCrews, loadCrews: mockLoadCrews }),
}));
vi.mock('@festie/shared/stores/authStore', () => ({
  useAuthStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ deleteAccount: mockDeleteAccount, user: { id: 'me' } }),
  ACCOUNT_DELETION_EXPLAINER: 'explainer',
  accountDeletionNotice: (d: string | null) =>
    `Your account will be deleted on ${d}. Sign in before then to keep it.`,
}));

const mockToast = vi.fn();
vi.mock('../../lib/toastContext', () => ({
  useToast: () => ({ toast: mockToast }),
}));

vi.mock('@festie/shared/services/api', () => ({
  mapErrorToUserMessage: (err: unknown, fallback: string) =>
    (err as { code?: string }).code ? (err as Error).message : fallback,
}));

const mockDownload = vi.fn();
vi.mock('../../lib/downloadExport', () => ({
  downloadExport: () => mockDownload(),
}));
vi.mock('@festie/shared/services/account', () => ({
  exportErrorMessage: () => 'export failed',
}));

let mockHasPassword: boolean | undefined;
vi.mock('../../lib/useIdentities', () => ({
  useIdentities: () => ({ data: mockHasPassword === undefined ? undefined : { hasPassword: mockHasPassword, identities: [] } }),
}));
const mockAsk = vi.fn();
vi.mock('../../lib/useReauthPrompt', () => ({
  useReauthPrompt: () => ({ ask: mockAsk, reauthDialog: null }),
}));
vi.mock('@festie/shared/services/admin', () => ({
  withReauth: async (run: () => Promise<unknown>, ask: () => Promise<unknown>) => {
    try {
      return await run();
    } catch (err) {
      if ((err as { code?: string }).code !== 'REAUTH_REQUIRED') throw err;
    }
    if ((await ask()) === null) return null;
    return run();
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockHasPassword = undefined;
  mockCrews = [];
  mockLoadCrews.mockResolvedValue(undefined);
});

describe('DangerZone', () => {
  // --- Delete account section ---

  it('offers Download my data first without submitting the form', async () => {
    const user = userEvent.setup();
    mockDownload.mockResolvedValue(undefined);
    render(<DangerZone />);
    await user.click(screen.getByText('Delete My Account'));
    await user.click(screen.getByRole('button', { name: 'Download my data first' }));
    await waitFor(() => expect(mockDownload).toHaveBeenCalledTimes(1));
    expect(mockToast).toHaveBeenCalledWith('Your data is downloaded.', 'success');
    expect(mockDeleteAccount).not.toHaveBeenCalled();
  });

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

  it('shows no password field for a provider-only account and re-auths before deleting', async () => {
    const user = userEvent.setup();
    mockHasPassword = false;
    mockAsk.mockResolvedValue({ provider: 'google', idToken: 'x'.repeat(30) });
    mockDeleteAccount
      .mockRejectedValueOnce(Object.assign(new Error('Confirm it is you'), { code: 'REAUTH_REQUIRED' }))
      .mockResolvedValueOnce({ deletionDate: '30 November 2026' });

    render(<DangerZone />);
    await user.click(screen.getByText('Delete My Account'));
    expect(screen.queryByPlaceholderText('Password')).not.toBeInTheDocument();
    expect(screen.getByText('Confirm Delete').closest('button')).not.toBeDisabled();
    await user.click(screen.getByText('Confirm Delete'));

    await waitFor(() => expect(mockDeleteAccount).toHaveBeenCalledTimes(2));
    expect(mockAsk).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith({ to: '/login' });
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
      expect(mockDeleteAccount).toHaveBeenCalledWith('mypassword', []);
    });
    expect(mockToast).toHaveBeenCalledWith(
      expect.stringContaining('Sign in before then to keep it.'),
      'info',
      10000,
    );
    expect(mockNavigate).toHaveBeenCalledWith({ to: '/login' });
  });

  it('shows a wrong password inline under the field, not as a toast', async () => {
    const user = userEvent.setup();
    mockDeleteAccount.mockRejectedValue(
      Object.assign(new Error('That password is not correct.'), {
        name: 'ApiClientError',
        status: 403,
        code: 'PASSWORD_INCORRECT',
      }),
    );

    render(<DangerZone />);
    await user.click(screen.getByText('Delete My Account'));
    await user.type(screen.getByPlaceholderText('Password'), 'mypassword');
    await user.click(screen.getByText('Confirm Delete'));

    const field = screen.getByPlaceholderText('Password');
    await waitFor(() => expect(field).toHaveAttribute('aria-invalid', 'true'));
    expect(document.getElementById(field.getAttribute('aria-describedby')!.split(' ')[0])).toHaveTextContent(
      'That password is not correct.',
    );
    expect(mockToast).not.toHaveBeenCalledWith(expect.anything(), 'error');
  });

  it('clears the inline delete error when the password changes', async () => {
    const user = userEvent.setup();
    mockDeleteAccount.mockRejectedValue(new Error('fail'));

    render(<DangerZone />);
    await user.click(screen.getByText('Delete My Account'));
    await user.type(screen.getByPlaceholderText('Password'), 'mypassword');
    await user.click(screen.getByText('Confirm Delete'));
    expect(await screen.findByText("Couldn't delete account. Try again.")).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText('Password'), 'x');
    expect(screen.queryByText("Couldn't delete account. Try again.")).not.toBeInTheDocument();
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

  // --- Crew hand-over ---

  const ownedCrew = (members: Array<{ userId: string; name?: string; username: string; joinedAt?: string }>) => ({
    id: 'c1',
    name: 'Night Owls',
    role: 'owner',
    members: [{ userId: 'me', username: 'me' }, ...members],
  });

  it('lists owned crews with the first joiner preselected and submits the choice', async () => {
    const user = userEvent.setup();
    mockCrews = [
      ownedCrew([
        { userId: 'u2', name: 'Bea', username: 'bea', joinedAt: '2026-01-02T00:00:00Z' },
        { userId: 'u3', name: 'Cal', username: 'cal', joinedAt: '2026-01-01T00:00:00Z' },
      ]),
    ];
    mockDeleteAccount.mockResolvedValue({ deletionDate: 'x' });

    render(<DangerZone />);
    await user.click(screen.getByText('Delete My Account'));

    expect(screen.getByText('Crews you own')).toBeInTheDocument();
    const select = screen.getByLabelText('New owner for Night Owls') as HTMLSelectElement;
    expect(select.value).toBe('u3');

    await user.selectOptions(select, 'u2');
    await user.type(screen.getByPlaceholderText('Password'), 'pw');
    await user.click(screen.getByText('Confirm Delete'));

    await waitFor(() => {
      expect(mockDeleteAccount).toHaveBeenCalledWith('pw', [{ crewId: 'c1', newOwnerId: 'u2' }]);
    });
  });

  it('says solo crews are deleted with the account', async () => {
    const user = userEvent.setup();
    mockCrews = [ownedCrew([])];
    render(<DangerZone />);
    await user.click(screen.getByText('Delete My Account'));

    expect(screen.getByText(/only member of 1 crew/)).toBeInTheDocument();
    expect(screen.queryByText('Crews you own')).not.toBeInTheDocument();
  });

  it('shows no owned-crews block for a user who owns no crew', async () => {
    const user = userEvent.setup();
    mockCrews = [{ ...ownedCrew([{ userId: 'u2', username: 'bea' }]), role: 'member', owner: 'u2' }];
    render(<DangerZone />);
    await user.click(screen.getByText('Delete My Account'));

    expect(screen.queryByText('Crews you own')).not.toBeInTheDocument();
    expect(screen.queryByText(/only member of/)).not.toBeInTheDocument();
  });

  it('loads crews when the store has none', async () => {
    const user = userEvent.setup();
    render(<DangerZone />);
    await user.click(screen.getByText('Delete My Account'));
    expect(mockLoadCrews).toHaveBeenCalledTimes(1);
  });
});
