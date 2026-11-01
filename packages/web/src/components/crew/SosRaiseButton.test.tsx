import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
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

describe('SosRaiseButton', () => {
  it('confirms before sending, then raises with the message and toasts success', async () => {
    const user = userEvent.setup();
    raiseSosSpy.mockResolvedValueOnce({});
    render(<SosRaiseButton crewId="c1" />);

    await user.click(screen.getByRole('button', { name: 'Send an SOS to your crew' }));
    expect(screen.getByText('Send an SOS to your crew?')).toBeInTheDocument();
    expect(raiseSosSpy).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText(/optional sos message/i), 'Lost near Main Stage');
    await user.click(screen.getByRole('button', { name: 'Send SOS' }));

    expect(raiseSosSpy).toHaveBeenCalledWith('c1', { message: 'Lost near Main Stage' });
    expect(toastSpy).toHaveBeenCalledWith('SOS sent to your crew', 'success');
  });

  it('on 429 shows the already-active line and closes the dialog', async () => {
    const user = userEvent.setup();
    raiseSosSpy.mockRejectedValueOnce({ status: 429 });
    render(<SosRaiseButton crewId="c1" />);

    await user.click(screen.getByRole('button', { name: 'Send an SOS to your crew' }));
    await user.click(screen.getByRole('button', { name: 'Send SOS' }));

    expect(toastSpy).toHaveBeenCalledWith('Your SOS is already active. Your crew can see it.', 'error');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('on a network error shows the no-signal line and keeps the dialog open', async () => {
    const user = userEvent.setup();
    raiseSosSpy.mockRejectedValueOnce({ status: 0 });
    render(<SosRaiseButton crewId="c1" compact />);

    expect(screen.getByRole('button', { name: 'Send an SOS to your crew' })).toHaveTextContent('SOS');
    await user.click(screen.getByRole('button', { name: 'Send an SOS to your crew' }));
    await user.click(screen.getByRole('button', { name: 'Send SOS' }));

    expect(toastSpy).toHaveBeenCalledWith(expect.stringMatching(/^No signal/), 'error');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
