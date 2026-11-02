import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../lib/toastContext', () => ({
  useToast: () => ({ toast: vi.fn(), toastError: vi.fn() }),
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

  it('selecting a user shows the selection bar', async () => {
    render(<AdminUsers />);
    await userEvent.click(screen.getByLabelText('Select bob'));
    expect(screen.getByRole('region', { name: 'Selection' })).toHaveTextContent('1 selected');
  });
});
