import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

const get = vi.fn();
const post = vi.fn().mockResolvedValue(undefined);
const del = vi.fn().mockResolvedValue(undefined);
vi.mock('@festie/shared/services/api', () => ({
  api: {
    get: (...a: unknown[]) => get(...a),
    post: (...a: unknown[]) => post(...a),
    delete: (...a: unknown[]) => del(...a),
  },
}));

const user: { id: string } | null = { id: 'u1' };
vi.mock('@festie/shared/stores/authStore', () => ({
  useAuthStore: (sel: (s: { user: unknown }) => unknown) => sel({ user }),
}));

const subscribe = vi.fn();
const getSubscription = vi.fn();

function installBrowser() {
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { ready: Promise.resolve({ pushManager: { subscribe, getSubscription } }) },
  });
  (window as unknown as { PushManager: unknown }).PushManager = function PushManager() {};
  (window as unknown as { Notification: unknown }).Notification = {
    permission: 'granted',
    requestPermission: vi.fn(),
  };
}

// The VAPID key is cached at module level, so load a fresh module per test.
async function freshHook() {
  vi.resetModules();
  const mod = await import('./usePushNotifications');
  return renderHook(() => mod.usePushNotifications());
}

describe('usePushNotifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installBrowser();
  });

  it('reports not-configured when /vapid-key is 404', async () => {
    get.mockRejectedValue(Object.assign(new Error('nf'), { status: 404 }));
    getSubscription.mockResolvedValue(null);
    const { result } = await freshHook();
    await waitFor(() => expect(result.current.unsupportedReason).toBe('not-configured'));
    expect(result.current.isSupported).toBe(false);
  });

  it('reports a retryable key error, not not-configured, on a 5xx', async () => {
    get.mockRejectedValueOnce(Object.assign(new Error('boom'), { status: 503 }));
    getSubscription.mockResolvedValue(null);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { result } = await freshHook();
    expect(result.current.checking).toBe(true);
    await waitFor(() => expect(result.current.keyError).toBe(true));
    expect(result.current.unsupportedReason).toBeNull();
    expect(result.current.checking).toBe(false);
    get.mockResolvedValue({ publicKey: 'BAAA' });
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.isSupported).toBe(true));
    expect(result.current.keyError).toBe(false);
  });

  it('does not subscribe on auto-register when there is no subscription', async () => {
    get.mockResolvedValue({ publicKey: 'BAAA' });
    getSubscription.mockResolvedValue(null);
    const { result } = await freshHook();
    await waitFor(() => expect(result.current.isSupported).toBe(true));
    await act(async () => {});
    expect(user).not.toBeNull();
    expect(subscribe).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });

  it('unregisterToken sends the token in the DELETE body and unsubscribes', async () => {
    get.mockResolvedValue({ publicKey: 'BAAA' });
    const unsubscribe = vi.fn().mockResolvedValue(true);
    const sub = { toJSON: () => ({ endpoint: 'https://push.example/1' }), unsubscribe };
    getSubscription.mockResolvedValue(null);
    const { result } = await freshHook();
    await waitFor(() => expect(result.current.isSupported).toBe(true));
    getSubscription.mockResolvedValue(sub);
    await act(async () => {
      await result.current.unregisterToken();
    });
    expect(del).toHaveBeenCalledWith('/notifications/token', {
      body: { token: JSON.stringify({ endpoint: 'https://push.example/1' }) },
    });
    expect(unsubscribe).toHaveBeenCalled();
  });
});
