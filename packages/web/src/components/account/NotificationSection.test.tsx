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

import NotificationSection from './NotificationSection';

beforeEach(() => {
  vi.clearAllMocks();
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
  it('renders nothing while checking or when push is not configured', () => {
    push.checking = true;
    const { container, rerender } = render(<NotificationSection />);
    expect(container).toBeEmptyDOMElement();
    push.checking = false;
    push.unsupportedReason = 'not-configured';
    rerender(<NotificationSection />);
    expect(container).toBeEmptyDOMElement();
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
