import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('lucide-react', () => {
  const Icon = () => <span data-testid="icon" />;
  return { AlertCircle: Icon, X: Icon, Loader: Icon };
});

const { raiseSosSpy } = vi.hoisted(() => ({ raiseSosSpy: vi.fn() }));
vi.mock('@festie/shared', () => ({
  raiseSos: raiseSosSpy,
  // Same copy as services/sos.ts for the two cases under test.
  sosErrorMessage: (err: { status?: number }) =>
    err.status === 429
      ? 'Your SOS is already active. Your crew can see it.'
      : 'No signal — your SOS was NOT sent. Use your phone or radio to reach your crew directly.',
  isApiClientError: (err: unknown) => typeof err === 'object' && err !== null && 'status' in err,
}));

const { toastSpy } = vi.hoisted(() => ({ toastSpy: vi.fn() }));
vi.mock('../../lib/toastContext', () => ({ useToast: () => ({ toast: toastSpy }) }));

import { SOS_CONTROL } from '@festie/shared/constants';
import SosRaiseButton from './SosRaiseButton';

beforeEach(() => {
  vi.clearAllMocks();
  window.matchMedia = ((q: string) => ({
    matches: false,
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
  // No fix: the error callback fires so the raise goes out without a position.
  Object.defineProperty(global.navigator, 'geolocation', {
    configurable: true,
    value: {
      getCurrentPosition: vi.fn((_ok: PositionCallback, err?: PositionErrorCallback) =>
        err?.({ code: 1 } as GeolocationPositionError),
      ),
    },
  });
});

// Pointer clicks only explain the hold, so tests open the dialog the way a keyboard user does.
async function openWithKeyboard(user: ReturnType<typeof userEvent.setup>) {
  screen.getByRole('button', { name: 'Send SOS' }).focus();
  await user.keyboard('{Enter}');
}

describe('SosRaiseButton', () => {
  it('opens the confirm dialog from the keyboard with Enter and with Space', async () => {
    const user = userEvent.setup();
    render(<SosRaiseButton crewId="c1" />);
    const control = screen.getByRole('button', { name: 'Send SOS' });
    expect(control).toHaveAccessibleDescription(SOS_CONTROL.hint);

    await user.tab();
    expect(control).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(raiseSosSpy).not.toHaveBeenCalled();

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await user.keyboard(' ');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('opens the dialog only after a one second pointer hold', () => {
    vi.useFakeTimers();
    try {
      render(<SosRaiseButton crewId="c1" />);
      const control = screen.getByRole('button', { name: 'Send SOS' });

      fireEvent.pointerDown(control, { button: 0, pointerType: 'touch' });
      act(() => void vi.advanceTimersByTime(SOS_CONTROL.holdMs - 100));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      fireEvent.pointerUp(control);
      act(() => void vi.advanceTimersByTime(500));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

      fireEvent.pointerDown(control, { button: 0, pointerType: 'touch' });
      act(() => void vi.advanceTimersByTime(SOS_CONTROL.holdMs));
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('explains the hold after a short tap and does not open the dialog', () => {
    render(<SosRaiseButton crewId="c1" />);
    const control = screen.getByRole('button', { name: 'Send SOS' });
    fireEvent.pointerDown(control, { button: 0, pointerType: 'touch' });
    fireEvent.pointerUp(control);
    fireEvent.click(control, { detail: 1 });
    expect(screen.getByRole('status')).toHaveTextContent('Hold to send SOS');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('does not promise a compass: the web has none', async () => {
    const user = userEvent.setup();
    render(<SosRaiseButton crewId="c1" />);
    await openWithKeyboard(user);
    expect(screen.getByRole('dialog').textContent).not.toMatch(/compass/i);
  });

  it('confirms before sending, then raises with the message and toasts success', async () => {
    const user = userEvent.setup();
    raiseSosSpy.mockResolvedValueOnce({});
    render(<SosRaiseButton crewId="c1" />);

    await openWithKeyboard(user);
    expect(screen.getByText('Send an SOS to your crew?')).toBeInTheDocument();
    expect(raiseSosSpy).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText(/optional sos message/i), 'Lost near Main Stage');
    await user.click(screen.getByRole('button', { name: 'Send SOS' }));

    expect(raiseSosSpy).toHaveBeenCalledWith('c1', { message: 'Lost near Main Stage' });
    expect(toastSpy).toHaveBeenCalledWith(expect.stringContaining('without your location'), 'warning');
  });

  it('toasts plain success when a position was attached', async () => {
    Object.defineProperty(global.navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: vi.fn((ok: PositionCallback) =>
          ok({ coords: { latitude: 28.5, longitude: -81.4, accuracy: 10 }, timestamp: 0 } as GeolocationPosition),
        ),
      },
    });
    raiseSosSpy.mockResolvedValueOnce({});
    const user = userEvent.setup();
    render(<SosRaiseButton crewId="c1" />);
    await openWithKeyboard(user);
    await user.click(screen.getByRole('button', { name: 'Send SOS' }));
    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith('SOS sent to your crew', 'success'));
  });

  it('sends without a position when the permission prompt is never answered', async () => {
    Object.defineProperty(global.navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition: vi.fn() },
    });
    raiseSosSpy.mockResolvedValueOnce({});
    const user = userEvent.setup();
    render(<SosRaiseButton crewId="c1" />);
    await openWithKeyboard(user);
    await user.click(screen.getByRole('button', { name: 'Send SOS' }));
    expect(raiseSosSpy).not.toHaveBeenCalled();
    await waitFor(() => expect(raiseSosSpy).toHaveBeenCalledWith('c1', {}), { timeout: 6_000 });
  }, 10_000);

  it('on 429 shows the already-active line and closes the dialog', async () => {
    const user = userEvent.setup();
    raiseSosSpy.mockRejectedValueOnce({ status: 429 });
    render(<SosRaiseButton crewId="c1" />);

    await openWithKeyboard(user);
    await user.click(screen.getByRole('button', { name: 'Send SOS' }));

    expect(toastSpy).toHaveBeenCalledWith('Your SOS is already active. Your crew can see it.', 'error');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('on a network error shows the no-signal line and keeps the dialog open', async () => {
    const user = userEvent.setup();
    raiseSosSpy.mockRejectedValueOnce({ status: 0 });
    render(<SosRaiseButton crewId="c1" />);

    await openWithKeyboard(user);
    await user.click(screen.getByRole('button', { name: 'Send SOS' }));

    expect(toastSpy).toHaveBeenCalledWith(expect.stringMatching(/^No signal/), 'error');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('returns focus to the opener on Escape', async () => {
    const user = userEvent.setup();
    render(<SosRaiseButton crewId="c1" />);
    const opener = screen.getByRole('button', { name: 'Send SOS' });
    opener.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(opener).toHaveFocus());
  });
});
