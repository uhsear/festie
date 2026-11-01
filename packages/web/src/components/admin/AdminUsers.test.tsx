import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AdminUsers from './AdminUsers';

vi.mock('../../lib/toastContext', () => ({
  useToast: () => ({ toast: vi.fn(), toastError: vi.fn() }),
}));

const mockGet = vi.fn();
vi.mock('@festie/shared/services/api', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  api: { get: (...a: unknown[]) => mockGet(...a), post: vi.fn(), delete: vi.fn() },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockGet.mockResolvedValue([
    { id: 'u1', username: 'ghost', email: null, roles: [], isVerified: false, createdAt: '2026-01-01T00:00:00Z' },
    { id: 'u2', username: 'bob', email: 'bob@example.com', roles: [], isVerified: true, createdAt: '2026-01-02T00:00:00Z' },
  ]);
});

describe('AdminUsers', () => {
  it('renders a null-email user as "No email" with no Show button', async () => {
    render(<AdminUsers />);
    expect(await screen.findByText('No email')).toBeInTheDocument();
    expect(screen.queryByLabelText('Show full email for ghost')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Show full email for bob')).toBeInTheDocument();
  });

  it('searching does not throw on a null email', async () => {
    render(<AdminUsers />);
    await screen.findByText('No email');
    await userEvent.type(screen.getByLabelText('Search users by username or email'), 'bob');
    expect(screen.queryByText('ghost')).not.toBeInTheDocument();
    expect(screen.getByText('bob')).toBeInTheDocument();
  });
});
