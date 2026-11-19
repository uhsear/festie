import { describe, it, expect, vi } from 'vitest';
import { io } from 'socket.io-client';
import { createSocket } from './socket';

vi.mock('socket.io-client', () => ({ io: vi.fn() }));

function fakeSocket() {
  const handlers: Record<string, (arg?: unknown) => void> = {};
  const socket = {
    on: vi.fn((event: string, handler: (arg?: unknown) => void) => { handlers[event] = handler; }),
    disconnect: vi.fn(),
  };
  vi.mocked(io).mockReturnValue(socket as never);
  return { handlers, socket };
}

describe('createSocket auth recovery', () => {
  it('calls onAuthError once and stops retrying on a 401 handshake rejection', () => {
    const { handlers, socket } = fakeSocket();
    const onAuthError = vi.fn();
    createSocket('tok', 'http://localhost', onAuthError);

    const err = Object.assign(new Error('Invalid session token'), { data: { status: 401 } });
    handlers.connect_error(err);
    handlers.connect_error(err);

    expect(socket.disconnect).toHaveBeenCalled();
    expect(onAuthError).toHaveBeenCalledTimes(1);
  });

  it('leaves a 503 handshake rejection to the normal reconnect backoff', () => {
    const { handlers, socket } = fakeSocket();
    const onAuthError = vi.fn();
    createSocket('tok', 'http://localhost', onAuthError);

    handlers.connect_error(Object.assign(new Error('Session check unavailable'), { data: { status: 503 } }));

    expect(socket.disconnect).not.toHaveBeenCalled();
    expect(onAuthError).not.toHaveBeenCalled();
  });
});
