import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// --- Mocks ------------------------------------------------------------------

// Icons → inert spans so we assert on text/roles, not SVG internals.
vi.mock('lucide-react', () => {
  const Icon = () => <span data-testid="icon" />;
  return { Square: Icon, AlertCircle: Icon, Navigation: Icon, ShieldCheck: Icon, X: Icon, MapPin: Icon, Loader: Icon };
});

// clearCrewSos — the shared clear path (it also clears the store). Captured so
// we can assert the raiser id and flip success/failure per-test.
const { clearCrewSosSpy } = vi.hoisted(() => ({ clearCrewSosSpy: vi.fn() }));
vi.mock('@festie/shared', () => ({
  clearCrewSos: clearCrewSosSpy,
  sosErrorMessage: (_e: unknown, action: string) => `err:${action}`,
}));

// The raise button has its own test file; stub it here.
vi.mock('./SosRaiseButton', () => ({
  default: ({ crewId, alerting }: { crewId: string; alerting?: boolean }) => (
    <button data-testid="sos-raise" data-alerting={String(!!alerting)}>
      Send SOS {crewId}
    </button>
  ),
}));

// constants (SESSION_MINUTES is derived from MAX_SESSION_MS).
vi.mock('@festie/shared/constants', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@festie/shared/constants')>()),
  LIVE_LOCATION: { MAX_SESSION_MS: 3_600_000 },
}));

// utils — formatStaleness is the only one used by this component.
vi.mock('@festie/shared/utils', () => ({ formatStaleness: () => 'as of just now' }));

// The real (in-memory, non-persisted) liveLocationStore: the switch writes the
// opt-in there and the app-level LiveLocationSharing publishes from it.

// festivalModeStore — low-power mode gates the share affordance. Controllable
// so a test can flip lowPowerMode on and assert the toggle is disabled.
const { fmState } = vi.hoisted(() => ({ fmState: { lowPowerMode: false } }));
vi.mock('@festie/shared/stores/festivalModeStore', () => ({
  useFestivalModeStore: (selector: (s: typeof fmState) => unknown) => selector(fmState),
}));

// Shared socket — connected by default so the share toggle is allowed.
const { socketState } = vi.hoisted(() => ({ socketState: { connected: true } }));
vi.mock('../../lib/socketContext', () => ({ useSharedSocket: () => socketState }));

// Toast — capture calls so we can assert user-facing feedback.
const { toastSpy } = vi.hoisted(() => ({ toastSpy: vi.fn() }));
vi.mock('../../lib/toastContext', () => ({ useToast: () => ({ toast: toastSpy }) }));

import type { SosEntry } from '@festie/shared/types';
import { useLiveLocationStore } from '@festie/shared/stores/liveLocationStore';
import LiveLocationControls from './LiveLocationControls';

const CREW_ID = 'crew-1';
const ME = 'user-me';

function setSos(list: unknown[]) {
  useLiveLocationStore.setState({ activeSosList: list as SosEntry[] });
}

function resetStore() {
  useLiveLocationStore.getState().reset();
  fmState.lowPowerMode = false;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetStore();
  // jsdom has no geolocation by default; provide a stub so toggleSharing's
  // capability check passes. watchPosition/getCurrentPosition are never invoked
  // here because the publisher hook is mocked.
  // getCurrentPosition must INVOKE a callback or the SOS one-shot Promise never
  // settles. Default: fire the error cb → oneShotPosition resolves undefined
  // (the "couldn't get a fix, raise anyway" path), so the POST still goes out.
  Object.defineProperty(global.navigator, 'geolocation', {
    configurable: true,
    value: {
      watchPosition: vi.fn(),
      clearWatch: vi.fn(),
      getCurrentPosition: vi.fn((_ok: PositionCallback, err?: PositionErrorCallback) =>
        err?.({ code: 1 } as GeolocationPositionError),
      ),
    },
  });
});

describe('LiveLocationControls — share toggle', () => {
  it('renders an accessible, labelled, OFF-by-default switch', () => {
    render(<LiveLocationControls crewId={CREW_ID} currentUserId={ME} />);
    const sw = screen.getByRole('switch');
    expect(sw).toHaveAccessibleName('Share my live location with this crew');
    expect(sw).toHaveAttribute('aria-checked', 'false');
    // No sharing indicator until opted in.
    expect(screen.queryByTestId('sharing-indicator')).not.toBeInTheDocument();
  });

  it('records the opt-in for this crew and flips aria-checked once sharing starts', async () => {
    const user = userEvent.setup();
    render(<LiveLocationControls crewId={CREW_ID} currentUserId={ME} />);

    await user.click(screen.getByRole('switch'));
    expect(useLiveLocationStore.getState().shareIntentCrewId).toBe(CREW_ID);

    // The app-level publisher marks the share live once it starts.
    act(() => useLiveLocationStore.getState().startSharing(CREW_ID));
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
    // The indicator is app-wide (LiveLocationSharing), not on this tab.
    expect(screen.queryByTestId('sharing-indicator')).not.toBeInTheDocument();
  });

  it('withdraws the opt-in when the switch is turned off', async () => {
    const user = userEvent.setup();
    render(<LiveLocationControls crewId={CREW_ID} currentUserId={ME} />);
    await user.click(screen.getByRole('switch'));
    act(() => useLiveLocationStore.getState().startSharing(CREW_ID));

    await user.click(screen.getByRole('switch'));

    expect(useLiveLocationStore.getState().shareIntentCrewId).toBeNull();
  });

  it('refuses to start sharing (and warns) when the socket is disconnected', async () => {
    const user = userEvent.setup();
    socketState.connected = false;
    render(<LiveLocationControls crewId={CREW_ID} currentUserId={ME} />);

    await user.click(screen.getByRole('switch'));

    expect(toastSpy).toHaveBeenCalledWith(expect.stringMatching(/not connected/i), 'error');
    expect(useLiveLocationStore.getState().shareIntentCrewId).toBeNull();
    socketState.connected = true; // restore for other tests
  });

  it('disables the share affordance in low-power mode (battery gate) and warns on tap', async () => {
    const user = userEvent.setup();
    fmState.lowPowerMode = true;
    render(<LiveLocationControls crewId={CREW_ID} currentUserId={ME} />);

    const sw = screen.getByTestId('live-share-toggle');
    expect(sw).toBeDisabled();
    // SOS — an essential — stays available even in low-power mode.
    expect(screen.getByTestId('sos-raise')).toBeInTheDocument();
    // A disabled switch swallows the click, so sharing never goes live.
    await user.click(sw);
    expect(useLiveLocationStore.getState().shareIntentCrewId).toBeNull();
  });
});

describe('LiveLocationControls — Send SOS', () => {
  it('puts the Send SOS button first, with the emergency line under it', () => {
    const { container } = render(<LiveLocationControls crewId={CREW_ID} currentUserId={ME} />);
    expect(container.firstElementChild!.firstElementChild).toBe(screen.getByTestId('sos-raise'));
    expect(screen.getByTestId('sos-raise')).toHaveTextContent(CREW_ID);
    expect(screen.getByText(/for emergencies — alerts your whole crew/i)).toBeInTheDocument();
  });

  it('pulses while a crew SOS is active', () => {
    setSos([
      { crewId: CREW_ID, userId: 'user-other', username: 'Dana', raisedAt: new Date().toISOString() },
    ]);
    render(<LiveLocationControls crewId={CREW_ID} currentUserId={ME} />);
    expect(screen.getByTestId('sos-raise')).toHaveAttribute('data-alerting', 'true');
  });

  it('hides the button while your own SOS is active', () => {
    setSos([{ crewId: CREW_ID, userId: ME, username: 'Me', raisedAt: new Date().toISOString() }]);
    render(<LiveLocationControls crewId={CREW_ID} currentUserId={ME} />);
    expect(screen.queryByTestId('sos-raise')).not.toBeInTheDocument();
  });
});

describe('LiveLocationControls — active SOS banner', () => {
  const baseSos = {
    crewId: CREW_ID,
    userId: 'user-other',
    username: 'Dana',
    message: 'Need help at the gate',
    raisedAt: new Date().toISOString(),
  };

  it('renders a prominent alert banner for a crew SOS raised by someone else', () => {
    setSos([{ ...baseSos }]);
    render(<LiveLocationControls crewId={CREW_ID} currentUserId={ME} />);

    const banner = screen.getByTestId('sos-banner');
    expect(banner).toHaveAttribute('role', 'alert');
    expect(within(banner).getByText(/Dana raised an SOS/i)).toBeInTheDocument();
    expect(within(banner).getByText('Need help at the gate')).toBeInTheDocument();
    // Any member may resolve any SOS (raiser's phone may be dead) — the clear
    // control is present for someone else's SOS, worded for that raiser.
    expect(within(banner).getByRole('button', { name: /mark dana's sos resolved/i })).toBeInTheDocument();
  });

  it('lets ANY member resolve another member\'s SOS via a confirm dialog', async () => {
    const user = userEvent.setup();
    clearCrewSosSpy.mockResolvedValueOnce(undefined);
    setSos([{ ...baseSos }]);
    render(<LiveLocationControls crewId={CREW_ID} currentUserId={ME} />);

    await user.click(screen.getByRole('button', { name: /mark dana's sos resolved/i }));
    // Confirm-gated — nothing posts until the user confirms in the dialog.
    expect(clearCrewSosSpy).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /mark resolved/i }));

    // Clears by raiserId so it targets that member's SOS (parity with mobile).
    expect(clearCrewSosSpy).toHaveBeenCalledWith(CREW_ID, 'user-other');
    expect(toastSpy).toHaveBeenCalledWith(expect.stringMatching(/sos cleared/i), 'success');
  });

  it('shows the "I\'m safe — clear SOS" action to the raiser and clears on confirm', async () => {
    const user = userEvent.setup();
    clearCrewSosSpy.mockResolvedValueOnce(undefined);
    setSos([{ ...baseSos, userId: ME, username: 'Me' }]);
    render(<LiveLocationControls crewId={CREW_ID} currentUserId={ME} />);

    const banner = screen.getByTestId('sos-banner');
    expect(within(banner).getByText(/you raised an sos/i)).toBeInTheDocument();
    await user.click(within(banner).getByRole('button', { name: /clear sos/i }));

    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /i'?m safe/i }));

    expect(clearCrewSosSpy).toHaveBeenCalledWith(CREW_ID, ME);
    expect(toastSpy).toHaveBeenCalledWith(expect.stringMatching(/sos cleared/i), 'success');
  });

  it('shows the shared error line when the clear fails', async () => {
    const user = userEvent.setup();
    clearCrewSosSpy.mockRejectedValueOnce(new Error('boom'));
    setSos([{ ...baseSos }]);
    render(<LiveLocationControls crewId={CREW_ID} currentUserId={ME} />);

    await user.click(screen.getByRole('button', { name: /mark dana's sos resolved/i }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /mark resolved/i }));

    expect(toastSpy).toHaveBeenCalledWith('err:clear', 'error');
  });

  it('renders one banner per active SOS with an "N active" header when 2+ are live', () => {
    setSos([
      { ...baseSos },
      { ...baseSos, userId: 'user-3', username: 'Sam', message: 'Twisted ankle' },
    ]);
    render(<LiveLocationControls crewId={CREW_ID} currentUserId={ME} />);

    expect(screen.getAllByTestId('sos-banner')).toHaveLength(2);
    expect(screen.getByText(/2 active sos/i)).toBeInTheDocument();
  });

  it('offers a directions link when the SOS carries a position', () => {
    setSos([
      { ...baseSos, position: { lat: 41.88, lng: -87.62, capturedAt: new Date().toISOString() } },
    ]);
    render(<LiveLocationControls crewId={CREW_ID} currentUserId={ME} />);

    expect(
      within(screen.getByTestId('sos-banner')).getByRole('button', { name: /get directions/i }),
    ).toBeInTheDocument();
  });

  it('ignores an SOS targeting a different crew', () => {
    setSos([{ ...baseSos, crewId: 'other-crew' }]);
    render(<LiveLocationControls crewId={CREW_ID} currentUserId={ME} />);
    expect(screen.queryByTestId('sos-banner')).not.toBeInTheDocument();
  });
});
