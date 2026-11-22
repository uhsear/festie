import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const h = vi.hoisted(() => ({
  statuses: [] as unknown[],
  members: [] as unknown[],
  updateMyStatus: vi.fn(),
  useAutoArrive: vi.fn(),
  stage: { value: null as string | null },
  loadStatuses: vi.fn(),
}));

vi.mock('@festie/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@festie/shared')>()),
  useCrewStore: (selector: (s: unknown) => unknown) =>
    selector({
      crewStatuses: h.statuses,
      crewMembers: h.members,
      loadStatuses: h.loadStatuses,
      updateMyStatus: h.updateMyStatus,
    }),
  formatStaleness: () => '1h ago',
  etaMinutes: () => null,
  writeOutcomeMessage: (_o: string, m: string) => m,
}));

vi.mock('@festie/shared/hooks', () => ({
  useCurrentPosition: () => ({ locating: false, getCurrentPosition: vi.fn().mockResolvedValue(undefined) }),
  useAutoArrive: h.useAutoArrive,
  useFestival: () => ({ getStageName: () => undefined }),
}));

vi.mock('@festie/shared/stores', () => ({
  useFestivalStore: (selector: (s: unknown) => unknown) =>
    selector({ sets: [], days: [], currentProfile: null, currentFestival: null }),
}));

vi.mock('@festie/shared/utils', async () => {
  const actual = await vi.importActual<typeof import('@festie/shared/utils')>('@festie/shared/utils');
  return { ...actual, presetStageName: () => h.stage.value };
});

vi.mock('../../lib/toastContext', () => ({ useToast: () => ({ toast: vi.fn(), toastError: vi.fn() }) }));

import { useUIStore } from '@festie/shared/stores/uiStore';
import CrewStatus from './CrewStatus';

const row = (user_id: string, status: string, hoursAgo: number) => ({
  user_id,
  name: user_id,
  status,
  note: null,
  target_meeting_point_id: null,
  eta_minutes: null,
  updated_at: new Date(Date.now() - hoursAgo * 3_600_000).toISOString(),
});

const offlineError = () =>
  Object.assign(new Error('Failed to fetch'), { name: 'ApiClientError', status: 0, isNetworkError: true });
const serverError = () => Object.assign(new Error('upstream exploded'), { name: 'ApiClientError', status: 503 });
const OFFLINE_COPY = "You're offline. Check your connection and try again.";
const SERVER_COPY = 'Something went wrong on our side. Try again in a minute.';

function renderStatus() {
  return render(<CrewStatus crewId="c1" currentUserId="me" meetingPoints={[]} />);
}

describe('CrewStatus', () => {
  beforeEach(() => {
    h.statuses = [];
    h.members = [];
    h.stage.value = null;
    h.updateMyStatus.mockReset().mockResolvedValue('sent');
    h.useAutoArrive.mockClear();
    h.loadStatuses.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    useUIStore.setState({ offlineMode: false });
  });

  it('shows one loading status while statuses load', () => {
    h.loadStatuses.mockReturnValue(new Promise(() => {}));
    renderStatus();
    expect(screen.getAllByRole('status')).toHaveLength(1);
  });

  it('says the device is offline when the load fails offline', async () => {
    h.loadStatuses.mockRejectedValue(offlineError());
    renderStatus();
    expect(await screen.findByText("Couldn't load crew status")).toBeInTheDocument();
    expect(screen.getByText(OFFLINE_COPY)).toBeInTheDocument();
  });

  it('keeps the cached statuses and shows a small note, not the error panel, when the load fails in offline mode', async () => {
    useUIStore.setState({ offlineMode: true });
    h.statuses = [row('sam', 'here', 1)];
    h.loadStatuses.mockRejectedValue(offlineError());
    renderStatus();
    expect(await screen.findByText(/You're offline\. Showing the last saved status\./)).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load crew status")).not.toBeInTheDocument();
    expect(screen.getByText('sam', { exact: false })).toBeInTheDocument();
  });

  it('shows the error panel, not the cached note, when offline with no cached statuses', async () => {
    useUIStore.setState({ offlineMode: true });
    h.members = [{ userId: 'u1', name: 'User 1' }];
    h.loadStatuses.mockRejectedValue(offlineError());
    renderStatus();
    expect(await screen.findByText("Couldn't load crew status")).toBeInTheDocument();
    expect(screen.queryByText(/Showing the last saved status/)).not.toBeInTheDocument();
    expect(screen.queryByText(/No one has shared a status yet/)).not.toBeInTheDocument();
  });

  it('reloads when the device comes back online while the load error is showing', async () => {
    useUIStore.setState({ offlineMode: true });
    h.statuses = [row('sam', 'here', 1)];
    h.loadStatuses.mockRejectedValue(offlineError());
    renderStatus();
    await screen.findByText(/Showing the last saved status/);
    const calls = h.loadStatuses.mock.calls.length;
    h.loadStatuses.mockResolvedValue(undefined);
    act(() => useUIStore.setState({ offlineMode: false }));
    await waitFor(() => expect(h.loadStatuses.mock.calls.length).toBeGreaterThan(calls));
  });

  it('says the server failed when the load fails with a 5xx', async () => {
    h.loadStatuses.mockRejectedValue(serverError());
    renderStatus();
    expect(await screen.findByText(SERVER_COPY)).toBeInTheDocument();
    expect(screen.queryByText(/upstream exploded/)).not.toBeInTheDocument();
  });

  it('shows the roster line when nobody has a status', async () => {
    h.members = [1, 2, 3].map((n) => ({ userId: `u${n}`, name: `User ${n}` }));
    renderStatus();
    expect(await screen.findByText('No one has shared a status yet · 3 members')).toBeInTheDocument();
  });

  it('hides a 5-hour-old status and shows a 1-hour-old one', async () => {
    h.statuses = [row('old', 'at-camp', 5), row('new', 'break', 1)];
    renderStatus();
    expect(await screen.findByText('Taking a break')).toBeInTheDocument();
    expect(screen.queryByText('At camp')).not.toBeInTheDocument();
  });

  it('sends the At camp preset', async () => {
    const user = userEvent.setup();
    renderStatus();
    await user.click(await screen.findByRole('button', { name: 'Share status' }));
    await user.click(screen.getByRole('button', { name: 'At camp' }));
    expect(h.updateMyStatus).toHaveBeenCalledWith(
      'c1',
      expect.objectContaining({ status: 'at-camp', note: null }),
      'me',
    );
  });

  it('sends the stage name as the note for At {stage}', async () => {
    h.stage.value = 'Main Stage';
    const user = userEvent.setup();
    renderStatus();
    await user.click(await screen.findByRole('button', { name: 'Share status' }));
    await user.click(screen.getByRole('button', { name: 'At Main Stage' }));
    expect(h.updateMyStatus).toHaveBeenCalledWith(
      'c1',
      expect.objectContaining({ status: 'at-stage', note: 'Main Stage' }),
      'me',
    );
  });

  it('opens the On my way form from its preset', async () => {
    const user = userEvent.setup();
    renderStatus();
    await user.click(await screen.findByRole('button', { name: 'Share status' }));
    await user.click(screen.getByRole('button', { name: 'On my way…' }));
    expect(screen.getByText('Heading to')).toBeInTheDocument();
  });

  it('wires useAutoArrive with the crew id', () => {
    renderStatus();
    expect(h.useAutoArrive).toHaveBeenCalledWith(expect.objectContaining({ crewId: 'c1', userId: 'me' }));
  });
});
