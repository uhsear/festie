import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }));

const fetchDetail = vi.fn();
vi.mock('@festie/shared/services/admin', () => ({
  fetchAdminUserDetail: (...a: unknown[]) => fetchDetail(...a),
}));

import { ApiClientError } from '@festie/shared/services/api';
import AdminUserDetail from './AdminUserDetail';

beforeEach(() => vi.clearAllMocks());

describe('AdminUserDetail', () => {
  it('renders pick counts, crew roles and the audit notice', async () => {
    fetchDetail.mockResolvedValue({
      user: {
        id: 'u1',
        username: 'alice',
        displayName: 'Alice A',
        email: 'alice@example.com',
        emailVerified: false,
        createdAt: '2026-01-01T00:00:00Z',
        lastActiveAt: null,
        roles: [],
        publicSchedule: false,
      },
      festivals: [
        { festivalId: 'f1', festivalName: 'EDC', profileName: 'Al', picks: 3, joinedAt: '2026-01-02T00:00:00Z' },
      ],
      crews: [
        {
          id: 'c1',
          name: 'Crew A',
          festivalId: 'f1',
          festivalName: 'EDC',
          role: 'owner',
          joinedAt: '2026-01-02T00:00:00Z',
          memberCount: 4,
        },
      ],
      activity: [],
    });
    render(<AdminUserDetail userId="u1" />);
    expect(await screen.findByText('@alice')).toBeInTheDocument();
    expect(screen.getByText(/3 picks/)).toBeInTheDocument();
    expect(screen.getByText(/Owner/)).toBeInTheDocument();
    expect(screen.getByText('Opening this page is recorded in the audit log.')).toBeInTheDocument();
    expect(screen.getByText('No active session')).toBeInTheDocument();
  });

  it('a 404 renders the no-longer-exists message', async () => {
    fetchDetail.mockRejectedValue(new ApiClientError('User not found', 404));
    render(<AdminUserDetail userId="gone" />);
    expect(await screen.findByText('This user no longer exists.')).toBeInTheDocument();
  });
});
