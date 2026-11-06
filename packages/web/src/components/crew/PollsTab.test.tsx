import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PollsTab from './PollsTab';

const { apiGet, closePoll } = vi.hoisted(() => ({ apiGet: vi.fn(), closePoll: vi.fn() }));

vi.mock('@festie/shared', async (orig) => {
  const actual = await orig<typeof import('@festie/shared')>();
  return {
    ...actual,
    api: { get: apiGet, post: vi.fn() },
    useCrewStore: Object.assign(
      (sel: (s: Record<string, unknown>) => unknown) => sel({ closePoll, activeCrew: { id: 'c1', festivalId: 'f-crew', members: [] } }),
      { getState: () => ({ meetingPoints: [] }) },
    ),
    useFestivalStore: (sel: (s: Record<string, unknown>) => unknown) => sel({ currentFestival: { id: 'f1' } }),
  };
});
vi.mock('../../lib/toastContext', () => ({ useToast: () => ({ toast: vi.fn(), toastError: vi.fn() }) }));
vi.mock('../../hooks/useHaptics', () => ({ useHaptics: () => ({ select: vi.fn(), warning: vi.fn() }) }));
vi.mock('./PollItem', () => ({
  default: ({ poll: p, onClose }: { poll: { id: string }; onClose: (id: string) => void }) => (
    <button onClick={() => onClose(p.id)}>{`end ${p.id}`}</button>
  ),
}));
vi.mock('./SchedulePollComposer', () => ({ default: () => <div /> }));

const poll = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  crew_id: 'c1',
  created_by: 'u1',
  question: 'q',
  options: ['a', 'b'],
  votes: [],
  closes_at: null,
  closed: false,
  created_at: '2026-01-01T00:00:00Z',
  ...extra,
});

function renderTab() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PollsTab crewId="c1" currentUserId="u1" isOwner />
    </QueryClientProvider>,
  );
}

describe('PollsTab cap', () => {
  it('disables every create button at 3 open polls and shows the cap text', async () => {
    apiGet.mockResolvedValue({ polls: [poll('1'), poll('2'), poll('3')] });
    renderTab();
    const create = await screen.findByRole('button', { name: /Create Poll/ });
    expect(create).toBeDisabled();
    expect(screen.getByRole('button', { name: /Which set\?/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Meet where\?/ })).toBeDisabled();
    expect(screen.getByText('Close a poll to start another. A crew can have 3 open polls.')).toBeInTheDocument();
  });

  it('does not count an expired poll', async () => {
    apiGet.mockResolvedValue({ polls: [poll('1'), poll('2'), poll('3', { closes_at: '2020-01-01T00:00:00Z' })] });
    renderTab();
    const create = await screen.findByRole('button', { name: /Create Poll/ });
    expect(create).toBeEnabled();
    expect(screen.queryByText(/Close a poll to start another/)).not.toBeInTheDocument();
  });
});

describe('PollsTab failed refetch', () => {
  it('keeps cached polls and shows a retry note instead of the error card', async () => {
    apiGet.mockResolvedValueOnce({ polls: [poll('1')] });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <PollsTab crewId="c1" currentUserId="u1" isOwner />
      </QueryClientProvider>,
    );
    await screen.findByRole('button', { name: /Create Poll/ });
    apiGet.mockRejectedValueOnce(new Error('offline'));
    await act(() => qc.refetchQueries({ queryKey: ['polls', 'c1'] }));
    expect(await screen.findByText(/Showing saved data/)).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load polls")).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Create Poll/ })).toBeInTheDocument();
  });
});

describe('PollsTab end poll', () => {
  it('says a schedule poll creates a meeting point, and seeds the reminder for the crew festival', async () => {
    closePoll.mockResolvedValue(undefined);
    apiGet.mockResolvedValue({ polls: [poll('s1', { set_refs: [{ setId: 'x' }, null] }), poll('p1')] });
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: 'end s1' }));
    expect(await screen.findByText(/becomes a meeting point/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'End poll' }));
    await waitFor(() => expect(closePoll).toHaveBeenCalled());
    expect(closePoll.mock.calls[0]![2]).toMatchObject({ festivalId: 'f-crew' });
  });

  it('keeps the short copy for a plain poll', async () => {
    apiGet.mockResolvedValue({ polls: [poll('p1')] });
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: 'end p1' }));
    expect(await screen.findByText('Voting stops and everyone sees the result.')).toBeInTheDocument();
    expect(screen.queryByText(/becomes a meeting point/)).not.toBeInTheDocument();
  });
});
