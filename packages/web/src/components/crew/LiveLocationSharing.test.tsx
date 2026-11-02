import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('lucide-react', () => {
  const Icon = () => <span data-testid="icon" />;
  return { Square: Icon, Pause: Icon, Play: Icon };
});

// The session hook has its own tests in shared; here the host only renders and wires it.
const { sessionSpy } = vi.hoisted(() => ({ sessionSpy: vi.fn() }));
vi.mock('@festie/shared/hooks', () => ({ useLiveShareSession: sessionSpy }));

vi.mock('../../lib/socketContext', () => ({ useSharedSocket: () => ({ connected: true }) }));

const { toastSpy } = vi.hoisted(() => ({ toastSpy: vi.fn() }));
vi.mock('../../lib/toastContext', () => ({ useToast: () => ({ toast: toastSpy }) }));

import { useLiveLocationStore } from '@festie/shared/stores/liveLocationStore';
import LiveLocationSharing from './LiveLocationSharing';

const CREW_ID = 'crew-1';

function begin(minutes = 42) {
  act(() => useLiveLocationStore.getState().beginShare(CREW_ID, new Date(Date.now() + minutes * 60_000).toISOString(), false));
}

beforeEach(() => {
  vi.clearAllMocks();
  useLiveLocationStore.getState().reset();
});

describe('LiveLocationSharing', () => {
  it('renders nothing without a session and runs the shared session hook', () => {
    const { container } = render(<LiveLocationSharing />);
    expect(container).toBeEmptyDOMElement();
    expect(sessionSpy).toHaveBeenCalledWith(expect.objectContaining({ watchPosition: expect.any(Function) }));
  });

  it('shows the sharing bar with the countdown', () => {
    render(<LiveLocationSharing />);
    begin(42);
    const bar = screen.getByTestId('sharing-indicator');
    expect(bar).toHaveAttribute('role', 'status');
    expect(bar).toHaveTextContent("You're sharing your live location");
    expect(bar).toHaveTextContent(/Ends in 4[12] min · /);
  });

  it('Pause hides the dot and shows the paused copy, Resume brings it back', async () => {
    const user = userEvent.setup();
    render(<LiveLocationSharing />);
    begin();

    await user.click(screen.getByRole('button', { name: /pause sharing/i }));
    expect(useLiveLocationStore.getState().shareIntent?.paused).toBe(true);
    expect(screen.getByTestId('sharing-indicator')).toHaveTextContent('Sharing paused');

    await user.click(screen.getByRole('button', { name: /resume sharing/i }));
    expect(useLiveLocationStore.getState().shareIntent?.paused).toBe(false);
  });

  it('Stop ends the session without a notice', async () => {
    const user = userEvent.setup();
    render(<LiveLocationSharing />);
    begin();

    await user.click(screen.getByRole('button', { name: /stop sharing my live location/i }));

    expect(useLiveLocationStore.getState().shareIntent).toBeNull();
    expect(toastSpy).not.toHaveBeenCalled();
    expect(screen.queryByTestId('sharing-indicator')).not.toBeInTheDocument();
  });

  it('toasts the expired notice and clears the reason', () => {
    render(<LiveLocationSharing />);
    begin();
    act(() => useLiveLocationStore.getState().endShare('expired'));

    expect(toastSpy).toHaveBeenCalledWith('Live location stopped at the time you picked.', 'info');
    expect(useLiveLocationStore.getState().shareEndedReason).toBeNull();
  });

  it('toasts failures as errors', () => {
    render(<LiveLocationSharing />);
    begin();
    act(() => useLiveLocationStore.getState().endShare('denied'));
    expect(toastSpy).toHaveBeenCalledWith(expect.stringMatching(/permission is off/i), 'error');
  });
});
