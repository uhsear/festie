import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({
  navigate: vi.fn(),
  toast: vi.fn(),
  join: vi.fn(),
  preview: { status: 'ready', preview: null } as { status: string; preview: unknown },
  storeError: null as string | null,
}));

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => h.navigate }));
vi.mock('../../lib/toastContext', () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock('@festie/shared/stores', () => ({
  useFestivalStore: (sel: (s: unknown) => unknown) => sel({ currentFestival: { id: 'f1' } }),
}));
vi.mock('@festie/shared/stores/crewStore', () => ({
  useCrewStore: { getState: () => ({ error: h.storeError }) },
}));
vi.mock('@festie/shared/hooks', () => ({
  useInvitePreview: () => h.preview,
  useJoinCrewByInvite: () => h.join,
}));

import JoinCrewSheet from './JoinCrewSheet';

const preview = (over: Record<string, unknown> = {}) => ({
  crewName: 'Bass Gang',
  ownerName: 'DJ Dana',
  memberCount: 6,
  maxMembers: 30,
  spotsLeft: 24,
  festivalId: 'f1',
  festivalName: 'EDC Orlando',
  startDate: '2026-11-06',
  endDate: '2026-11-08',
  expiresAt: null,
  ...over,
});

const renderSheet = (onClose = vi.fn()) => {
  render(<JoinCrewSheet code="ABC123" onClose={onClose} />);
  return onClose;
};

describe('JoinCrewSheet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.storeError = null;
    h.preview = { status: 'ready', preview: preview() };
  });

  it('shows the state line and festival before the Join button', () => {
    renderSheet();
    const state = screen.getByText('Crew of 6 · 24 spots left');
    const join = screen.getByRole('button', { name: 'Join crew' });
    expect(state.compareDocumentPosition(join) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText(/EDC Orlando/)).toBeInTheDocument();
    expect(screen.getByText('Led by DJ Dana')).toBeInTheDocument();
    expect(screen.getByText('Crew members can see your picks and your status.')).toBeInTheDocument();
  });

  it('moves focus into the dialog when it opens', async () => {
    renderSheet();
    await waitFor(() => expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true));
  });

  it('notes a festival switch when the crew is in another festival', () => {
    h.preview = { status: 'ready', preview: preview({ festivalId: 'f2', festivalName: 'Ultra' }) };
    renderSheet();
    expect(screen.getByText('Joining switches you to Ultra.')).toBeInTheDocument();
  });

  it('disables Join when the crew is full', () => {
    h.preview = { status: 'ready', preview: preview({ memberCount: 30, spotsLeft: 0 }) };
    renderSheet();
    expect(screen.getByRole('button', { name: 'Crew is full' })).toBeDisabled();
  });

  it('drops the consent line when the crew is full', () => {
    h.preview = { status: 'ready', preview: preview({ memberCount: 30, spotsLeft: 0 }) };
    renderSheet();
    expect(screen.queryByText('Crew members can see your picks and your status.')).not.toBeInTheDocument();
  });

  it.each(['invalid', 'expired', 'locked'])('offers one Done button beside the header Close and no Join button when the invite is %s', (status) => {
    h.preview = { status, preview: null };
    const onClose = renderSheet();
    expect(screen.queryByRole('button', { name: 'Join crew' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Not now' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalled();
  });

  it.each(['invalid', 'expired', 'locked'])('drops the consent line when the invite is %s', (status) => {
    h.preview = { status, preview: null };
    render(<JoinCrewSheet code="K7XQ2M" onClose={() => {}} />);
    expect(screen.queryByText('Crew members can see your picks and your status.')).not.toBeInTheDocument();
  });

  it('shows the locked message for a locked crew', () => {
    h.preview = { status: 'locked', preview: null };
    renderSheet();
    expect(screen.getByText("This crew isn't taking new members.")).toBeInTheDocument();
  });

  it('keeps Join enabled when the preview is unreachable', () => {
    h.preview = { status: 'unreachable', preview: null };
    renderSheet();
    expect(screen.getByText(/Can't check this invite right now/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Join crew' })).toBeEnabled();
  });

  it('renders a centred dialog, not the bottom drawer, at desktop width', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: true,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    try {
      renderSheet();
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(document.querySelector('[data-vaul-drawer]')).toBeNull();
      expect(screen.getByRole('button', { name: 'Join crew' })).toBeEnabled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('toasts, navigates to /crew and closes after joining', async () => {
    h.join.mockResolvedValue({ kind: 'joined', crew: { name: 'Bass Gang' } });
    const onClose = renderSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Join crew' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(h.join).toHaveBeenCalledWith('ABC123');
    expect(h.toast).toHaveBeenCalledWith('You joined Bass Gang', 'success');
    expect(h.navigate).toHaveBeenCalledWith({ to: '/crew', search: { tab: 'members' } });
  });

  it('says so when the caller is already in the crew', async () => {
    h.join.mockResolvedValue({ kind: 'already', crew: { name: 'Bass Gang' } });
    const onClose = renderSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Join crew' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(h.toast).toHaveBeenCalledWith("You're already in Bass Gang", 'info');
    expect(h.navigate).toHaveBeenCalledWith({ to: '/crew', search: { tab: 'members' } });
  });

  it('tells the user a queued join finishes when back online, without navigating', async () => {
    h.join.mockResolvedValue({ kind: 'queued' });
    const onClose = renderSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Join crew' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(h.toast).toHaveBeenCalledWith("We'll join you when you're back online.", 'info');
    expect(h.navigate).not.toHaveBeenCalled();
  });

  it('keeps the sheet open and shows the error when the join fails', async () => {
    h.join.mockRejectedValue(new Error('boom'));
    h.storeError = 'Crew is full';
    const onClose = renderSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Join crew' }));
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith('Crew is full', 'error', 5000));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Crew is full');
    expect(h.navigate).not.toHaveBeenCalled();
  });
});
