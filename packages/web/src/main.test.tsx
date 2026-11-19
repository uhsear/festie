import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { User } from '@festie/shared';

const m = vi.hoisted(() => ({
  setOnUnauthorized: vi.fn(),
  noticeSignedOut: vi.fn(),
  clearOfflineQueue: vi.fn(),
  clear: vi.fn(),
  render: vi.fn(),
}));

vi.mock('react-dom/client', () => ({
  default: { createRoot: () => ({ render: m.render }) },
}));
vi.mock('@tanstack/react-query', async (orig) => {
  const actual = await orig<typeof import('@tanstack/react-query')>();
  class FakeClient extends actual.QueryClient {
    clear = m.clear;
  }
  return { ...actual, QueryClient: FakeClient };
});
vi.mock('@festie/shared/services', async (orig) => ({
  ...(await orig<typeof import('@festie/shared/services')>()),
  setOnUnauthorized: m.setOnUnauthorized,
  noticeSignedOut: m.noticeSignedOut,
}));
vi.mock('./hooks/useOfflineQueue', () => ({ clearOfflineQueue: m.clearOfflineQueue }));
vi.mock('./router', () => ({ router: {} }));
vi.mock('./lib/web-vitals', () => ({ initWebVitals: vi.fn() }));
vi.mock('./styles/globals.css', () => ({}));

const user = (id: string) => ({ id }) as User;

async function loadMain() {
  vi.resetModules();
  document.body.innerHTML = '<div id="root"></div>';
  await import('./main');
  const { useAuthStore } = await import('@festie/shared');
  const handler = m.setOnUnauthorized.mock.calls[0][0] as () => Promise<boolean>;
  return { useAuthStore, handler };
}

describe('main.tsx wiring', { timeout: 30000 }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.clearOfflineQueue.mockResolvedValue(undefined);
  });

  it('refreshes the token on 401 and reports success', async () => {
    const { useAuthStore, handler } = await loadMain();
    const refreshToken = vi.fn().mockResolvedValue(undefined);
    useAuthStore.setState({ user: user('u1'), refreshToken });
    await expect(handler()).resolves.toBe(true);
    expect(m.noticeSignedOut).not.toHaveBeenCalled();
  });

  it('signs out and notices when refresh fails for a signed-in user', async () => {
    const { useAuthStore, handler } = await loadMain();
    // The real refreshToken clears the user before rethrowing, so wasSignedIn must be read first.
    const refreshToken = vi.fn(async () => {
      useAuthStore.setState({ user: null });
      throw new Error('no');
    });
    useAuthStore.setState({ user: user('u1'), refreshToken });
    await expect(handler()).resolves.toBe(false);
    expect(useAuthStore.getState().user).toBeNull();
    expect(m.noticeSignedOut).toHaveBeenCalledWith(true);
  });

  it('passes wasSignedIn=false when no user was signed in', async () => {
    const { useAuthStore, handler } = await loadMain();
    useAuthStore.setState({ user: null, refreshToken: vi.fn().mockRejectedValue(new Error('no')) });
    await handler();
    expect(m.noticeSignedOut).toHaveBeenCalledWith(false);
  });

  it('clears the query cache and offline queue when the user changes', async () => {
    const { useAuthStore } = await loadMain();
    useAuthStore.setState({ user: user('u1') });
    expect(m.clear).not.toHaveBeenCalled();
    useAuthStore.setState({ user: user('u2') });
    expect(m.clear).toHaveBeenCalledTimes(1);
    expect(m.clearOfflineQueue).toHaveBeenCalledTimes(1);
  });

  it('clears on sign-out but not on first sign-in', async () => {
    const { useAuthStore } = await loadMain();
    useAuthStore.setState({ user: user('u1') });
    expect(m.clear).not.toHaveBeenCalled();
    useAuthStore.setState({ user: null });
    expect(m.clear).toHaveBeenCalledTimes(1);
  });

  it('swallows clearOfflineQueue rejection', async () => {
    m.clearOfflineQueue.mockRejectedValue(new Error('idb'));
    const { useAuthStore } = await loadMain();
    useAuthStore.setState({ user: user('u1') });
    useAuthStore.setState({ user: user('u2') });
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      await new Promise((resolve) => setTimeout(resolve, 0));
    } finally {
      process.off('unhandledRejection', unhandled);
    }
    expect(m.clearOfflineQueue).toHaveBeenCalledTimes(1);
    expect(unhandled).not.toHaveBeenCalled();
  });
});
