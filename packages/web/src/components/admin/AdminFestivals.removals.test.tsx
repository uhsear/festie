import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { createTestQueryClient, renderWithQueryClient } from '../../test-utils';
import userEvent from '@testing-library/user-event';
import { ApiClientError } from '@festie/shared/services/api';
import AdminFestivals from './AdminFestivals';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a>,
}));
vi.mock('./useAdminSearch', () => ({
  useAdminSearch: () => [{ tab: 'festivals', festival: 'f1', view: 'edit' }, vi.fn()],
}));
vi.mock('../../lib/toastContext', () => ({
  useToast: () => ({ toast: vi.fn(), toastError: vi.fn() }),
}));
vi.mock('./LineupImport', () => ({ default: () => null }));
vi.mock('./FestivalMapEditor', () => ({ default: () => null }));
vi.mock('./FestivalStatusPanel', () => ({ default: () => null }));
vi.mock('../../hooks/useUnsavedChangesGuard', () => ({
  useUnsavedChangesGuard: () => ({ confirmLeave: (fn: () => void) => fn(), guardDialog: null }),
}));
vi.mock('./FestivalEditForm', () => ({
  default: ({ onSave }: { onSave: () => void }) => <button onClick={onSave}>save form</button>,
}));

const render = (ui: React.ReactElement) =>
  renderWithQueryClient(ui, createTestQueryClient({ queries: { gcTime: 0 } }));

const mockGet = vi.fn();
const mockPut = vi.fn();
vi.mock('@festie/shared/services/api', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  api: {
    get: (...a: unknown[]) => mockGet(...a),
    put: (...a: unknown[]) => mockPut(...a),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

const FULL = {
  id: 'f1',
  name: 'Fest',
  location: 'Here',
  timeZone: 'UTC',
  updatedAt: '2026-10-01T00:00:00.000Z',
  stages: [],
  days: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGet.mockImplementation(async (path: string) => (path === '/admin/festivals' ? [FULL] : FULL));
});

describe('AdminFestivals', () => {
  it('opens the removal dialog on CONFIRM_REMOVALS and re-sends with confirmRemovals', async () => {
    mockPut.mockRejectedValueOnce(
      new ApiClientError('This save removes sets', 409, 'CONFIRM_REMOVALS', undefined, undefined, {
        removal: { days: 1, sets: 24, picks: 113, ratings: 0 },
      }),
    );
    mockPut.mockResolvedValueOnce(undefined);

    render(<AdminFestivals />);
    await userEvent.click(await screen.findByRole('button', { name: 'save form' }));

    expect(await screen.findByText('Remove sets with picks?')).toBeInTheDocument();
    expect(screen.getByText(/removes 1 day, 24 sets and 113 picks/)).toBeInTheDocument();
    expect(mockPut.mock.calls[0][1]).toMatchObject({ expectedUpdatedAt: FULL.updatedAt });

    await userEvent.click(screen.getByRole('button', { name: 'Remove and save' }));
    await waitFor(() => expect(mockPut).toHaveBeenCalledTimes(2));
    expect(mockPut.mock.calls[1][1]).toMatchObject({ confirmRemovals: true, expectedUpdatedAt: FULL.updatedAt });
  });

  it('puts the cancel line in the same removal confirm, and says no one is told when alerts are off', async () => {
    mockPut.mockRejectedValueOnce(
      new ApiClientError('This save removes sets', 409, 'CONFIRM_REMOVALS', undefined, undefined, {
        removal: { days: 0, sets: 2, picks: 8, ratings: 0, cancel: { acts: ['Kai'], sets: 2, picks: 8, picked: 4, marked: 8 } },
      }),
    );
    render(<AdminFestivals />);
    await userEvent.click(await screen.findByRole('button', { name: 'save form' }));
    expect(await screen.findByText(/Cancelling Kai removes 2 sets and 8 picks\. 12 people will be told \(8 marked it, 4 picked or set a reminder on the changed sets\)\./)).toBeInTheDocument();
    expect(screen.getAllByText('Remove sets with picks?')).toHaveLength(1);
  });
});
