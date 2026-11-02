import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// --- Mocks ---

vi.mock('lucide-react', () => ({
  SlidersHorizontal: () => <span data-testid="sliders-icon" />,
}));

// The store is consumed via selectors: useNotificationPrefsStore((s) => s.x).
// We hold a mutable state object and run the selector against it, mirroring the
// real zustand store surface (prefs / loadPrefs / updatePrefs / isLoading / error).
const mockLoadPrefs = vi.fn().mockResolvedValue(undefined);
const mockUpdatePrefs = vi.fn().mockResolvedValue(undefined);

let storeState: Record<string, unknown>;

const basePrefs = {
  crewUpdates: true,
  setReminders: true,
  scheduleChanges: true,
  lineupDrops: true,
  crewReformed: true,
  wrapReady: true,
  mustSeeReminderMinutes: null,
  dndStart: null,
  dndEnd: null,
};

const mockSetTopic = vi.fn().mockResolvedValue(undefined);
let topicsState: {
  festival: { id: string; name: string } | null;
  subs: { crew: boolean; schedule: boolean } | null;
  error: boolean;
};

function resetStore(overrides: Record<string, unknown> = {}) {
  storeState = {
    prefs: { ...basePrefs },
    loaded: false,
    isLoading: false,
    error: null,
    loadPrefs: mockLoadPrefs,
    updatePrefs: mockUpdatePrefs,
    ...overrides,
  };
}

vi.mock('@festie/shared/stores', () => ({
  useNotificationPrefsStore: (selector: (s: Record<string, unknown>) => unknown) => selector(storeState),
}));

vi.mock('@festie/shared/hooks', () => ({
  useNotificationTopics: () => ({ ...topicsState, setTopic: mockSetTopic }),
}));

vi.mock('../../lib/toastContext', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import NotificationPrefsSection from './NotificationPrefsSection';

beforeEach(() => {
  vi.clearAllMocks();
  mockLoadPrefs.mockResolvedValue(undefined);
  mockUpdatePrefs.mockResolvedValue(undefined);
  mockSetTopic.mockResolvedValue(undefined);
  topicsState = { festival: null, subs: null, error: false };
  resetStore();
});

describe('NotificationPrefsSection', () => {
  it('renders the heading and all toggle switches', () => {
    render(<NotificationPrefsSection />);
    expect(screen.getByText('Notification types')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Set reminders' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Crew picks' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Schedule changes' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Quiet hours' })).toBeInTheDocument();
  });

  it('loads prefs on mount', () => {
    render(<NotificationPrefsSection />);
    expect(mockLoadPrefs).toHaveBeenCalledTimes(1);
  });

  it('reflects current pref values via aria-checked', () => {
    resetStore({
      prefs: {
        ...basePrefs,
        crewUpdates: false,
        scheduleChanges: false,
        dndStart: null,
        dndEnd: null,
      },
    });
    render(<NotificationPrefsSection />);
    expect(screen.getByRole('switch', { name: 'Set reminders' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('switch', { name: 'Crew picks' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('switch', { name: 'Schedule changes' })).toHaveAttribute('aria-checked', 'false');
  });

  it('calls updatePrefs to turn OFF an enabled toggle', async () => {
    const user = userEvent.setup();
    render(<NotificationPrefsSection />);
    await user.click(screen.getByRole('switch', { name: 'Set reminders' }));
    expect(mockUpdatePrefs).toHaveBeenCalledWith({ setReminders: false });
  });

  it('calls updatePrefs to turn ON a disabled toggle', async () => {
    const user = userEvent.setup();
    resetStore({
      prefs: {
        ...basePrefs,
        crewUpdates: false,
        scheduleChanges: true,
        dndStart: null,
        dndEnd: null,
      },
    });
    render(<NotificationPrefsSection />);
    await user.click(screen.getByRole('switch', { name: 'Crew picks' }));
    expect(mockUpdatePrefs).toHaveBeenCalledWith({ crewUpdates: true });
  });

  it('shows quiet hours OFF when no DND window is set', () => {
    render(<NotificationPrefsSection />);
    expect(screen.getByRole('switch', { name: 'Quiet hours' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText('Mute 11:00 PM–8:00 AM')).toBeInTheDocument();
  });

  it('shows quiet hours ON when a DND window is set', () => {
    resetStore({
      prefs: {
        ...basePrefs,
        crewUpdates: true,
        scheduleChanges: true,
        dndStart: '23:00',
        dndEnd: '08:00',
      },
    });
    render(<NotificationPrefsSection />);
    expect(screen.getByRole('switch', { name: 'Quiet hours' })).toHaveAttribute('aria-checked', 'true');
  });

  it('names the quiet-hours zone in the caption when one is stored', () => {
    resetStore({
      prefs: {
        ...basePrefs,
        crewUpdates: true,
        scheduleChanges: true,
        dndStart: '23:00',
        dndEnd: '08:00',
        dndTimeZone: 'America/Los_Angeles',
      },
    });
    render(<NotificationPrefsSection />);
    expect(screen.getByText('Mute 11:00 PM–8:00 AM (Los Angeles time)')).toBeInTheDocument();
  });

  it('enabling quiet hours sends a DND start/end window to updatePrefs', async () => {
    const user = userEvent.setup();
    render(<NotificationPrefsSection />);
    await user.click(screen.getByRole('switch', { name: 'Quiet hours' }));
    expect(mockUpdatePrefs).toHaveBeenCalledWith({ dndStart: '23:00', dndEnd: '08:00' });
  });

  it('disabling quiet hours clears the DND window via updatePrefs', async () => {
    const user = userEvent.setup();
    resetStore({
      prefs: {
        ...basePrefs,
        crewUpdates: true,
        scheduleChanges: true,
        dndStart: '23:00',
        dndEnd: '08:00',
      },
    });
    render(<NotificationPrefsSection />);
    await user.click(screen.getByRole('switch', { name: 'Quiet hours' }));
    expect(mockUpdatePrefs).toHaveBeenCalledWith({ dndStart: null, dndEnd: null });
  });

  it('renders without crashing in the loading state', () => {
    resetStore({ isLoading: true, loaded: true });
    render(<NotificationPrefsSection />);
    // Already loaded: a background refresh keeps the toggles on screen.
    expect(screen.getByRole('switch', { name: 'Set reminders' })).toBeInTheDocument();
  });

  it('renders without crashing in an error state', () => {
    resetStore({ error: 'Failed to load notification settings' });
    render(<NotificationPrefsSection />);
    expect(screen.getByText('Notification types')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Crew picks' })).toBeInTheDocument();
  });

  it('does not throw if updatePrefs rejects (failure is swallowed)', async () => {
    const user = userEvent.setup();
    mockUpdatePrefs.mockRejectedValue(new Error('network'));
    render(<NotificationPrefsSection />);
    await user.click(screen.getByRole('switch', { name: 'Schedule changes' }));
    await waitFor(() => expect(mockUpdatePrefs).toHaveBeenCalledWith({ scheduleChanges: false }));
    // No unhandled rejection / thrown error reaching the test.
    expect(screen.getByText('Notification types')).toBeInTheDocument();
  });

  it('shows skeletons, not switches, until the first load finishes', () => {
    resetStore({ isLoading: true, loaded: false });
    const { rerender } = render(<NotificationPrefsSection />);
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.getAllByRole('status')).toHaveLength(4);
    resetStore({ isLoading: false, loaded: true });
    rerender(<NotificationPrefsSection />);
    expect(screen.getByRole('switch', { name: 'Set reminders' })).toBeInTheDocument();
  });

  it('renders the store error with role="alert"', () => {
    resetStore({ error: 'Failed to save notification settings', loaded: true });
    render(<NotificationPrefsSection />);
    expect(screen.getByRole('alert')).toHaveTextContent('Failed to save notification settings');
  });

  it('renders no per-festival rows when the user has not joined the festival', () => {
    render(<NotificationPrefsSection />);
    expect(screen.queryByText(/Only for/)).toBeNull();
  });

  it('disables the festival Crew picks switch when the global crewUpdates is off', () => {
    resetStore({ prefs: { ...basePrefs, crewUpdates: false } });
    topicsState = { festival: { id: 'f1', name: 'EDC' }, subs: { crew: true, schedule: true }, error: false };
    render(<NotificationPrefsSection />);
    const switches = screen.getAllByRole('switch', { name: 'Crew picks' });
    const festivalSwitch = switches[1];
    expect(festivalSwitch).toBeDisabled();
    expect(festivalSwitch).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText('Off for every festival')).toBeInTheDocument();
  });

  it('shows two skeleton rows while the festival topics load', () => {
    topicsState = { festival: { id: 'f1', name: 'EDC' }, subs: null, error: false };
    render(<NotificationPrefsSection />);
    expect(screen.getByText('Only for EDC')).toBeInTheDocument();
    expect(screen.getAllByRole('status')).toHaveLength(2);
  });

  it('applies the Festival nights preset to updatePrefs', async () => {
    const user = userEvent.setup();
    resetStore({ prefs: { ...basePrefs, dndStart: '23:00', dndEnd: '08:00' } });
    render(<NotificationPrefsSection />);
    await user.click(screen.getByRole('button', { name: /Festival nights/ }));
    expect(mockUpdatePrefs).toHaveBeenCalledWith({ dndStart: '04:00', dndEnd: '11:00' });
  });

  it('does not render the crew rows that have no sender yet', () => {
    render(<NotificationPrefsSection />);
    for (const name of ['Meeting points', 'Polls', 'Money', 'Rides']) {
      expect(screen.queryByRole('switch', { name })).toBeNull();
    }
  });

  it('saves the must-see lead time through updatePrefs', async () => {
    const user = userEvent.setup();
    render(<NotificationPrefsSection />);
    await user.selectOptions(screen.getByLabelText(/Must-see reminders/), '15');
    expect(mockUpdatePrefs).toHaveBeenCalledWith({ mustSeeReminderMinutes: 15 });
  });

  it('says the lineup, reform and wrap-up toggles cover email as well as push', () => {
    render(<NotificationPrefsSection />);
    expect(screen.getAllByText(/By push and email\./)).toHaveLength(3);
  });
});
