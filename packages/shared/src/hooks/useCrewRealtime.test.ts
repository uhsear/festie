// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useCrewRealtime } from './useCrewRealtime';
import { useCrewStore } from '../stores/crewStore';
import type { Socket } from '../services/socket';
import type { CrewRealtimeSink } from '../realtime/crewRealtimeSink';

function makeFakeSocket(connected: boolean) {
  const handlers: Record<string, (data?: unknown) => void> = {};
  const socket = {
    connected,
    on: (event: string, fn: (data?: unknown) => void) => {
      handlers[event] = fn;
    },
    off: (event: string) => {
      delete handlers[event];
    },
    emit: vi.fn(),
  } as unknown as Socket;
  return { socket, fire: (event: string) => handlers[event]?.() };
}

function render(connected: boolean) {
  const fake = makeFakeSocket(connected);
  const sink = { onSosResync: vi.fn(), onReconnectResync: vi.fn() } as unknown as CrewRealtimeSink;
  renderHook(() => useCrewRealtime({ socket: fake.socket, getActiveCrewId: () => 'c1', sink }));
  return { fire: fake.fire, sink };
}

describe('useCrewRealtime reconnect resync', () => {
  it('the first connect re-reads SOS only; a second connect also resyncs the crew', () => {
    const { fire, sink } = render(false);

    fire('connect');
    expect(sink.onSosResync).toHaveBeenCalledTimes(1);
    expect(sink.onReconnectResync).not.toHaveBeenCalled();

    fire('connect');
    expect(sink.onSosResync).toHaveBeenCalledTimes(2);
    expect(sink.onReconnectResync).toHaveBeenCalledTimes(1);
    expect(sink.onReconnectResync).toHaveBeenCalledWith('c1');
  });

  it('a connect on a socket that was already connected when the hook mounted is a reconnect', () => {
    const { fire, sink } = render(true);
    fire('connect');
    expect(sink.onReconnectResync).toHaveBeenCalledWith('c1');
  });
});

describe('useCrewRealtime crew room join', () => {
  it('joins the room as soon as a crew opens, without waiting for another render', () => {
    useCrewStore.setState({ activeCrew: null });
    const fake = makeFakeSocket(true);
    const sink = { onSosResync: vi.fn(), onReconnectResync: vi.fn() } as unknown as CrewRealtimeSink;
    renderHook(() =>
      useCrewRealtime({
        socket: fake.socket,
        getActiveCrewId: () => useCrewStore.getState().activeCrew?.id ?? null,
        sink,
      }),
    );
    expect(fake.socket.emit).not.toHaveBeenCalledWith('join:crew', expect.anything(), expect.anything());

    act(() => {
      useCrewStore.setState({ activeCrew: { id: 'c2' } as never });
    });
    expect(fake.socket.emit).toHaveBeenCalledWith('join:crew', { _v: 1, crewId: 'c2' }, expect.any(Function));
  });
});
