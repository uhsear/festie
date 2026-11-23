import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQueryClient } from '../../test-utils';
import AdminDashboard from './AdminDashboard';

const setAdminSearch = vi.fn();
vi.mock('./useAdminSearch', () => ({ useAdminSearch: () => [{}, setAdminSearch] }));

const mockFetch = vi.fn();
vi.mock('@festie/shared/services/admin', () => ({
  fetchAdminDashboard: () => mockFetch(),
}));

let waitingRequests: unknown[] = [];
vi.mock('./adminQueries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./adminQueries')>()),
  useReviewQueue: () => ({ data: { requests: waitingRequests, held: [] } }),
}));

const dashboard = {
  stats: { users: 11, festivals: 3, profiles: 20, picks: 140 },
  health: {
    uptime: 3600,
    memory: { rss: 120 },
    connections: 2,
    onlineRooms: 1,
    database: { totalCount: 4, idleCount: 3, waitingCount: 0 },
    recent: { minutes: 15, requests: 200, serverErrors: 0 },
  },
  recentActivity: [
    { id: 'a1', action: 'user.role.granted', actorUsername: 'asir', createdAt: new Date().toISOString() },
  ],
};

function renderDashboard() {
  return renderWithQueryClient(<AdminDashboard />);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFetch.mockResolvedValue(dashboard);
  waitingRequests = [];
});

describe('AdminDashboard', () => {
  it('shows the one-line health text and the status link', async () => {
    renderDashboard();
    expect(await screen.findByText('All good. No server errors in the last 15 minutes.')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Open the full status page' });
    expect(link).toHaveAttribute('href', '/api/v1/admin/status');
    expect(screen.getByText('Role granted')).toBeInTheDocument();
  });

  it('says how many festivals wait for review and opens Organizations, and says nothing when none wait', async () => {
    waitingRequests = [{ festivalId: 'f1' }, { festivalId: 'f2' }];
    const { unmount } = renderDashboard();
    await userEvent.click(await screen.findByRole('button', { name: /2 festivals are waiting for review/ }));
    expect(setAdminSearch).toHaveBeenCalledWith({ tab: 'organizations' });
    unmount();
    waitingRequests = [];
    renderDashboard();
    await screen.findByText('Statistics');
    expect(screen.queryByText(/waiting for review/)).not.toBeInTheDocument();
  });

  it('marks a failed activity row', async () => {
    mockFetch.mockResolvedValue({
      ...dashboard,
      recentActivity: [
        { id: 'a1', action: 'user.role.granted', actorUsername: 'asir', status: 'failure', createdAt: new Date().toISOString() },
        { id: 'a2', action: 'user.deleted', actorUsername: 'asir', status: 'success', createdAt: new Date().toISOString() },
      ],
    });
    renderDashboard();
    expect(await screen.findByText('Role granted')).toBeInTheDocument();
    expect(screen.getAllByText('Failed')).toHaveLength(1);
  });

  it('Refresh Dashboard is disabled while a refetch is in flight', async () => {
    renderDashboard();
    const refresh = await screen.findByRole('button', { name: 'Refresh Dashboard' });
    mockFetch.mockReturnValue(new Promise(() => {}));
    await userEvent.click(refresh);
    await waitFor(() => expect(refresh).toBeDisabled());
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('Festival plans opens the Analytics tab', async () => {
    renderDashboard();
    await userEvent.click(await screen.findByRole('button', { name: /Festival plans/ }));
    expect(setAdminSearch).toHaveBeenCalledWith({ tab: 'analytics' });
  });

  it('a failed load shows Retry', async () => {
    mockFetch.mockRejectedValue(new Error('boom'));
    renderDashboard();
    expect(await screen.findByText("Couldn't load the dashboard")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
