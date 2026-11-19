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
vi.mock('@festie/shared/services', () => ({ createSocket: h.createSocket }));
vi.mock('@festie/shared', () => ({ createStoreSink: () => 'sink' }));
vi.mock('@festie/shared/hooks', () => ({
  useCrewRealtime: h.useCrewRealtime,
  useRevocationRealtime: h.useRevocationRealtime,
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
let authFailed: () => void;

/** Renders the hook and returns the teardown that React would run on unmount. */
function mount(): () => void {
  const render: () => { connected: boolean } = useRealtimeSync;
  h.effects.length = 0;
  const result = render();
  expect(result).toEqual({ connected: h.ui.connected });
  const cleanup = h.effects[0]();
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
  h.festival.applyProfilePatch.mockReturnValue(true);
  for (const fn of [h.festival.loadProfiles, h.festival.selectFestival, h.crew.loadCrews, h.crew.selectCrew]) {
    fn.mockResolvedValue(undefined);
  }
  socket = new FakeSocket();
  h.createSocket.mockImplementation((_token: string, _origin: string, onAuthFail: () => void) => {
    authFailed = onAuthFail;
    return socket;
  });
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
    h.useRevocationRealtime.mock.calls[0][0].onSessionRevoked();
    expect(h.replace).toHaveBeenCalledWith('/(auth)/login');
  });

  it('reconnects with the refreshed token after a socket auth failure', async () => {
    h.auth.refreshToken.mockImplementation(async () => {
      h.auth.userToken = 'fresh';
    });
    mount();
    authFailed();
    await vi.waitFor(() => expect(socket.connect).toHaveBeenCalledTimes(1));
    expect(socket.auth).toEqual({ token: 'fresh' });
  });

  it('stays disconnected when the token refresh fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    h.auth.refreshToken.mockRejectedValue(new Error('nope'));
    mount();
    authFailed();
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
    expect(socket.connect).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('useRealtimeSync: connect and reconnect', () => {
  it('joins the festival room on connect and flips the connected flag', () => {
    mount();
    socket.fire('connect');
    expect(h.ui.setConnected).toHaveBeenCalledWith(true);
    expect(socket.emit).toHaveBeenCalledWith('join:festival', 'f1', { _v: 1 }, expect.any(Function));
    socket.fire('disconnect');
    expect(h.ui.setConnected).toHaveBeenLastCalledWith(false);
  });

  it('does not reload on the first connect', () => {
    mount();
    socket.fire('connect');
    vi.advanceTimersByTime(1000);
    expect(h.festival.loadProfiles).not.toHaveBeenCalled();
    expect(h.crew.loadCrews).not.toHaveBeenCalled();
  });

  it('reloads picks and crews, not the festival, after a short outage', () => {
    mount();
    socket.fire('connect');
    socket.fire('disconnect');
    vi.advanceTimersByTime(10_000);
    socket.fire('connect');
    vi.advanceTimersByTime(300);
    expect(h.festival.loadProfiles).toHaveBeenCalledWith('f1');
    expect(h.crew.loadCrews).toHaveBeenCalledTimes(1);
    expect(h.festival.selectFestival).not.toHaveBeenCalled();
  });

  it('also reloads the festival after an outage of 60 seconds or more', () => {
    mount();
    socket.fire('connect');
    socket.fire('disconnect');
    vi.advanceTimersByTime(60_000);
    socket.fire('connect');
    vi.advanceTimersByTime(300);
    expect(h.festival.selectFestival).toHaveBeenCalledWith('f1');
  });

  it('reloads on the first connect when the socket was already connected', () => {
    socket.connected = true;
    mount();
    socket.fire('connect');
    vi.advanceTimersByTime(300);
    expect(h.festival.loadProfiles).toHaveBeenCalledTimes(1);
  });
});

describe('useRealtimeSync: event handlers', () => {
  it('patches picks in place and does not reload when the profile is loaded', () => {
    mount();
    socket.fire('pick:updated', { profileId: 'p1', picks: { s1: 'must' }, interestsChanged: false });
    expect(h.festival.applyProfilePatch).toHaveBeenCalledWith({
      profileId: 'p1',
      picks: { s1: 'must' },
      interestsChanged: false,
    });
    vi.advanceTimersByTime(300);
    expect(h.festival.loadProfiles).not.toHaveBeenCalled();
  });

  it('falls back to one debounced profile reload when the patch cannot apply', () => {
    h.festival.applyProfilePatch.mockReturnValue(false);
    mount();
    socket.fire('profile:updated', { profileId: 'new' });
    socket.fire('picks:updated', { profileId: 'new' });
    vi.advanceTimersByTime(300);
    expect(h.festival.loadProfiles).toHaveBeenCalledTimes(1);
    expect(h.festival.loadProfiles).toHaveBeenCalledWith('f1');
  });

  it('coalesces a burst of events into one reload', () => {
    mount();
    for (const e of ['pick:removed', 'note:saved', 'profile:joined', 'profile:left']) socket.fire(e, {});
    vi.advanceTimersByTime(300);
    expect(h.festival.loadProfiles).toHaveBeenCalledTimes(1);
  });

  it('reloads the festival only when festival:updated names the current festival', () => {
    mount();
    socket.fire('festival:updated', { id: 'other' });
    vi.advanceTimersByTime(300);
    expect(h.festival.selectFestival).not.toHaveBeenCalled();
    socket.fire('festival:updated', { id: 'f1' });
    vi.advanceTimersByTime(300);
    expect(h.festival.selectFestival).toHaveBeenCalledWith('f1');
  });

  it('reloads the festival on set-added and set-updated', () => {
    mount();
    socket.fire('festival:set-added', {});
    socket.fire('festival:set-updated', {});
    vi.advanceTimersByTime(300);
    expect(h.festival.selectFestival).toHaveBeenCalledTimes(1);
  });

  it('reloads crews and re-selects the crew only when it is the active one', () => {
    mount();
    socket.fire('crew:updated', { crewId: 'other' });
    vi.advanceTimersByTime(300);
    expect(h.crew.loadCrews).toHaveBeenCalledTimes(1);
    expect(h.crew.selectCrew).not.toHaveBeenCalled();
    socket.fire('crew:member-joined', { crewId: 'c1' });
    vi.advanceTimersByTime(300);
    expect(h.crew.selectCrew).toHaveBeenCalledWith('c1');
  });

  it('applies a crew status only for the open crew', () => {
    mount();
    socket.fire('crew:status-updated', { status: { crew_id: 'other' } });
    socket.fire('crew:status-updated', {});
    expect(h.crew.applyStatusUpdate).not.toHaveBeenCalled();
    const row = { crew_id: 'c1' };
    socket.fire('crew:status-updated', { status: row });
    expect(h.crew.applyStatusUpdate).toHaveBeenCalledWith(row);
  });

  it('maps presence to online users and ignores a payload without online', () => {
    mount();
    socket.fire('presence:update', {});
    expect(h.ui.setOnlineUsers).not.toHaveBeenCalled();
    socket.fire('presence:update', { online: [{ userId: 'u1', username: 'Ann', avatarUrl: 'a.png' }] });
    expect(h.ui.setOnlineUsers).toHaveBeenCalledWith([{ id: 'u1', name: 'Ann', avatar: 'a.png', status: 'online' }]);
  });
});

describe('useRealtimeSync: AppState lifecycle', () => {
  it('leaves rooms, stops sharing and disconnects when backgrounded while connected', () => {
    socket.connected = true;
    h.live.sharingCrewId = 'c1';
    mount();
    h.appStateHandlers[0]('background');
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
    h.appStateHandlers[0]('inactive');
    expect(h.live.stopSharing).toHaveBeenCalledTimes(1);
    expect(socket.emit).not.toHaveBeenCalled();
    expect(socket.disconnect).toHaveBeenCalledTimes(1);
  });

  it('reconnects and backfills all three stores when returning to the foreground', () => {
    mount();
    h.appStateHandlers[0]('background');
    h.appStateHandlers[0]('active');
    expect(socket.connect).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(300);
    expect(h.festival.selectFestival).toHaveBeenCalledWith('f1');
    expect(h.festival.loadProfiles).toHaveBeenCalledWith('f1');
    expect(h.crew.loadCrews).toHaveBeenCalledTimes(1);
  });

  it('does not reconnect an already-active socket on foreground', () => {
    socket.active = true;
    mount();
    h.appStateHandlers[0]('background');
    h.appStateHandlers[0]('active');
    expect(socket.connect).not.toHaveBeenCalled();
  });

  it('ignores an active event when the app was already active', () => {
    mount();
    h.appStateHandlers[0]('active');
    vi.advanceTimersByTime(300);
    expect(socket.connect).not.toHaveBeenCalled();
    expect(h.festival.selectFestival).not.toHaveBeenCalled();
  });
});

describe('useRealtimeSync: teardown', () => {
  it('removes every listener, the AppState subscription, and the live socket', () => {
    const cleanup = mount();
    cleanup();
    expect(h.appStateRemove).toHaveBeenCalledTimes(1);
    expect(socket.off).toHaveBeenCalledTimes(socket.on.mock.calls.length);
    expect(socket.disconnect).toHaveBeenCalledTimes(1);
    expect(h.setLiveSocket).toHaveBeenLastCalledWith(null);
  });

  it('cancels pending debounced reloads', () => {
    const cleanup = mount();
    socket.fire('pick:removed', {});
    cleanup();
    vi.advanceTimersByTime(1000);
    expect(h.festival.loadProfiles).not.toHaveBeenCalled();
  });

  it('stops sharing and leaves the crew room before disconnecting a connected socket', () => {
    socket.connected = true;
    h.live.sharingCrewId = 'c1';
    const cleanup = mount();
    cleanup();
    expect(socket.emit).toHaveBeenCalledWith('location:stop', { _v: 1, crewId: 'c1' });
    expect(socket.emit).toHaveBeenCalledWith('leave:crew', { _v: 1, crewId: 'c1' });
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
