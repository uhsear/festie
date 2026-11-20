// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useUIStore } from '../stores/uiStore';
import { useFestivalDataStore } from '../stores/festivalDataStore';
import { useCrewStore } from '../stores/crewStore';
import { useNotificationPrefsStore, DEFAULT_NOTIFICATION_PREFS } from '../stores/notificationPrefsStore';
import type { Socket } from '../services/socket';
import { useRealtimeStoreSync } from './useRealtimeSync';

type Handler = (...args: never[]) => void;

class FakeSocket {
  connected = false;
  handlers = new Map<string, Handler>();
  emit = vi.fn();
  on = vi.fn((event: string, fn: Handler) => void this.handlers.set(event, fn));
  off = vi.fn();
  fire(event: string, ...args: unknown[]) {
    act(() => (this.handlers.get(event) as unknown as (...a: unknown[]) => void)(...args));
  }
}

const loadProfiles = vi.fn();
const selectFestival = vi.fn();
const applyProfilePatch = vi.fn();
const loadCrews = vi.fn();
const selectCrew = vi.fn();
const applyStatusUpdate = vi.fn();
const setConnected = vi.fn();
const setOnlineUsers = vi.fn();

let socket: FakeSocket;
const mount = (joinFestival?: boolean, s: FakeSocket | null = socket) =>
  renderHook(() => useRealtimeStoreSync({ socket: s as unknown as Socket | null, joinFestival }));
const flush = () => act(() => void vi.advanceTimersByTime(300));

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  for (const fn of [loadProfiles, selectFestival, loadCrews, selectCrew]) fn.mockResolvedValue(undefined);
  applyProfilePatch.mockReturnValue(true);
  useFestivalDataStore.setState({ currentFestivalId: 'f1', loadProfiles, selectFestival, applyProfilePatch } as never);
  useCrewStore.setState({ activeCrew: { id: 'c1' }, loadCrews, selectCrew, applyStatusUpdate } as never);
  useUIStore.setState({ setConnected, setOnlineUsers } as never);
  socket = new FakeSocket();
});

afterEach(() => vi.useRealTimers());

describe('useRealtimeStoreSync: connect and reconnect', () => {
  it('does nothing without a socket', () => {
    mount(true, null);
    expect(socket.on).not.toHaveBeenCalled();
  });

  it('flips the connected flag and does not join the festival room unless asked', () => {
    mount();
    socket.fire('connect');
    expect(setConnected).toHaveBeenCalledWith(true);
    expect(socket.emit).not.toHaveBeenCalled();
    socket.fire('disconnect');
    expect(setConnected).toHaveBeenLastCalledWith(false);
  });

  it('joins the festival room on connect when joinFestival is set', () => {
    mount(true);
    socket.fire('connect');
    expect(socket.emit).toHaveBeenCalledWith('join:festival', 'f1', { _v: 1 }, expect.any(Function));
  });

  it('joins at once when the socket is already connected', () => {
    socket.connected = true;
    mount(true);
    expect(socket.emit).toHaveBeenCalledWith('join:festival', 'f1', { _v: 1 }, expect.any(Function));
  });

  it('does not reload on the first connect', () => {
    mount();
    socket.fire('connect');
    flush();
    expect(loadProfiles).not.toHaveBeenCalled();
    expect(loadCrews).not.toHaveBeenCalled();
  });

  it('reloads picks and crews, not the festival, after a short outage', () => {
    mount();
    socket.fire('connect');
    socket.fire('disconnect');
    act(() => void vi.advanceTimersByTime(10_000));
    socket.fire('connect');
    flush();
    expect(loadProfiles).toHaveBeenCalledWith('f1');
    expect(loadCrews).toHaveBeenCalledTimes(1);
    expect(selectFestival).not.toHaveBeenCalled();
  });

  it('also reloads the festival after an outage of 60 seconds or more', () => {
    mount();
    socket.fire('connect');
    socket.fire('disconnect');
    act(() => void vi.advanceTimersByTime(60_000));
    socket.fire('connect');
    flush();
    expect(selectFestival).toHaveBeenCalledWith('f1');
  });

  it('reloads on the first connect when the socket was already connected', () => {
    socket.connected = true;
    mount();
    socket.fire('connect');
    flush();
    expect(loadProfiles).toHaveBeenCalledTimes(1);
  });
});

describe('useRealtimeStoreSync: event handlers', () => {
  it('patches picks in place and does not reload when the profile is loaded', () => {
    mount();
    socket.fire('pick:updated', { profileId: 'p1', picks: { s1: 'must' }, interestsChanged: false });
    expect(applyProfilePatch).toHaveBeenCalledWith({ profileId: 'p1', picks: { s1: 'must' }, interestsChanged: false });
    flush();
    expect(loadProfiles).not.toHaveBeenCalled();
  });

  it('falls back to one debounced profile reload when the patch cannot apply', () => {
    applyProfilePatch.mockReturnValue(false);
    mount();
    socket.fire('profile:updated', { profileId: 'new' });
    socket.fire('picks:updated', { profileId: 'new' });
    flush();
    expect(loadProfiles).toHaveBeenCalledTimes(1);
    expect(loadProfiles).toHaveBeenCalledWith('f1');
  });

  it('coalesces a burst of events into one reload', () => {
    mount();
    for (const e of ['pick:removed', 'note:saved', 'profile:joined', 'profile:left']) socket.fire(e, {});
    flush();
    expect(loadProfiles).toHaveBeenCalledTimes(1);
  });

  it('reloads the festival only when festival:updated names the current festival', () => {
    mount();
    socket.fire('festival:updated', { id: 'other' });
    socket.fire('festival:updated', {});
    flush();
    expect(selectFestival).not.toHaveBeenCalled();
    socket.fire('festival:updated', { id: 'f1' });
    flush();
    expect(selectFestival).toHaveBeenCalledWith('f1');
  });

  it('reloads the festival once on set-added and set-updated', () => {
    mount();
    socket.fire('festival:set-added', {});
    socket.fire('festival:set-updated', {});
    flush();
    expect(selectFestival).toHaveBeenCalledTimes(1);
  });

  it('reloads crews and re-selects the crew only when it is the active one', () => {
    mount();
    socket.fire('crew:updated', { crewId: 'other' });
    flush();
    expect(loadCrews).toHaveBeenCalledTimes(1);
    expect(selectCrew).not.toHaveBeenCalled();
    socket.fire('crew:member-joined', { crewId: 'c1' });
    flush();
    expect(selectCrew).toHaveBeenCalledWith('c1');
  });

  it('applies a crew status only for the open crew', () => {
    mount();
    socket.fire('crew:status-updated', { status: { crew_id: 'other' } });
    socket.fire('crew:status-updated', {});
    expect(applyStatusUpdate).not.toHaveBeenCalled();
    const row = { crew_id: 'c1' };
    socket.fire('crew:status-updated', { status: row });
    expect(applyStatusUpdate).toHaveBeenCalledWith(row);
  });

  it('maps the server presence payload (online) to online users and ignores one without it', () => {
    mount();
    socket.fire('presence:update', {});
    expect(setOnlineUsers).not.toHaveBeenCalled();
    socket.fire('presence:update', { online: [{ userId: 'u1', username: 'Ann', avatarUrl: 'a.png' }] });
    expect(setOnlineUsers).toHaveBeenCalledWith([{ id: 'u1', name: 'Ann', avatar: 'a.png', status: 'online' }]);
  });
});

describe('useRealtimeStoreSync: quiet-hours time zone on foreground', () => {
  const real = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const savedZone = real === 'Pacific/Auckland' ? 'Europe/Paris' : 'Pacific/Auckland';

  beforeEach(() => {
    useNotificationPrefsStore.setState({
      loaded: true,
      prefs: { ...DEFAULT_NOTIFICATION_PREFS, dndStart: '23:00', dndEnd: '08:00', dndTimeZone: savedZone },
    });
  });

  it('a zone change plus a backfill updates dndTimeZone', () => {
    const updatePrefs = vi.fn().mockResolvedValue(undefined);
    useNotificationPrefsStore.setState({ updatePrefs });
    const { result } = mount();
    act(() => result.current.backfill());
    expect(updatePrefs).toHaveBeenCalledWith({ dndTimeZone: real });
  });

  it('a zone change plus a visibilitychange to visible updates dndTimeZone', () => {
    const updatePrefs = vi.fn().mockResolvedValue(undefined);
    useNotificationPrefsStore.setState({ updatePrefs });
    mount();
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    expect(updatePrefs).toHaveBeenCalledWith({ dndTimeZone: real });
  });

  it('does nothing when the zone is unchanged', () => {
    const updatePrefs = vi.fn().mockResolvedValue(undefined);
    useNotificationPrefsStore.setState({ updatePrefs, prefs: { ...useNotificationPrefsStore.getState().prefs, dndTimeZone: real } });
    const { result } = mount();
    act(() => result.current.backfill());
    expect(updatePrefs).not.toHaveBeenCalled();
  });
});

describe('useRealtimeStoreSync: backfill and teardown', () => {
  it('backfill reloads festival, profiles and crews once', () => {
    const { result } = mount();
    act(() => result.current.backfill());
    flush();
    expect(selectFestival).toHaveBeenCalledWith('f1');
    expect(loadProfiles).toHaveBeenCalledWith('f1');
    expect(loadCrews).toHaveBeenCalledTimes(1);
  });

  it('removes every listener and cancels pending reloads on unmount', () => {
    const { unmount } = mount();
    socket.fire('pick:removed', {});
    unmount();
    expect(socket.off).toHaveBeenCalledTimes(socket.on.mock.calls.length);
    act(() => void vi.advanceTimersByTime(1000));
    expect(loadProfiles).not.toHaveBeenCalled();
  });
});
