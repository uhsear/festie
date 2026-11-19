// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useFestivalStore } from '../stores/festivalStore';
import { useFestivalDataStore } from '../stores/festivalDataStore';
import { useAuthStore } from '../stores/authStore';

const createSocket = vi.fn();
vi.mock('../services/socket', () => ({
  createSocket: (...args: unknown[]) => createSocket(...args),
  createAuthErrorHandler: () => () => {},
}));

import { useSocket } from './useSocket';

const fakeSocket = () => {
  const handlers: Record<string, () => void> = {};
  return {
    on: vi.fn((event: string, fn: () => void) => void (handlers[event] = fn)),
    off: vi.fn(),
    emit: vi.fn(),
    disconnect: vi.fn(),
    connected: false,
    handlers,
  };
};

describe('useSocket', () => {
  beforeEach(() => {
    createSocket.mockReset();
    createSocket.mockImplementation(fakeSocket);
    useFestivalStore.setState({ currentFestivalId: null } as never);
  });

  it('does not open a socket without a festival to join (FND-068)', () => {
    renderHook(() => useSocket());
    expect(createSocket).not.toHaveBeenCalled();
  });

  it('opens a socket once a festival is known', () => {
    renderHook(() => useSocket('fest-1'));
    expect(createSocket).toHaveBeenCalledTimes(1);
  });

  it('joins the festival room once per connect with the versioned payload and an ack', () => {
    renderHook(() => useSocket('fest-1'));
    const socket = createSocket.mock.results[0]!.value;
    socket.handlers.connect!();
    expect(socket.emit).toHaveBeenCalledTimes(1);
    expect(socket.emit).toHaveBeenCalledWith('join:festival', 'fest-1', { _v: 1 }, expect.any(Function));
    expect(socket.on).not.toHaveBeenCalledWith('presence:update', expect.anything());
  });

  it('opens no socket for a signed-in non-member, and one once a profile exists', () => {
    useAuthStore.setState({ user: { id: 'u1' } } as never);
    useFestivalDataStore.setState({ currentProfile: null } as never);
    const { rerender } = renderHook(() => useSocket('fest-1'));
    expect(createSocket).not.toHaveBeenCalled();

    act(() => useFestivalDataStore.setState({ currentProfile: { id: 'p1' } } as never));
    rerender();
    expect(createSocket).toHaveBeenCalledTimes(1);
    useAuthStore.setState({ user: null } as never);
  });
});
