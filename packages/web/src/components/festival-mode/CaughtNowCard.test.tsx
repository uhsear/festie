import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const markCaught = vi.fn();
const apiGet = vi.fn();
vi.mock('@festie/shared/services', () => ({
  api: { get: (...a: unknown[]) => apiGet(...a) },
  markCaught: (...a: unknown[]) => markCaught(...a),
}));

let authUser: { id: string } | null = null;
let state: Record<string, unknown> = {};
vi.mock('@festie/shared/stores', () => ({
  useAuthStore: (sel: (s: { user: unknown }) => unknown) => sel({ user: authUser }),
  useFestivalStore: (sel: (s: Record<string, unknown>) => unknown) => sel(state),
}));

const toastError = vi.fn();
vi.mock('../../lib/toastContext', () => ({ useToast: () => ({ toastError }) }));

import CaughtNowCard from './CaughtNowCard';

// 2026-06-12 18:30 UTC; festival zone UTC.
const NOW = Date.UTC(2026, 5, 12, 18, 30);
const DAYS = [{ id: 'd0', date: '2026-06-12' }];
const SETS = [
  { id: 'live', artist: 'Odesza', stageId: 'main', dayIndex: 0, startTime: '18:00', endTime: '19:00' },
  { id: 'ended', artist: 'Bicep', stageId: 'main', dayIndex: 0, startTime: '16:00', endTime: '17:00' },
  { id: 'old', artist: 'Old Act', stageId: 'main', dayIndex: 0, startTime: '10:00', endTime: '11:00' },
  { id: 'other', artist: 'Not Picked', stageId: 'main', dayIndex: 0, startTime: '18:00', endTime: '19:00' },
];
const PICKS = { live: 'must', ended: 'must', old: 'must' };

const wrap = (caught: boolean | null) => ({
  planned: [{ setId: 'live', caught }],
  festival: { days: DAYS },
});

function renderCard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CaughtNowCard festivalId="f1" nowMs={NOW} timeZone="UTC" getStageName={() => 'Main'} />
    </QueryClientProvider>,
  );
}

describe('CaughtNowCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authUser = { id: 'me' };
    state = { sets: SETS, days: DAYS, currentProfile: { picks: PICKS } };
    apiGet.mockResolvedValue(wrap(null));
    markCaught.mockResolvedValue({});
  });

  it('renders nothing for a guest', () => {
    authUser = null;
    const { container } = renderCard();
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when nothing is catchable', () => {
    state = { sets: SETS, days: DAYS, currentProfile: { picks: { old: 'must' } } };
    const { container } = renderCard();
    expect(container).toBeEmptyDOMElement();
  });

  it('lists live and recently ended picks with meta', () => {
    renderCard();
    expect(screen.getByRole('heading', { name: 'Did you catch it?' })).toBeInTheDocument();
    expect(screen.getByText('Playing now · Main')).toBeInTheDocument();
    expect(screen.getByText('Ended 1 h ago · Main')).toBeInTheDocument();
    expect(screen.queryByText('Old Act')).toBeNull();
    expect(screen.queryByText('Not Picked')).toBeNull();
  });

  it('toggles the mark on and off', async () => {
    renderCard();
    const btn = screen.getByRole('button', { name: 'Caught Odesza' });
    expect(btn).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(btn);
    expect(markCaught).toHaveBeenLastCalledWith('live', true, 'me');
    expect(btn).toHaveAttribute('aria-pressed', 'true');
    expect(btn).toHaveTextContent('Caught');
    await userEvent.click(btn);
    expect(markCaught).toHaveBeenLastCalledWith('live', null, 'me');
    expect(btn).toHaveAttribute('aria-pressed', 'false');
  });

  it('reads an existing mark from the wrap query', async () => {
    apiGet.mockResolvedValue(wrap(true));
    renderCard();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Caught Odesza' })).toHaveAttribute('aria-pressed', 'true'));
  });

  it('rolls back and toasts when the write fails', async () => {
    markCaught.mockRejectedValue(new Error('boom'));
    renderCard();
    const btn = screen.getByRole('button', { name: 'Caught Odesza' });
    await userEvent.click(btn);
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(expect.any(Error), "Couldn't save that. Try again."));
    expect(btn).toHaveAttribute('aria-pressed', 'false');
  });
});
