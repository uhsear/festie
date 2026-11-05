import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({ navigate: vi.fn(), selectFestival: vi.fn() }));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => h.navigate }));
vi.mock('@festie/shared/stores', () => ({
  useFestivalStore: { getState: () => ({ selectFestival: h.selectFestival }) },
}));

const mockGet = vi.fn();
vi.mock('@festie/shared/services/api', () => ({ api: { get: (...a: unknown[]) => mockGet(...a) } }));

import InviteBanner from './InviteBanner';

const preview = (over: { crewName: string; ownerName: string | null; memberCount: number }) => ({
  maxMembers: 30,
  spotsLeft: 30 - over.memberCount,
  festivalId: 'f1',
  festivalName: 'EDC Orlando',
  startDate: '2026-11-06',
  endDate: '2026-11-08',
  expiresAt: null,
  ...over,
});

describe('InviteBanner', () => {
  beforeEach(() => {
    mockGet.mockReset();
    h.navigate.mockReset();
    h.selectFestival.mockReset().mockResolvedValue(undefined);
    sessionStorage.clear();
    window.history.replaceState({}, '', '/');
  });

  it('renders nothing and fetches nothing without an invite code', () => {
    const { container } = render(<InviteBanner />);
    expect(container).toBeEmptyDOMElement();
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('shows crew, festival, inviter and spots left for a staged code', async () => {
    sessionStorage.setItem('fk.pendingJoinCrew', 'ABC123');
    mockGet.mockResolvedValue(preview({ crewName: 'Bass Gang', ownerName: 'DJ Dana', memberCount: 4 }));
    render(<InviteBanner />);
    expect(await screen.findByText('Bass Gang')).toBeInTheDocument();
    expect(screen.getByText('Led by DJ Dana')).toBeInTheDocument();
    expect(screen.getByText('Crew of 4 · 26 spots left')).toBeInTheDocument();
    expect(screen.getByText(/EDC Orlando/)).toBeInTheDocument();
    expect(mockGet).toHaveBeenCalledWith('/crews/join-preview/ABC123');
  });

  it('falls back to the ?joinCrew= param', async () => {
    window.history.replaceState({}, '', '/?joinCrew=XYZ789');
    mockGet.mockResolvedValue(preview({ crewName: 'Solo', ownerName: null, memberCount: 1 }));
    render(<InviteBanner />);
    expect(await screen.findByText('Solo')).toBeInTheDocument();
    expect(screen.getByText('Crew of 1 · 29 spots left')).toBeInTheDocument();
  });

  it('explains an expired invite', async () => {
    sessionStorage.setItem('fk.pendingJoinCrew', 'OLD123');
    mockGet.mockRejectedValue({ status: 410 });
    render(<InviteBanner />);
    expect(await screen.findByText(/This invite has expired/)).toBeInTheDocument();
  });

  it('says it cannot check, not "expired", when the preview fails to load', async () => {
    sessionStorage.setItem('fk.pendingJoinCrew', 'NET123');
    mockGet.mockRejectedValue(new TypeError('Failed to fetch'));
    render(<InviteBanner />);
    expect(await screen.findByText(/Can't check this invite right now/)).toBeInTheDocument();
    expect(screen.queryByText(/expired/)).not.toBeInTheDocument();
  });

  it('lets a guest look at the lineup first, keeping the staged code', async () => {
    sessionStorage.setItem('fk.pendingJoinCrew', 'ABC123');
    mockGet.mockResolvedValue(preview({ crewName: 'Bass Gang', ownerName: 'DJ Dana', memberCount: 4 }));
    render(<InviteBanner />);
    fireEvent.click(await screen.findByRole('button', { name: 'See the lineup first' }));
    await waitFor(() => expect(h.navigate).toHaveBeenCalledWith({ to: '/cards' }));
    expect(h.selectFestival).toHaveBeenCalledWith('f1');
    expect(sessionStorage.getItem('fk.pendingJoinCrew')).toBe('ABC123');
  });

  it('has no lineup button when the crew has no festival', async () => {
    sessionStorage.setItem('fk.pendingJoinCrew', 'ABC123');
    mockGet.mockResolvedValue({ ...preview({ crewName: 'Bass Gang', ownerName: null, memberCount: 4 }), festivalId: null });
    render(<InviteBanner />);
    await screen.findByText('Bass Gang');
    expect(screen.queryByRole('button', { name: 'See the lineup first' })).not.toBeInTheDocument();
  });
});
