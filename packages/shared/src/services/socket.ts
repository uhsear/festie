import { io, Socket } from 'socket.io-client';
import { SOCKET_RECONNECTION_CONFIG } from '../constants/config';

export interface SocketOptions {
  auth?: {
    token: string;
  };
  transports?: string[];
  reconnection?: boolean;
  reconnectionDelay?: number;
  randomizationFactor?: number;
  reconnectionDelayMax?: number;
  reconnectionAttempts?: number;
}

export function createSocket(
  bearerToken?: string,
  baseUrl?: string,
  // Called once when the socket is disconnected by an auth failure (401/403).
  // The caller should attempt a single token refresh and reconnect; without it
  // the socket stays dead until an unrelated HTTP request triggers the refresh
  // chain, silently stalling realtime updates.
  onAuthError?: () => void,
): Socket {
  const opts: SocketOptions = {
    transports: ['websocket'],
    ...SOCKET_RECONNECTION_CONFIG,
  };

  if (bearerToken) {
    opts.auth = { token: bearerToken };
  }

  let url = baseUrl;
  if (!url && typeof window !== 'undefined') {
    try {
      const apiBase = window.__FP_API_BASE;
      if (apiBase) {
        url = new URL(apiBase).origin;
      }
    } catch {
      url = undefined;
    }
  }

  const socket = io(url || undefined, opts);

  // Guard so a burst of auth errors triggers at most one refresh attempt; reset
  // once a (re)connection succeeds so a later token expiry can re-trigger.
  let authErrorHandled = false;
  let authFailed = false;
  socket.on('connect', () => {
    authErrorHandled = false;
    authFailed = false;
  });
  socket.on('connect_error', (err: Error & { data?: { status?: number }; status?: number }) => {
    const status = err?.data?.status ?? err?.status;
    if (status === 401 || status === 403) {
      socket.disconnect();
      authFailed = true;
      if (onAuthError && !authErrorHandled) {
        authErrorHandled = true;
        onAuthError();
      }
    }
  });

  // Skip socket.io's backoff (up to reconnectionDelayMax) once the network is back or the
  // tab is visible again. Browser-only: React Native has no window/document listeners.
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    const cleanup = () => {
      window.removeEventListener('online', revive);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
    };
    const revive = () => {
      if (authFailed || socket.connected) return;
      // Disposed (disconnect/destroy) while not connected: 'disconnect' never fired, so detach here.
      if (!socket.active) return cleanup();
      // connect() alone is a no-op while socket.io waits to retry; disconnect() clears that wait.
      socket.disconnect().connect();
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') revive();
    };
    window.addEventListener('online', revive);
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);
    socket.on('disconnect', (reason: string) => {
      if (reason === 'io client disconnect') cleanup();
    });
  }

  return socket;
}

/**
 * The `onAuthError` callback for createSocket: one token refresh, then reconnect
 * with the new token. On failure the socket stays disconnected (the next HTTP
 * request drives the refresh/logout path). `getSocket` is read lazily because the
 * callback is passed to createSocket before the socket exists. The auth store is
 * injected (callers pass `useAuthStore.getState`) so the services barrel does not
 * import the stores.
 */
export function createAuthErrorHandler(
  getSocket: () => Socket | null,
  getAuth: () => { refreshToken: () => Promise<unknown>; userToken: string | null },
): () => void {
  return () => {
    getAuth()
      .refreshToken()
      .then(() => {
        const token = getAuth().userToken;
        const socket = getSocket();
        if (token && socket) {
          socket.auth = { token };
          socket.connect();
        }
      })
      .catch((e) => console.warn('socket token refresh failed; realtime paused until the next request', e));
  };
}

export { Socket };
