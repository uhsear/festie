import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const push = {
  permissionState: 'granted' as string,
  unsupportedReason: null as string | null,
  requestPermission: vi.fn(async () => 'granted'),
  registerToken: vi.fn(async () => {}),
};
const navigate = vi.fn();
vi.mock('../../hooks/usePushNotifications', () => ({ usePushNotifications: () => push }));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }));

import { useNotificationPrefsStore } from '@festie/shared/stores';
import DetailReminderPicker from './DetailReminderPicker';

describe('DetailReminderPicker', () => {
  const onReminderClick = vi.fn(async () => {});

  beforeEach(() => {
    vi.clearAllMocks();
    push.permissionState = 'granted';
    push.unsupportedReason = null;
    useNotificationPrefsStore.setState({
      prefs: { ...useNotificationPrefsStore.getState().prefs, setReminders: true },
      loadPrefs: vi.fn(async () => {}),
    } as never);
  });

  const renderWith = (reminder: number | undefined) =>
    render(<DetailReminderPicker myReminder={reminder} reminderBusy={null} onReminderClick={onReminderClick} />);

  it('renders no delivery line when no reminder is set', () => {
    push.permissionState = 'denied';
    renderWith(undefined);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('renders no delivery line when delivery works', () => {
    renderWith(15);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it.each([
    ['default', null, "Notifications are off, so this reminder can't reach you."],
    ['denied', null, 'Notifications are blocked for festie.us. Allow them in your browser settings to get this reminder.'],
    ['unsupported', 'ios-needs-install', 'To get reminders on iPhone, add Festie to your Home Screen first.'],
    ['unsupported', 'browser', "This browser can't show reminders. Use the Festie app or another browser."],
  ])('shows the copy for permission %s / %s', (state, reason, copy) => {
    push.permissionState = state;
    push.unsupportedReason = reason;
    renderWith(15);
    expect(screen.getByRole('status')).toHaveTextContent(copy);
  });

  it('shows the Account line when the preference is off and navigates', async () => {
    useNotificationPrefsStore.setState({
      prefs: { ...useNotificationPrefsStore.getState().prefs, setReminders: false },
    } as never);
    renderWith(15);
    expect(screen.getByRole('status')).toHaveTextContent('Set reminders are turned off in Account.');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Turn on in Account' }));
    expect(navigate).toHaveBeenCalledWith({ to: '/account' });
  });

  it('Turn on requests permission, then registers the token', async () => {
    push.permissionState = 'default';
    renderWith(15);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Turn on' }));
    expect(push.requestPermission).toHaveBeenCalledOnce();
    expect(push.registerToken).toHaveBeenCalledOnce();
  });

  it('renders all reminder option labels', () => {
    render(<DetailReminderPicker myReminder={undefined} reminderBusy={null} onReminderClick={onReminderClick} />);
    expect(screen.getByText('5m')).toBeInTheDocument();
    expect(screen.getByText('10m')).toBeInTheDocument();
    expect(screen.getByText('15m')).toBeInTheDocument();
    expect(screen.getByText('30m')).toBeInTheDocument();
    expect(screen.getByText('1h')).toBeInTheDocument();
  });

  it('calls onReminderClick with the correct minute value when an option is clicked', async () => {
    const user = userEvent.setup();
    render(<DetailReminderPicker myReminder={undefined} reminderBusy={null} onReminderClick={onReminderClick} />);
    await user.click(screen.getByRole('button', { name: 'Remind me 15m before' }));
    expect(onReminderClick).toHaveBeenCalledWith(15);
  });

  it('clears the reminder (calls with null) when the active option is clicked', async () => {
    const user = userEvent.setup();
    render(<DetailReminderPicker myReminder={30} reminderBusy={null} onReminderClick={onReminderClick} />);
    // The active option exposes a "click to clear" aria-label.
    await user.click(screen.getByRole('button', { name: 'Reminder 30m before, click to clear' }));
    expect(onReminderClick).toHaveBeenCalledWith(null);
  });

  it('disables all buttons while a reminder action is busy', () => {
    render(<DetailReminderPicker myReminder={undefined} reminderBusy={10} onReminderClick={onReminderClick} />);
    for (const btn of screen.getAllByRole('button')) {
      expect(btn).toBeDisabled();
    }
  });

  it('does not invoke onReminderClick when a busy button is clicked', async () => {
    const user = userEvent.setup();
    render(<DetailReminderPicker myReminder={undefined} reminderBusy={10} onReminderClick={onReminderClick} />);
    await user.click(screen.getByText('5m'));
    expect(onReminderClick).not.toHaveBeenCalled();
  });

  it('applies active styling and aria-pressed to the matching option', () => {
    render(<DetailReminderPicker myReminder={60} reminderBusy={null} onReminderClick={onReminderClick} />);
    const active = screen.getByRole('button', { name: 'Reminder 1h before, click to clear' });
    expect(active).toHaveAttribute('aria-pressed', 'true');
    expect(active.className).toContain('border-accent-aqua');

    const inactive = screen.getByRole('button', { name: 'Remind me 5m before' });
    expect(inactive).toHaveAttribute('aria-pressed', 'false');
    expect(inactive.className).not.toContain('border-accent-aqua');
  });
});
