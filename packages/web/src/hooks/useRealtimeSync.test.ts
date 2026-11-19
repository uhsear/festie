import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { revocation, navigate, toast, storeSync } = vi.hoisted(() => ({
  revocation: vi.fn(),
  navigate: vi.fn(),
  toast: vi.fn(),
  storeSync: vi.fn(),
}));
const fakeSocket = { connected: true, on: vi.fn(), off: vi.fn(), emit: vi.fn() };

vi.mock('@festie/shared/hooks/useSocket', () => ({ useSocket: () => ({ socket: fakeSocket }) }));
vi.mock('@festie/shared/hooks/useCrewRealtime', () => ({ useCrewRealtime: vi.fn() }));
vi.mock('@festie/shared/hooks/useRealtimeSync', () => ({ useRealtimeStoreSync: storeSync }));
vi.mock('@festie/shared/hooks', () => ({ useRevocationRealtime: revocation }));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }));
vi.mock('../lib/toastContext', () => ({ useToast: () => ({ toast }) }));
vi.mock('./useCrewQuerySink', () => ({ useCrewQuerySink: () => ({}) }));

import { useUIStore } from '@festie/shared/stores/uiStore';
import { useRealtimeSync } from './useRealtimeSync';

describe('useRealtimeSync (T58)', () => {
  beforeEach(() => storeSync.mockClear());

  it('binds the shared store sync to the useSocket socket and leaves the festival room to useSocket', () => {
    renderHook(() => useRealtimeSync());
    expect(storeSync).toHaveBeenCalledWith({ socket: fakeSocket });
  });

  it('does not re-render when onlineUsers changes', () => {
    let renders = 0;
    renderHook(() => {
      renders++;
      return useRealtimeSync();
    });
    const before = renders;
    act(() => useUIStore.setState({ onlineUsers: [{ id: 'u1', name: 'a', status: 'online' }] } as never));
    expect(renders).toBe(before);
  });

  it('wires revocation to the socket: session revoke goes to /login, crew notice shows an info toast', () => {
    revocation.mockClear();
    renderHook(() => useRealtimeSync());
    const opts = revocation.mock.calls.at(-1)![0];
    expect(opts.socket).toBe(fakeSocket);
    opts.onSessionRevoked();
    expect(navigate).toHaveBeenCalledWith({ to: '/login' });
    opts.onCrewNotice({ message: 'You were removed' });
    expect(toast).toHaveBeenCalledWith('You were removed', 'info');
  });
});
