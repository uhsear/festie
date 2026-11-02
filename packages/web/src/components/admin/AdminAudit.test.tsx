import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AdminAudit from './AdminAudit';

const mockToast = vi.fn();
vi.mock('../../lib/toastContext', () => ({
  useToast: () => ({ toast: mockToast, toastError: vi.fn() }),
}));

// Stateful stand-in for the URL: setAdminSearch updates q the way the router would.
let initialQ: string | undefined;
vi.mock('./useAdminSearch', async () => {
  const react = await import('react');
  return {
    useAdminSearch: () => {
      const [search, set] = react.useState<{ q?: string }>(initialQ ? { q: initialQ } : {});
      return [search, (next: { q?: string }) => set(next)];
    },
  };
});

const mockFetchPage = vi.fn();
const mockExport = vi.fn();
vi.mock('@festie/shared/services/admin', () => ({
  fetchAuditPage: (...a: unknown[]) => mockFetchPage(...a),
  exportAuditCsv: (...a: unknown[]) => mockExport(...a),
}));

const entry = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  action: 'festival.updated',
  actorType: 'admin',
  actorId: 'a1',
  actorUsername: 'asir',
  targetType: 'festival',
  targetId: 'f1',
  targetLabel: 'Forbidden Kingdom',
  details: null,
  status: 'success',
  createdAt: new Date().toISOString(),
  requestId: null,
  ...extra,
});

function renderAudit() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AdminAudit />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  initialQ = undefined;
  mockFetchPage.mockImplementation(async (p: { cursor?: string | null }) =>
    p.cursor
      ? { entries: [entry('p2')], nextCursor: null, total: 51 }
      : { entries: [entry('p1')], nextCursor: 'cursor-2', total: 51 },
  );
});

describe('AdminAudit', () => {
  it('titles rows with auditActionLabel and Next uses nextCursor', async () => {
    renderAudit();
    expect(await screen.findByText('Festival updated')).toBeInTheDocument();
    expect(mockFetchPage).toHaveBeenLastCalledWith(expect.objectContaining({ scope: 'admin', cursor: null }));
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() =>
      expect(mockFetchPage).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: 'cursor-2' })),
    );
    await waitFor(() => expect(screen.getByText('Page 2')).toBeInTheDocument());
  });

  it('User activity toggle sends scope=user', async () => {
    renderAudit();
    await screen.findByText('Festival updated');
    await userEvent.click(screen.getByRole('button', { name: 'User activity' }));
    await waitFor(() =>
      expect(mockFetchPage).toHaveBeenLastCalledWith(expect.objectContaining({ scope: 'user', cursor: null })),
    );
  });

  describe('typing', () => {
    afterEach(() => vi.useRealTimers());

    it('eight keystrokes give one filtered fetch after 300 ms', async () => {
      renderAudit();
      await screen.findByText('Festival updated');
      vi.useFakeTimers();
      const input = screen.getByLabelText('Search the audit log');
      for (const value of ['a', 'ac', 'act', 'acto', 'actor', 'actor:', 'actor:a', 'actor:asir']) {
        fireEvent.change(input, { target: { value } });
      }
      await act(async () => {
        await vi.advanceTimersByTimeAsync(299);
      });
      expect(mockFetchPage.mock.calls.filter(([p]) => p.actor)).toHaveLength(0);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2);
      });
      const filtered = mockFetchPage.mock.calls.filter(([p]) => p.actor === 'asir');
      expect(filtered).toHaveLength(1);
      expect(mockFetchPage.mock.calls.filter(([p]) => p.actor && p.actor !== 'asir')).toHaveLength(0);
    });
  });

  it('a bad token shows the error and makes no call', async () => {
    initialQ = 'colour:red';
    renderAudit();
    expect(await screen.findByRole('alert')).toHaveTextContent('Unknown filter "colour:red"');
    await waitFor(() => expect(mockFetchPage).toHaveBeenCalledTimes(1));
    expect(mockFetchPage).toHaveBeenLastCalledWith(expect.not.objectContaining({ actor: expect.anything() }));
  });

  it('removing a chip updates q and refetches without the filter', async () => {
    initialQ = 'actor:asir';
    renderAudit();
    await screen.findByText('Festival updated');
    expect(mockFetchPage).toHaveBeenLastCalledWith(expect.objectContaining({ actor: 'asir' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove filter actor:asir' }));
    await waitFor(() => expect(screen.queryByText('actor:asir', { selector: 'li' })).not.toBeInTheDocument());
    expect(screen.getByLabelText('Search the audit log')).toHaveValue('');
  });

  it('an action chip swaps the action filter for its prefix', async () => {
    initialQ = 'actor:asir action:crew.*';
    renderAudit();
    await screen.findByText('Festival updated');
    await userEvent.click(screen.getByRole('button', { name: 'Reset links' }));
    await waitFor(() =>
      expect(mockFetchPage).toHaveBeenLastCalledWith(
        expect.objectContaining({ actor: 'asir', action: 'user.password_reset_link.*' }),
      ),
    );
    expect(screen.getByRole('button', { name: 'Reset links' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'All' }));
    await waitFor(() => expect(screen.getByLabelText('Search the audit log')).toHaveValue('actor:asir'));
  });

  it('keeps a trailing space typed before the debounce commits', async () => {
    renderAudit();
    await screen.findByText('Festival updated');
    const input = screen.getByLabelText('Search the audit log');
    await userEvent.type(input, 'actor:asir ');
    await waitFor(() => expect(mockFetchPage).toHaveBeenLastCalledWith(expect.objectContaining({ actor: 'asir' })));
    expect(input).toHaveValue('actor:asir ');
  });

  it('shows changes, request ID and raw details when a row opens', async () => {
    mockFetchPage.mockResolvedValue({
      entries: [
        entry('c1', { details: { changes: { name: ['Forbidden Kingdom', 'Forbidden Kingdom 2026'] } }, requestId: 'req-9' }),
      ],
      nextCursor: null,
      total: 1,
    });
    renderAudit();
    await userEvent.click(await screen.findByText('Festival updated'));
    expect(screen.getByText('Forbidden Kingdom 2026')).toBeInTheDocument();
    expect(screen.getByText('Request ID: req-9')).toBeInTheDocument();
    expect(screen.getByText('Raw details')).toBeInTheDocument();
  });

  it('Export CSV calls exportAuditCsv and creates a download URL', async () => {
    mockExport.mockResolvedValue({ csv: 'a,b', rows: 2, capped: false });
    const create = vi.fn(() => 'blob:x');
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    renderAudit();
    await screen.findByText('Festival updated');
    await userEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(mockExport).toHaveBeenCalledWith(expect.objectContaining({ scope: 'admin' }));
    expect(mockToast).toHaveBeenCalledWith('Exported 2 rows.', 'success');
  });

  it('a failed load shows Retry, not the empty state', async () => {
    mockFetchPage.mockRejectedValue(new Error('boom'));
    renderAudit();
    expect(await screen.findByText("Couldn't load the audit log")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.queryByText('No audit entries found')).not.toBeInTheDocument();
  });
});
