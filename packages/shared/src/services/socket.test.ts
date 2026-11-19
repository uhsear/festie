import { describe, it, expect, vi } from 'vitest';
import { io } from 'socket.io-client';
import { createSocket, createAuthErrorHandler } from './socket';

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

describe('createAuthErrorHandler', () => {
  const setup = (refreshToken: () => Promise<void>, userToken: string | null) => {
    const socket = { auth: {}, connect: vi.fn() };
    return { socket, handler: createAuthErrorHandler(() => socket as never, () => ({ refreshToken, userToken })) };
  };

  it('reconnects with the refreshed token', async () => {
    const { socket, handler } = setup(async () => {}, 'fresh');
    handler();
    await vi.waitFor(() => expect(socket.connect).toHaveBeenCalledTimes(1));
    expect(socket.auth).toEqual({ token: 'fresh' });
  });

  it('stays disconnected when the refresh fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { socket, handler } = setup(() => Promise.reject(new Error('nope')), 'old');
    handler();
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
    expect(socket.connect).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
