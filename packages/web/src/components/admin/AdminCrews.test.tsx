import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AdminCrews from './AdminCrews';

vi.mock('../../lib/toastContext', () => ({
  useToast: () => ({ toast: vi.fn(), toastError: vi.fn() }),
}));

vi.mock('./useAdminSearch', () => ({ useAdminSearch: () => [{}, vi.fn()] }));
vi.mock('./UserPickerDialog', () => ({ default: () => null }));

const mockFetchCrews = vi.fn();
const mockRemove = vi.fn();
vi.mock('@festie/shared/services/admin', () => ({
  fetchAdminCrews: () => mockFetchCrews(),
  addCrewMember: vi.fn(),
  removeCrewMember: (...a: unknown[]) => mockRemove(...a),
}));

const mockGet = vi.fn();
vi.mock('@festie/shared/services/api', () => ({
  api: { get: (...a: unknown[]) => mockGet(...a), delete: vi.fn() },
  mapErrorToUserMessage: (_e: unknown, fallback: string) => fallback,
}));

const crew = {
  id: 'c1',
  name: 'Sunset Squad',
  festivalId: 'f-raw-id',
  createdBy: 'u-raw-id',
  inviteCode: 'K7XQ2M',
  maxMembers: 10,
  homeBaseLocation: null,
  homeBaseTime: null,
  createdAt: '2026-10-01T00:00:00Z',
  festivalName: 'EDC Orlando',
  creatorUsername: 'alice',
  memberCount: 2,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockFetchCrews.mockResolvedValue([crew]);
  mockRemove.mockResolvedValue({});
  mockGet.mockResolvedValue([
    { userId: 'u1', username: 'alice', role: 'owner' },
    { userId: 'u2', username: 'bob', role: 'member' },
  ]);
});

describe('AdminCrews', () => {
  it('shows the creator username, not the raw id', async () => {
    render(<AdminCrews />);
    expect(await screen.findByText(/Created by @alice/)).toBeInTheDocument();
    expect(screen.queryByText(/u-raw-id/)).not.toBeInTheDocument();
    expect(screen.queryByText(/f-raw-id/)).not.toBeInTheDocument();
  });

  it('finds a crew by invite code in lower case', async () => {
    render(<AdminCrews />);
    await screen.findByText('Sunset Squad');
    await userEvent.type(screen.getByLabelText(/Search by crew name/), 'k7xq2m');
    expect(screen.getByText('Sunset Squad')).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText(/Search by crew name/));
    await userEvent.type(screen.getByLabelText(/Search by crew name/), 'nomatch');
    expect(screen.queryByText('Sunset Squad')).not.toBeInTheDocument();
  });

  it('gives the owner no Remove and removes a member after confirm', async () => {
    render(<AdminCrews />);
    await userEvent.click(await screen.findByRole('button', { name: 'View' }));
    expect(await screen.findByText('Owner')).toBeInTheDocument();
    const removes = screen.getAllByRole('button', { name: 'Remove' });
    expect(removes).toHaveLength(1);
    await userEvent.click(removes[0]!);
    expect(await screen.findByText('Remove @bob from Sunset Squad?')).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('button', { name: 'Remove' }).at(-1)!);
    expect(mockRemove).toHaveBeenCalledWith('c1', 'u2');
  });

  it('load fails, shows the error, Retry reloads', async () => {
    mockFetchCrews.mockRejectedValueOnce(new Error('down'));
    render(<AdminCrews />);
    expect(await screen.findByText("Couldn't load crews")).toBeInTheDocument();
    expect(screen.queryByText('No crews found')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Sunset Squad')).toBeInTheDocument();
    expect(mockFetchCrews).toHaveBeenCalledTimes(2);
  });
});
