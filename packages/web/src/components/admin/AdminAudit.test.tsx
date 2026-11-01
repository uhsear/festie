import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AdminAudit from './AdminAudit';

vi.mock('../../lib/toastContext', () => ({
  useToast: () => ({ toast: vi.fn(), toastError: vi.fn() }),
}));

const mockFetchPage = vi.fn();
vi.mock('@festie/shared/services/admin', () => ({
  fetchAuditPage: (...a: unknown[]) => mockFetchPage(...a),
}));

const entry = (id: string) => ({
  id,
  action: 'admin:user_delete',
  friendlyAction: `Action ${id}`,
  actorType: 'admin',
  actorId: 'a1',
  actorUsername: 'asir',
  targetType: 'user',
  targetId: 'u1',
  targetLabel: 'bob',
  details: null,
  status: 'success',
  createdAt: new Date().toISOString(),
});

beforeEach(() => {
  vi.clearAllMocks();
  mockFetchPage.mockImplementation(async (p: { cursor?: string | null }) =>
    p.cursor
      ? { entries: [entry('p2')], nextCursor: null, total: 51 }
      : { entries: [entry('p1')], nextCursor: 'cursor-2', total: 51 },
  );
});

describe('AdminAudit', () => {
  it('opens on Admin actions and Next uses meta nextCursor', async () => {
    render(<AdminAudit />);
    expect(await screen.findByText('Action p1')).toBeInTheDocument();
    expect(mockFetchPage).toHaveBeenLastCalledWith(expect.objectContaining({ scope: 'admin', cursor: null }));

    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('Action p2')).toBeInTheDocument();
    expect(mockFetchPage).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: 'cursor-2' }));

    await userEvent.click(screen.getByRole('button', { name: 'Previous' }));
    expect(await screen.findByText('Action p1')).toBeInTheDocument();
  });

  it('User activity toggle sends scope=user', async () => {
    render(<AdminAudit />);
    await screen.findByText('Action p1');
    await userEvent.click(screen.getByRole('button', { name: 'User activity' }));
    await waitFor(() =>
      expect(mockFetchPage).toHaveBeenLastCalledWith(expect.objectContaining({ scope: 'user', cursor: null })),
    );
  });
});
