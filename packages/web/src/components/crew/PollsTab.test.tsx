import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PollsTab from './PollsTab';

const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn() }));

vi.mock('@festie/shared', async (orig) => {
  const actual = await orig<typeof import('@festie/shared')>();
  return {
    ...actual,
    api: { get: apiGet, post: vi.fn() },
    useCrewStore: Object.assign(
      (sel: (s: Record<string, unknown>) => unknown) => sel({ closePoll: vi.fn() }),
      { getState: () => ({ meetingPoints: [] }) },
    ),
    useFestivalStore: (sel: (s: Record<string, unknown>) => unknown) => sel({ currentFestival: { id: 'f1' } }),
  };
});
vi.mock('../../lib/toastContext', () => ({ useToast: () => ({ toast: vi.fn(), toastError: vi.fn() }) }));
vi.mock('../../hooks/useHaptics', () => ({ useHaptics: () => ({ select: vi.fn(), warning: vi.fn() }) }));
vi.mock('./PollItem', () => ({ default: () => <div /> }));
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
  it('disables both create buttons at 3 open polls and shows the cap text', async () => {
    apiGet.mockResolvedValue({ polls: [poll('1'), poll('2'), poll('3')] });
    renderTab();
    const create = await screen.findByRole('button', { name: /Create Poll/ });
    expect(create).toBeDisabled();
    expect(screen.getByRole('button', { name: /Schedule poll/ })).toBeDisabled();
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
