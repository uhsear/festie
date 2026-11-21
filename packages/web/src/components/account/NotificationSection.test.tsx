import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const toast = vi.fn();
const toastError = vi.fn();
vi.mock('../../lib/toastContext', () => ({ useToast: () => ({ toast, toastError }) }));

const requestPermission = vi.fn();
const registerToken = vi.fn();
const unregisterToken = vi.fn();
const retry = vi.fn();
let push: Record<string, unknown>;
vi.mock('../../hooks/usePushNotifications', () => ({ usePushNotifications: () => push }));

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
  crewNudges: true,
  crewMeetingPoints: true,
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

import NotificationSection from './NotificationSection';

beforeEach(() => {
  vi.clearAllMocks();
  mockLoadPrefs.mockResolvedValue(undefined);
  mockUpdatePrefs.mockResolvedValue(undefined);
  mockSetTopic.mockResolvedValue(undefined);
  topicsState = { festival: null, subs: null, error: false };
  resetStore();
  push = {
    isSupported: true,
    checking: false,
    keyError: false,
    unsupportedReason: null,
    permission: 'default',
    subscribed: false,
    retry,
    requestPermission,
    registerToken,
    unregisterToken,
  };
});

describe('NotificationSection', () => {
  it('hides the push controls while checking or when push is not configured', () => {
    push.checking = true;
    const { rerender } = render(<NotificationSection />);
    expect(screen.queryByText('Push Notifications')).toBeNull();
    expect(screen.getByText('Notification types')).toBeInTheDocument();
    push.checking = false;
    push.unsupportedReason = 'not-configured';
    rerender(<NotificationSection />);
    expect(screen.queryByText('Push Notifications')).toBeNull();
    expect(screen.getByText('Notification types')).toBeInTheDocument();
  });

  it('offers retry when the key request failed', async () => {
    push.keyError = true;
    render(<NotificationSection />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalled();
  });

  it('explains the Home Screen requirement on iOS', () => {
    push.isSupported = false;
    push.unsupportedReason = 'ios-needs-install';
    render(<NotificationSection />);
    expect(screen.getByText('Add to Home Screen')).toBeInTheDocument();
  });

  it('says so when the browser is unsupported', () => {
    push.isSupported = false;
    render(<NotificationSection />);
    expect(screen.getByText(/Not supported on this browser/)).toBeInTheDocument();
  });

  it('tells the user how to unblock a denied permission', () => {
    push.permission = 'denied';
    render(<NotificationSection />);
    expect(screen.getByText(/Permission blocked/)).toBeInTheDocument();
  });

  it('requests permission, registers and toasts on grant', async () => {
    requestPermission.mockResolvedValue('granted');
    registerToken.mockResolvedValue(undefined);
    render(<NotificationSection />);
    await userEvent.click(screen.getByRole('button', { name: 'Enable Notifications' }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Push notifications enabled', 'success'));
    expect(registerToken).toHaveBeenCalled();
  });

  it('toasts an error when permission is denied and skips registration', async () => {
    requestPermission.mockResolvedValue('denied');
    render(<NotificationSection />);
    await userEvent.click(screen.getByRole('button', { name: 'Enable Notifications' }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.stringMatching(/Permission denied/), 'error'));
    expect(registerToken).not.toHaveBeenCalled();
  });

  it('reports a failed permission request through toastError', async () => {
    const err = new Error('boom');
    requestPermission.mockRejectedValue(err);
    render(<NotificationSection />);
    await userEvent.click(screen.getByRole('button', { name: 'Enable Notifications' }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(err, expect.any(String)));
  });

  it('resubscribes without a prompt when permission is already granted', async () => {
    push.permission = 'granted';
    registerToken.mockResolvedValue(undefined);
    render(<NotificationSection />);
    await userEvent.click(screen.getByRole('button', { name: 'Enable Notifications' }));
    await waitFor(() => expect(registerToken).toHaveBeenCalled());
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it('disables notifications when subscribed', async () => {
    push.permission = 'granted';
    push.subscribed = true;
    unregisterToken.mockResolvedValue(undefined);
    render(<NotificationSection />);
    await userEvent.click(screen.getByRole('button', { name: 'Disable Notifications' }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Push notifications disabled', 'success'));
  });

  it('has no structural accessibility violations', async () => {
    const { container } = render(<NotificationSection />);
    await expect(container).toBeAccessible();
  });
});

describe('NotificationSection preferences', () => {
  it('renders the heading and all toggle switches', () => {
    render(<NotificationSection />);
    expect(screen.getByText('Notification types')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Set reminders' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Crew picks' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Schedule changes' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Quiet hours' })).toBeInTheDocument();
  });

  it('loads prefs on mount', () => {
    render(<NotificationSection />);
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
    render(<NotificationSection />);
    expect(screen.getByRole('switch', { name: 'Set reminders' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('switch', { name: 'Crew picks' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('switch', { name: 'Schedule changes' })).toHaveAttribute('aria-checked', 'false');
  });

  it('calls updatePrefs to turn OFF an enabled toggle', async () => {
    const user = userEvent.setup();
    render(<NotificationSection />);
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
    render(<NotificationSection />);
    await user.click(screen.getByRole('switch', { name: 'Crew picks' }));
    expect(mockUpdatePrefs).toHaveBeenCalledWith({ crewUpdates: true });
  });

  it('shows quiet hours OFF when no DND window is set', () => {
    render(<NotificationSection />);
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
    render(<NotificationSection />);
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
    render(<NotificationSection />);
    expect(screen.getByText('Mute 11:00 PM–8:00 AM (Los Angeles time)')).toBeInTheDocument();
  });

  it('enabling quiet hours sends a DND start/end window to updatePrefs', async () => {
    const user = userEvent.setup();
    render(<NotificationSection />);
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
    render(<NotificationSection />);
    await user.click(screen.getByRole('switch', { name: 'Quiet hours' }));
    expect(mockUpdatePrefs).toHaveBeenCalledWith({ dndStart: null, dndEnd: null });
  });

  it('renders without crashing in the loading state', () => {
    resetStore({ isLoading: true, loaded: true });
    render(<NotificationSection />);
    // Already loaded: a background refresh keeps the toggles on screen.
    expect(screen.getByRole('switch', { name: 'Set reminders' })).toBeInTheDocument();
  });

  it('renders without crashing in an error state', () => {
    resetStore({ error: 'Failed to load notification settings' });
    render(<NotificationSection />);
    expect(screen.getByText('Notification types')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Crew picks' })).toBeInTheDocument();
  });

  it('does not throw if updatePrefs rejects (failure is swallowed)', async () => {
    const user = userEvent.setup();
    mockUpdatePrefs.mockRejectedValue(new Error('network'));
    render(<NotificationSection />);
    await user.click(screen.getByRole('switch', { name: 'Schedule changes' }));
    await waitFor(() => expect(mockUpdatePrefs).toHaveBeenCalledWith({ scheduleChanges: false }));
    // No unhandled rejection / thrown error reaching the test.
    expect(screen.getByText('Notification types')).toBeInTheDocument();
  });

  it('shows skeletons, not switches, until the first load finishes', () => {
    resetStore({ isLoading: true, loaded: false });
    const { rerender } = render(<NotificationSection />);
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.getAllByRole('status')).toHaveLength(1);
    resetStore({ isLoading: false, loaded: true });
    rerender(<NotificationSection />);
    expect(screen.getByRole('switch', { name: 'Set reminders' })).toBeInTheDocument();
  });

  it('renders the store error with role="alert"', () => {
    resetStore({ error: 'Failed to save notification settings', loaded: true });
    render(<NotificationSection />);
    expect(screen.getByRole('alert')).toHaveTextContent('Failed to save notification settings');
  });

  it('renders no per-festival rows when the user has not joined the festival', () => {
    render(<NotificationSection />);
    expect(screen.queryByText(/Only for/)).toBeNull();
  });

  it('disables the festival Crew picks switch when the global crewUpdates is off', () => {
    resetStore({ prefs: { ...basePrefs, crewUpdates: false } });
    topicsState = { festival: { id: 'f1', name: 'EDC' }, subs: { crew: true, schedule: true }, error: false };
    render(<NotificationSection />);
    const switches = screen.getAllByRole('switch', { name: 'Crew picks' });
    const festivalSwitch = switches[1];
    expect(festivalSwitch).toBeDisabled();
    expect(festivalSwitch).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText('Off for every festival')).toBeInTheDocument();
  });

  it('shows two skeleton rows while the festival topics load', () => {
    topicsState = { festival: { id: 'f1', name: 'EDC' }, subs: null, error: false };
    render(<NotificationSection />);
    expect(screen.getByText('Only for EDC')).toBeInTheDocument();
    expect(screen.getAllByRole('status')).toHaveLength(1);
  });

  it('applies the Festival nights preset to updatePrefs', async () => {
    const user = userEvent.setup();
    resetStore({ prefs: { ...basePrefs, dndStart: '23:00', dndEnd: '08:00' } });
    render(<NotificationSection />);
    await user.click(screen.getByRole('button', { name: /Festival nights/ }));
    expect(mockUpdatePrefs).toHaveBeenCalledWith({ dndStart: '04:00', dndEnd: '11:00' });
  });

  it('does not render the crew rows that have no sender yet', () => {
    render(<NotificationSection />);
    for (const name of ['Polls', 'Money', 'Rides']) {
      expect(screen.queryByRole('switch', { name })).toBeNull();
    }
    expect(screen.getByRole('switch', { name: 'Meeting points' })).toBeInTheDocument();
  });

  it('saves the must-see lead time through updatePrefs', async () => {
    const user = userEvent.setup();
    render(<NotificationSection />);
    await user.selectOptions(screen.getByLabelText(/Must-see reminders/), '15');
    expect(mockUpdatePrefs).toHaveBeenCalledWith({ mustSeeReminderMinutes: 15 });
  });

  it('says the lineup and reform toggles cover email as well as push', () => {
    render(<NotificationSection />);
    expect(screen.getAllByText(/By push and email\./)).toHaveLength(2);
    expect(screen.getByText('Wrap and rating nudges')).toBeInTheDocument();
  });
});
