import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SHARE_EXPLAINER_SEEN_KEY } from '@festie/shared/hooks';
import { act, render, screen, waitFor, within } from '@testing-library/react';
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

// The check-in card and Beacon have their own test files; stub them here.
vi.mock('./CheckInCard', () => ({ default: () => <div data-testid="checkin-card" /> }));
vi.mock('./BeaconOverlay', () => ({ BeaconButton: () => <div data-testid="beacon-button" /> }));

// The real (in-memory, non-persisted) liveLocationStore: the chooser writes the
// share session there and the app-level LiveLocationSharing runs it.

// festivalModeStore — low-power mode gates the share affordance. Controllable
// so a test can flip lowPowerMode on and assert the toggle is disabled.
const { fmState } = vi.hoisted(() => ({ fmState: { lowPowerMode: false, setLowPowerMode: vi.fn() } }));
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
import { LIVE_SHARE_COPY, LOW_POWER_COPY } from '@festie/shared/constants';
import LiveLocationControls from './LiveLocationControls';

const CREW_ID = 'crew-1';
const ME = 'user-me';

function setSos(list: unknown[]) {
  useLiveLocationStore.setState({ activeSosList: list as SosEntry[] });
}

function resetStore() {
  useLiveLocationStore.getState().reset();
  fmState.lowPowerMode = false;
  fmState.setLowPowerMode.mockClear();
}

beforeEach(() => {
  vi.clearAllMocks();
  resetStore();
  // The one-time explainer is covered by its own test; skip it here.
  localStorage.setItem(SHARE_EXPLAINER_SEEN_KEY, '1');
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
    const sw = screen.getByRole('switch', { name: LIVE_SHARE_COPY.switchA11y });
    expect(sw).toHaveAccessibleName('Share my live location with this crew');
    expect(sw).toHaveAccessibleDescription(LIVE_SHARE_COPY.ruleWeb);
    expect(sw).toHaveAttribute('aria-checked', 'false');
    expect(screen.queryByTestId('sharing-indicator')).not.toBeInTheDocument();
    expect(screen.queryByTestId('live-share-chooser')).not.toBeInTheDocument();
  });

  it('shows the web stop rule, not the old Festival Mode or Ephemeral copy', () => {
    render(<LiveLocationControls crewId={CREW_ID} currentUserId={ME} />);
    expect(screen.getByText(LIVE_SHARE_COPY.ruleWeb)).toBeInTheDocument();
  });

  it('the first share shows the explainer, then the durations after Got it', async () => {
    localStorage.removeItem(SHARE_EXPLAINER_SEEN_KEY);
    const user = userEvent.setup();
    render(<LiveLocationControls crewId={CREW_ID} currentUserId={ME} />);
    await user.click(screen.getByRole('switch'));

    const chooser = screen.getByTestId('live-share-chooser');
    expect(await within(chooser).findByText(LIVE_SHARE_COPY.explainerTitle)).toBeInTheDocument();
    for (const point of LIVE_SHARE_COPY.explainerPoints) expect(within(chooser).getByText(point)).toBeInTheDocument();
    expect(within(chooser).queryByRole('button', { name: '1 hour' })).not.toBeInTheDocument();

    await user.click(within(chooser).getByRole('button', { name: LIVE_SHARE_COPY.explainerOk }));
    expect(within(chooser).getByRole('button', { name: '1 hour' })).toBeInTheDocument();
    expect(localStorage.getItem(SHARE_EXPLAINER_SEEN_KEY)).toBe('1');
  });

  it('switch on opens the chooser with the duration buttons and a cancel', async () => {
    const user = userEvent.setup();
    render(<LiveLocationControls crewId={CREW_ID} currentUserId={ME} />);
    await user.click(screen.getByRole('switch'));

    const chooser = screen.getByTestId('live-share-chooser');
    expect(within(chooser).getByText(LIVE_SHARE_COPY.chooserTitle)).toBeInTheDocument();
    for (const label of ['1 hour', '2 hours', '4 hours']) {
      expect(within(chooser).getByRole('button', { name: label })).toBeInTheDocument();
    }
    expect(within(chooser).getByRole('checkbox', { name: /show my battery level/i })).not.toBeChecked();
    await user.click(within(chooser).getByRole('button', { name: LIVE_SHARE_COPY.cancel }));
    expect(screen.queryByTestId('live-share-chooser')).not.toBeInTheDocument();
    expect(useLiveLocationStore.getState().shareIntent).toBeNull();
  });

  it('picking 1 hour begins a session one hour out without battery', async () => {
    const user = userEvent.setup();
    render(<LiveLocationControls crewId={CREW_ID} currentUserId={ME} />);
    await user.click(screen.getByRole('switch'));
    const before = Date.now();
    await user.click(screen.getByRole('button', { name: '1 hour' }));

    const intent = useLiveLocationStore.getState().shareIntent;
    expect(intent).toMatchObject({ crewId: CREW_ID, paused: false, shareBattery: false });
    const ms = Date.parse(intent!.expiresAt) - before;
    expect(ms).toBeGreaterThanOrEqual(3_600_000 - 1000);
    expect(ms).toBeLessThanOrEqual(3_600_000 + 5000);
    expect(screen.queryByTestId('live-share-chooser')).not.toBeInTheDocument();
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  });

  it('passes shareBattery true when the battery box is checked', async () => {
    const user = userEvent.setup();
    render(<LiveLocationControls crewId={CREW_ID} currentUserId={ME} />);
    await user.click(screen.getByRole('switch'));
    await user.click(screen.getByRole('checkbox', { name: /show my battery level/i }));
    await user.click(screen.getByRole('button', { name: '2 hours' }));
    expect(useLiveLocationStore.getState().shareIntent?.shareBattery).toBe(true);
  });

  it('switch off ends the session', async () => {
    const user = userEvent.setup();
    render(<LiveLocationControls crewId={CREW_ID} currentUserId={ME} />);
    act(() => useLiveLocationStore.getState().beginShare(CREW_ID, new Date(Date.now() + 3_600_000).toISOString(), false));

    await user.click(screen.getByRole('switch'));

    expect(useLiveLocationStore.getState().shareIntent).toBeNull();
    expect(useLiveLocationStore.getState().shareEndedReason).toBe('user');
  });

  it('refuses to start sharing (and warns) when the socket is disconnected', async () => {
    const user = userEvent.setup();
    socketState.connected = false;
    render(<LiveLocationControls crewId={CREW_ID} currentUserId={ME} />);

    await user.click(screen.getByRole('switch'));
    await user.click(screen.getByRole('button', { name: '1 hour' }));

    expect(toastSpy).toHaveBeenCalledWith(expect.stringMatching(/not connected/i), 'error');
    expect(useLiveLocationStore.getState().shareIntent).toBeNull();
    socketState.connected = true; // restore for other tests
  });

  it('in low-power mode disables the switch, explains why and offers a turn-off button', async () => {
    const user = userEvent.setup();
    fmState.lowPowerMode = true;
    render(<LiveLocationControls crewId={CREW_ID} currentUserId={ME} />);

    const sw = screen.getByTestId('live-share-toggle');
    expect(sw).toBeDisabled();
    expect(screen.getByText(LOW_POWER_COPY.livePaused)).toBeInTheDocument();
    // SOS — an essential — stays available even in low-power mode.
    expect(screen.getByTestId('sos-raise')).toBeInTheDocument();
    expect(screen.getByTestId('beacon-button')).toBeInTheDocument();
    await user.click(sw);
    expect(useLiveLocationStore.getState().shareIntent).toBeNull();

    await user.click(screen.getByRole('button', { name: LOW_POWER_COPY.turnOff }));
    expect(fmState.setLowPowerMode).toHaveBeenCalledWith(false);
  });

  it('mounts the check-in card and the Beacon button', () => {
    render(<LiveLocationControls crewId={CREW_ID} currentUserId={ME} />);
    expect(screen.getByTestId('checkin-card')).toBeInTheDocument();
    expect(screen.getByTestId('beacon-button')).toBeInTheDocument();
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

  it('shows who has seen the SOS', () => {
    setSos([{ ...baseSos }]);
    const { unmount } = render(<LiveLocationControls crewId={CREW_ID} currentUserId={ME} />);
    expect(within(screen.getByTestId('sos-banner')).getByText('Not seen yet')).toBeInTheDocument();
    unmount();

    setSos([{ ...baseSos, seenBy: [{ userId: 'a', username: 'Sam' }, { userId: 'b', username: 'Alex' }] }]);
    render(<LiveLocationControls crewId={CREW_ID} currentUserId={ME} />);
    expect(within(screen.getByTestId('sos-banner')).getByText('Seen by Sam and Alex')).toBeInTheDocument();
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

  it('returns focus to the resolve button on Escape', async () => {
    const user = userEvent.setup();
    setSos([{ ...baseSos }]);
    render(<LiveLocationControls crewId={CREW_ID} currentUserId={ME} />);
    const opener = screen.getByRole('button', { name: /mark dana's sos resolved/i });
    await user.click(opener);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(opener).toHaveFocus());
    expect(clearCrewSosSpy).not.toHaveBeenCalled();
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
