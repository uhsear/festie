import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Handler = (...args: never[]) => void;

const h = vi.hoisted(() => {
  const auth = { userToken: 'tok' as string | null, refreshToken: vi.fn() };
  const festival = {
    currentFestivalId: 'f1' as string | null,
    applyProfilePatch: vi.fn(),
    loadProfiles: vi.fn(),
    selectFestival: vi.fn(),
  };
  const crew = {
    activeCrew: { id: 'c1' } as { id: string } | null,
    loadCrews: vi.fn(),
    selectCrew: vi.fn(),
    applyStatusUpdate: vi.fn(),
  };
  const ui = { connected: false, setConnected: vi.fn(), setOnlineUsers: vi.fn() };
  const live = { sharingCrewId: null as string | null, setActiveCrew: vi.fn(), stopSharing: vi.fn() };
  return {
    auth,
    festival,
    crew,
    ui,
    live,
    effects: [] as (() => void | (() => void))[],
    appStateHandlers: [] as ((s: string) => void)[],
    appStateRemove: vi.fn(),
    createSocket: vi.fn(),
    setLiveSocket: vi.fn(),
    replace: vi.fn(),
    useCrewRealtime: vi.fn(),
    useRevocationRealtime: vi.fn(),
    useRealtimeStoreSync: vi.fn(),
    backfill: vi.fn(),
    onAuthError: vi.fn(),
    getSocket: null as null | (() => unknown),
  };
});

// No React renderer in this node harness: hooks collapse to plain values and the
// socket-lifecycle effect is captured so the test runs it (and its cleanup) itself.
vi.mock('react', () => ({
  useCallback: (fn: unknown) => fn,
  useMemo: (fn: () => unknown) => fn(),
  useRef: (v: unknown) => ({ current: v }),
  useEffect: (fn: () => void | (() => void)) => void h.effects.push(fn),
}));
vi.mock('react-native', () => ({
  Alert: { alert: vi.fn() },
  AppState: {
    currentState: 'active',
    addEventListener: (_: string, fn: (s: string) => void) => {
      h.appStateHandlers.push(fn);
      return { remove: h.appStateRemove };
    },
  },
}));
vi.mock('expo-router', () => ({ useRouter: () => ({ replace: h.replace }) }));
vi.mock('../lib/apiOrigin', () => ({ API_ORIGIN: 'https://api.test' }));
vi.mock('../lib/liveSocket', () => ({ setLiveSocket: h.setLiveSocket, useLiveSocket: () => 'live-socket' }));
vi.mock('@festie/shared/services', () => ({
  createSocket: h.createSocket,
  createAuthErrorHandler: (getSocket: () => unknown) => {
    h.getSocket = getSocket;
    return h.onAuthError;
  },
}));
vi.mock('@festie/shared', () => ({ createStoreSink: () => 'sink' }));
vi.mock('@festie/shared/hooks', () => ({
  useCrewRealtime: h.useCrewRealtime,
  useRevocationRealtime: h.useRevocationRealtime,
  useRealtimeStoreSync: h.useRealtimeStoreSync,
}));
vi.mock('@festie/shared/stores', () => {
  const store = <S extends object>(state: S) =>
    Object.assign((select: (s: S) => unknown) => select(state), { getState: () => state });
  return {
    useAuthStore: store(h.auth),
    useFestivalDataStore: store(h.festival),
    useCrewStore: store(h.crew),
    useUIStore: store(h.ui),
    useLiveLocationStore: store(h.live),
  };
});

const { useRealtimeSync } = await import('./useRealtimeSync');

class FakeSocket {
  connected = false;
  active = false;
  auth: unknown = null;
  handlers = new Map<string, Handler>();
  emit = vi.fn();
  connect = vi.fn();
  disconnect = vi.fn();
  on = vi.fn((event: string, fn: Handler) => void this.handlers.set(event, fn));
  off = vi.fn();
  fire(event: string, ...args: unknown[]) {
    (this.handlers.get(event) as unknown as (...a: unknown[]) => void)(...args);
  }
}

let socket: FakeSocket;

/** Renders the hook and returns the teardown that React would run on unmount. */
function mount(): () => void {
  const render: () => { connected: boolean } = useRealtimeSync;
  h.effects.length = 0;
  const result = render();
  expect(result).toEqual({ connected: h.ui.connected });
  const cleanup = h.effects[0]!();
  return typeof cleanup === 'function' ? cleanup : () => {};
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  h.appStateHandlers.length = 0;
  h.auth.userToken = 'tok';
  h.festival.currentFestivalId = 'f1';
  h.crew.activeCrew = { id: 'c1' };
  h.live.sharingCrewId = null;
  socket = new FakeSocket();
  h.createSocket.mockImplementation(() => socket);
  h.useRealtimeStoreSync.mockReturnValue({ backfill: h.backfill });
});

afterEach(() => vi.useRealTimers());

describe('useRealtimeSync: connection gating', () => {
  it('creates no socket without a token and clears the live socket', () => {
    h.auth.userToken = null;
    mount();
    expect(h.createSocket).not.toHaveBeenCalled();
    expect(h.setLiveSocket).toHaveBeenCalledWith(null);
  });

  it('creates no socket without a selected festival', () => {
    h.festival.currentFestivalId = null;
    mount();
    expect(h.createSocket).not.toHaveBeenCalled();
  });

  it('scopes the live-location store to the active crew before connecting', () => {
    mount();
    expect(h.live.setActiveCrew).toHaveBeenCalledWith('c1');
  });

  it('connects with the token and publishes the socket', () => {
    mount();
    expect(h.createSocket).toHaveBeenCalledWith('tok', 'https://api.test', expect.any(Function));
    expect(h.setLiveSocket).toHaveBeenCalledWith(socket);
    expect(h.useCrewRealtime).toHaveBeenCalledWith(expect.objectContaining({ socket: 'live-socket', joinRoom: true }));
  });

  it('routes a revoked session to the login screen', () => {
    mount();
    h.useRevocationRealtime.mock.calls[0]![0].onSessionRevoked();
    expect(h.replace).toHaveBeenCalledWith('/(auth)/login');
  });

  it('hands createSocket the shared auth-error handler bound to the live socket', () => {
    mount();
    expect(h.createSocket).toHaveBeenCalledWith('tok', 'https://api.test', h.onAuthError);
    expect(h.getSocket!()).toBe(socket);
  });

  it('delegates festival, profile, crew and presence events to the shared hook and owns join:festival there', () => {
    mount();
    expect(h.useRealtimeStoreSync).toHaveBeenCalledWith({ socket: 'live-socket', joinFestival: true });
    expect(socket.emit).not.toHaveBeenCalledWith('join:festival', expect.anything(), expect.anything(), expect.anything());
  });
});

describe('useRealtimeSync: AppState lifecycle', () => {
  it('leaves rooms, stops sharing and disconnects when backgrounded while connected', () => {
    socket.connected = true;
    h.live.sharingCrewId = 'c1';
    mount();
    h.appStateHandlers[0]!('background');
    expect(socket.emit).toHaveBeenCalledWith('location:stop', { _v: 1, crewId: 'c1' });
    expect(h.live.stopSharing).toHaveBeenCalledTimes(1);
    expect(socket.emit).toHaveBeenCalledWith('leave:festival');
    expect(socket.emit).toHaveBeenCalledWith('leave:crew', { _v: 1, crewId: 'c1' });
    expect(socket.disconnect).toHaveBeenCalledTimes(1);
  });

  it('clears local sharing and stops a mid-reconnect socket without emitting', () => {
    socket.connected = false;
    socket.active = true;
    h.live.sharingCrewId = 'c1';
    mount();
    h.appStateHandlers[0]!('inactive');
    expect(h.live.stopSharing).toHaveBeenCalledTimes(1);
    expect(socket.emit).not.toHaveBeenCalled();
    expect(socket.disconnect).toHaveBeenCalledTimes(1);
  });

  it('reconnects and backfills when returning to the foreground', () => {
    mount();
    h.appStateHandlers[0]!('background');
    h.appStateHandlers[0]!('active');
    expect(socket.connect).toHaveBeenCalledTimes(1);
    expect(h.backfill).toHaveBeenCalledTimes(1);
  });

  it('does not reconnect an already-active socket on foreground', () => {
    socket.active = true;
    mount();
    h.appStateHandlers[0]!('background');
    h.appStateHandlers[0]!('active');
    expect(socket.connect).not.toHaveBeenCalled();
  });

  it('ignores an active event when the app was already active', () => {
    mount();
    h.appStateHandlers[0]!('active');
    vi.advanceTimersByTime(300);
    expect(socket.connect).not.toHaveBeenCalled();
    expect(h.backfill).not.toHaveBeenCalled();
  });
});

describe('useRealtimeSync: teardown', () => {
  it('removes the AppState subscription and the live socket', () => {
    const cleanup = mount();
    cleanup();
    expect(h.appStateRemove).toHaveBeenCalledTimes(1);
    expect(socket.disconnect).toHaveBeenCalledTimes(1);
    expect(h.setLiveSocket).toHaveBeenLastCalledWith(null);
  });

  it('stops sharing before disconnecting a connected socket and leaves leave:crew to useCrewRealtime', () => {
    socket.connected = true;
    h.live.sharingCrewId = 'c1';
    const cleanup = mount();
    cleanup();
    expect(socket.emit).toHaveBeenCalledWith('location:stop', { _v: 1, crewId: 'c1' });
    expect(socket.emit).not.toHaveBeenCalledWith('leave:crew', expect.anything());
    expect(h.live.stopSharing).toHaveBeenCalledTimes(1);
  });

  it('skips emits on a disconnected socket but still clears sharing', () => {
    h.live.sharingCrewId = 'c1';
    const cleanup = mount();
    cleanup();
    expect(socket.emit).not.toHaveBeenCalled();
    expect(h.live.stopSharing).toHaveBeenCalledTimes(1);
  });
});
