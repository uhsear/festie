import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Socket } from 'socket.io-client';

// Real stores + the real shared publisher; only the browser edges (socket,
// geolocation) and unrelated UI are faked, so these tests exercise the actual
// start/stop wiring.

const { toastSpy } = vi.hoisted(() => ({ toastSpy: vi.fn() }));
vi.mock('../../lib/toastContext', () => ({ useToast: () => ({ toast: toastSpy }) }));
vi.mock('./SosRaiseButton', () => ({ default: () => <button type="button">Send SOS</button> }));
vi.mock('./CrewMap', () => ({ default: () => <div data-testid="crew-map" /> }));
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: [] }) }));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a>,
}));

import { LIVE_LOCATION } from '@festie/shared/constants';
import { resetAllStores } from '@festie/shared/stores/resetStores';
import { useAuthStore, useCrewStore, useFestivalStore } from '@festie/shared/stores';
import { useLiveLocationStore } from '@festie/shared/stores/liveLocationStore';
import { useFestivalModeStore } from '@festie/shared/stores/festivalModeStore';
import type { Crew, Festival, User } from '@festie/shared/types';
import { SocketContext } from '../../lib/socketContext';
import LiveLocationSharing from './LiveLocationSharing';
import LiveLocationControls from './LiveLocationControls';
import MapView from '../../routes/map';

const CREW = 'crew-1';
const ME = 'user-me';
const WATCH_ID = 7;

let socket: { connected: boolean; emit: ReturnType<typeof vi.fn>; on: ReturnType<typeof vi.fn>; off: ReturnType<typeof vi.fn> };
let geo: { watchPosition: ReturnType<typeof vi.fn>; clearWatch: ReturnType<typeof vi.fn>; getCurrentPosition: ReturnType<typeof vi.fn> };

function Shell({ page, withSocket = true }: { page?: 'crew' | 'map'; withSocket?: boolean }) {
  return (
    <SocketContext.Provider value={withSocket ? (socket as unknown as Socket) : null}>
      <LiveLocationSharing />
      {page === 'crew' && <LiveLocationControls crewId={CREW} currentUserId={ME} />}
      {page === 'map' && <MapView />}
    </SocketContext.Provider>
  );
}

function emitted(event: string) {
  return socket.emit.mock.calls.filter((c) => c[0] === event);
}

/** Opt in the way the crew tab does, then return once the GPS watch is live. */
function startSharing() {
  act(() => {
    useLiveLocationStore.getState().setActiveCrew(CREW);
    useLiveLocationStore.getState().requestSharing(CREW);
  });
  expect(geo.watchPosition).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('sharing-indicator')).toBeInTheDocument();
}

function expectStopped() {
  expect(geo.clearWatch).toHaveBeenCalledWith(WATCH_ID);
  expect(emitted('location:stop')).toHaveLength(1);
  expect(useLiveLocationStore.getState().sharingCrewId).toBeNull();
  expect(useLiveLocationStore.getState().shareIntentCrewId).toBeNull();
  expect(screen.queryByTestId('sharing-indicator')).not.toBeInTheDocument();
}

beforeEach(() => {
  vi.clearAllMocks();
  resetAllStores();
  useFestivalStore.setState({ currentFestivalId: 'f1', currentFestival: { id: 'f1', name: 'Fest' } as Festival });
  useAuthStore.setState({ user: { id: ME, username: 'me' } as User });
  useCrewStore.setState({ activeCrew: { id: CREW } as Crew });
  socket = { connected: true, emit: vi.fn(), on: vi.fn(), off: vi.fn() };
  geo = { watchPosition: vi.fn(() => WATCH_ID), clearWatch: vi.fn(), getCurrentPosition: vi.fn() };
  Object.defineProperty(global.navigator, 'geolocation', { configurable: true, value: geo });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('LiveLocationSharing — survives navigation', () => {
  it('keeps sharing when the crew page unmounts and /map mounts', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Shell page="crew" />);

    await user.click(screen.getByRole('switch', { name: 'Share my live location with this crew' }));
    expect(geo.watchPosition).toHaveBeenCalledTimes(1);
    expect(emitted('location:share')).toHaveLength(1);

    rerender(<Shell page="map" />);
    expect(await screen.findByTestId('crew-map')).toBeInTheDocument();

    expect(geo.clearWatch).not.toHaveBeenCalled();
    expect(emitted('location:stop')).toHaveLength(0);
    expect(geo.watchPosition).toHaveBeenCalledTimes(1);
    expect(useLiveLocationStore.getState().sharingCrewId).toBe(CREW);
    // /map shows the user's own sharing state, with scope, auto-stop and Stop.
    const indicator = screen.getByTestId('sharing-indicator');
    expect(indicator).toHaveAttribute('role', 'status');
    expect(within(indicator).getByText(/you'?re sharing your live location/i)).toBeInTheDocument();
    expect(within(indicator).getByText(/only this crew can see it/i)).toBeInTheDocument();
    expect(within(indicator).getByRole('button', { name: /stop sharing/i })).toBeInTheDocument();
  });

  it('shows nothing and watches nothing until the user opts in', () => {
    render(<Shell page="map" />);
    expect(geo.watchPosition).not.toHaveBeenCalled();
    expect(screen.queryByTestId('sharing-indicator')).not.toBeInTheDocument();
  });
});

describe('LiveLocationSharing — stop paths', () => {
  it('stops on the indicator Stop button', async () => {
    const user = userEvent.setup();
    render(<Shell />);
    startSharing();
    await user.click(screen.getByRole('button', { name: /stop sharing/i }));
    expectStopped();
  });

  it('stops when the crew-tab switch is turned off', async () => {
    const user = userEvent.setup();
    render(<Shell page="crew" />);
    startSharing();
    await user.click(screen.getByRole('switch', { name: 'Share my live location with this crew' }));
    expectStopped();
  });

  it('stops on sign-out (resetAllStores)', () => {
    render(<Shell />);
    startSharing();
    act(() => resetAllStores());
    expectStopped();
  });

  it('stops on a crew change', () => {
    render(<Shell />);
    startSharing();
    act(() => useLiveLocationStore.getState().setActiveCrew('crew-2'));
    expectStopped();
  });

  it('stops on a festival change', () => {
    render(<Shell />);
    startSharing();
    act(() => useFestivalStore.setState({ currentFestivalId: 'f2' }));
    expectStopped();
  });

  it('stops when low-power mode turns on', () => {
    render(<Shell />);
    startSharing();
    act(() => useFestivalModeStore.setState({ lowPowerMode: true }));
    expectStopped();
    act(() => useFestivalModeStore.setState({ lowPowerMode: false }));
  });

  it('stops the GPS watch when the socket goes away', () => {
    const { rerender } = render(<Shell />);
    startSharing();
    rerender(<Shell withSocket={false} />);
    expect(geo.clearWatch).toHaveBeenCalledWith(WATCH_ID);
    expect(useLiveLocationStore.getState().shareIntentCrewId).toBeNull();
    expect(screen.queryByTestId('sharing-indicator')).not.toBeInTheDocument();
  });

  it('stops and withdraws the opt-in when the app shell unmounts', () => {
    const { unmount } = render(<Shell />);
    startSharing();
    unmount();
    expect(geo.clearWatch).toHaveBeenCalledWith(WATCH_ID);
    expect(useLiveLocationStore.getState().shareIntentCrewId).toBeNull();
  });

  it('keeps the session auto-expiry and says so', () => {
    vi.useFakeTimers();
    render(<Shell />);
    startSharing();
    act(() => vi.advanceTimersByTime(LIVE_LOCATION.MAX_SESSION_MS));
    expectStopped();
    expect(toastSpy).toHaveBeenCalledWith(expect.stringMatching(/stopped automatically/i), 'info');
  });
});
