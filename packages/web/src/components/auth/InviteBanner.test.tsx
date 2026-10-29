import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const mockGet = vi.fn();
vi.mock('@festie/shared/services/api', () => ({ api: { get: (...a: unknown[]) => mockGet(...a) } }));

import InviteBanner from './InviteBanner';

describe('InviteBanner', () => {
  beforeEach(() => {
    mockGet.mockReset();
    sessionStorage.clear();
    window.history.replaceState({}, '', '/');
  });

  it('renders nothing and fetches nothing without an invite code', () => {
    const { container } = render(<InviteBanner />);
    expect(container).toBeEmptyDOMElement();
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('shows crew name, inviter and member count for a staged code', async () => {
    sessionStorage.setItem('fk.pendingJoinCrew', 'ABC123');
    mockGet.mockResolvedValue({ crewName: 'Bass Gang', ownerName: 'DJ Dana', memberCount: 4, expiresAt: null });
    render(<InviteBanner />);
    expect(await screen.findByText('Bass Gang')).toBeInTheDocument();
    expect(screen.getByText(/DJ Dana invited you/)).toBeInTheDocument();
    expect(screen.getByText(/4 members so far/)).toBeInTheDocument();
    expect(mockGet).toHaveBeenCalledWith('/crews/join-preview/ABC123');
  });

  it('falls back to the ?joinCrew= param', async () => {
    window.history.replaceState({}, '', '/?joinCrew=XYZ789');
    mockGet.mockResolvedValue({ crewName: 'Solo', ownerName: null, memberCount: 1, expiresAt: null });
    render(<InviteBanner />);
    expect(await screen.findByText('Solo')).toBeInTheDocument();
    expect(screen.getByText(/1 member so far/)).toBeInTheDocument();
  });

  it('explains an expired or invalid invite', async () => {
    sessionStorage.setItem('fk.pendingJoinCrew', 'OLD123');
    mockGet.mockRejectedValue(new Error('gone'));
    render(<InviteBanner />);
    expect(await screen.findByText(/expired or is no longer valid/)).toBeInTheDocument();
  });
});
