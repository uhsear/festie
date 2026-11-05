import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { api, ApiClientError } from '@festie/shared/services/api';

const toast = vi.fn();
vi.mock('../../lib/toastContext', () => ({
  useToast: () => ({ toast, toastError: vi.fn() }),
}));

const navigate = vi.fn();
let searchParams: Record<string, string> = {};
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
  useSearch: () => searchParams,
}));

vi.mock('@festie/shared/stores/authStore', () => ({
  useAuthStore: (sel: (s: { user: { id: string } }) => unknown) => sel({ user: { id: 'u3' } }),
}));

vi.mock('@festie/shared/services/api', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));

const loadMore = vi.fn();
const setSearch = vi.fn();
let listState: Record<string, unknown>;
vi.mock('@festie/shared/hooks', () => ({
  useAdminUserList: () => listState,
}));

import AdminUsers from './AdminUsers';

const row = (over: Record<string, unknown>) => ({
  id: 'u1',
  username: 'ghost',
  email: null,
  emailVerified: false,
  roles: [] as string[],
  createdAt: '2026-01-01T00:00:00Z',
  profileCount: 0,
  totalPicks: 0,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  searchParams = {};
  listState = {
    users: [
      row({}),
      row({ id: 'u2', username: 'bob', email: 'bob@example.com', emailVerified: true }),
      row({ id: 'u3', username: 'me', email: 'me@example.com', roles: ['admin'] }),
    ],
    total: 120,
    hasMore: true,
    loading: false,
    loadingMore: false,
    error: null,
    search: '',
    setSearch,
    loadMore,
    refresh: vi.fn(),
    patchUser: vi.fn(),
    removeUser: vi.fn(),
  };
});

describe('AdminUsers', () => {
  it('renders a null-email user as "No email" with no Show button', async () => {
    render(<AdminUsers />);
    expect(await screen.findByText('No email')).toBeInTheDocument();
    expect(screen.queryByLabelText('Show full email for ghost')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Show full email for bob')).toBeInTheDocument();
  });

  it('shows the true total and the Verified state from emailVerified', () => {
    render(<AdminUsers />);
    expect(screen.getByText('Users (120)')).toBeInTheDocument();
    expect(screen.getByText('Showing 3 of 120')).toBeInTheDocument();
    expect(screen.getAllByText('Not verified').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Verified', { selector: 'span' })).toHaveLength(1);
  });

  it('the own row has a You badge and no Delete or role button', () => {
    render(<AdminUsers />);
    expect(screen.getByText('You')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Delete' })).toHaveLength(2);
    expect(screen.getByLabelText('Select me')).toBeDisabled();
  });

  it('Grant opens a confirm dialog that names the user', async () => {
    render(<AdminUsers />);
    await userEvent.click(screen.getAllByRole('button', { name: /Grant Admin/ })[1]);
    expect(await screen.findByText('Grant admin to @bob?')).toBeInTheDocument();
  });

  it('Load more calls the hook loadMore', async () => {
    render(<AdminUsers />);
    await userEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(loadMore).toHaveBeenCalled();
  });

  it('q from the URL filters the list', () => {
    searchParams = { q: 'sam' };
    render(<AdminUsers />);
    expect(setSearch).toHaveBeenCalledWith('sam');
    expect(screen.getByLabelText('Search users by username or email')).toHaveValue('sam');
  });

  describe('reset link needs a recent password', () => {
    const reauthRequired = () => new ApiClientError('Confirm your password to continue.', 403, 'REAUTH_REQUIRED');
    const link = { resetUrl: 'https://festie.test/reset/abc', username: 'bob', expiresAt: '2026-11-02T12:00:00Z' };
    const writeText = vi.fn();

    beforeEach(() => {
      writeText.mockReset().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    });

    const openResetConfirm = async () => {
      render(<AdminUsers />);
      await userEvent.click(screen.getAllByRole('button', { name: 'Copy reset link' })[1]);
      await userEvent.click(await screen.findByRole('button', { name: 'Create link' }));
    };

    it('prompts on REAUTH_REQUIRED, then copies the link', async () => {
      vi.mocked(api.post).mockRejectedValueOnce(reauthRequired()).mockResolvedValueOnce({}).mockResolvedValueOnce(link);
      await openResetConfirm();
      await userEvent.type(await screen.findByPlaceholderText('Password'), 'hunter2');
      await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
      await waitFor(() => expect(writeText).toHaveBeenCalledWith(link.resetUrl));
      expect(api.post).toHaveBeenCalledWith('/auth/reauth', { password: 'hunter2' });
    });

    it('a double click on Create link sends one request', async () => {
      vi.mocked(api.post).mockReset().mockReturnValue(new Promise(() => {}));
      render(<AdminUsers />);
      await userEvent.click(screen.getAllByRole('button', { name: 'Copy reset link' })[1]);
      const create = await screen.findByRole('button', { name: 'Create link' });
      fireEvent.click(create);
      fireEvent.click(create);
      expect(api.post).toHaveBeenCalledTimes(1);
    });

    it('cancel on the prompt makes no second request and shows no toast', async () => {
      vi.mocked(api.post).mockRejectedValueOnce(reauthRequired());
      await openResetConfirm();
      await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
      expect(api.post).toHaveBeenCalledTimes(1);
      expect(writeText).not.toHaveBeenCalled();
      expect(toast).not.toHaveBeenCalled();
    });
  });

  it('selecting a user shows the selection bar', async () => {
    render(<AdminUsers />);
    await userEvent.click(screen.getByLabelText('Select bob'));
    expect(screen.getByRole('region', { name: 'Selection' })).toHaveTextContent('1 selected');
  });

  it('load error shows the alert and a Retry that calls refresh', async () => {
    const refresh = vi.fn();
    listState = { ...listState, users: [], total: 0, error: 'Network down', refresh };
    render(<AdminUsers />);
    expect(screen.getByRole('alert')).toHaveTextContent('Network down');
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
