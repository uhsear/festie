/**
 * Tests for the localStorage fallback path in useOfflineQueue.
 *
 * When IndexedDB is unavailable (private browsing, storage quota errors, etc.)
 * the hook falls back to localStorage. The critical invariant is that a
 * successfully replayed entry is REMOVED from localStorage — not re-sent on
 * every subsequent drain — and that permanently-failed entries are also removed
 * rather than retried forever.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// A small stateful uiStore: the queue (and the shared failed-sync helpers it
// calls) read and write failedSync / offlineMode through getState().
type FailedItem = { clientId: string } & Record<string, unknown>;
const ui = vi.hoisted(() => {
  const state = {
    failedSync: [] as FailedItem[],
    offlineMode: false,
    setPendingSync: () => {},
    setOfflineMode: (offline: boolean) => {
      state.offlineMode = offline;
    },
    addFailedSync: (item: FailedItem) => {
      state.failedSync = [...state.failedSync.filter((f) => f.clientId !== item.clientId), item];
    },
    dismissFailedSync: (clientId: string) => {
      state.failedSync = state.failedSync.filter((f) => f.clientId !== clientId);
    },
  };
  return state;
});
vi.mock('@festie/shared/stores/uiStore', () => {
  const useUIStore = (selector: (s: typeof ui) => unknown) => selector(ui);
  useUIStore.getState = () => ui;
  return { useUIStore };
});

// Import AFTER mocks are set up
import { MAX_RETRIES } from '@festie/shared/services';
import { useOfflineQueue } from './useOfflineQueue';

const LS_KEY = 'festie-offline-queue';
const FAILED_KEY = 'festie-offline-failed';
const networkError = () => Object.assign(new Error('Network request failed'), { status: 0, isNetworkError: true });

/**
 * Make indexedDB.open always fire onerror so openDB() rejects and every
 * IDB-path call falls through to the localStorage fallback.
 */
function makeIDBUnavailable() {
  const fakeOpen = () => {
    const req = {
      result: null,
      error: new DOMException('IDB unavailable', 'UnknownError'),
      onupgradeneeded: null as ((e: IDBVersionChangeEvent) => void) | null,
      onsuccess: null as ((e: Event) => void) | null,
      onerror: null as ((e: Event) => void) | null,
    };
    // Fire onerror asynchronously so the Promise rejection is handled
    Promise.resolve().then(() => {
      if (req.onerror) req.onerror(new Event('error'));
    });
    return req;
  };
  Object.defineProperty(window, 'indexedDB', {
    configurable: true,
    writable: true,
    value: { open: fakeOpen },
  });
}

beforeEach(() => {
  // Clear localStorage before every test
  localStorage.removeItem(LS_KEY);
  localStorage.removeItem(FAILED_KEY);
  ui.failedSync = [];
  ui.offlineMode = false;
  makeIDBUnavailable();
  vi.clearAllMocks();
});

afterEach(() => {
  localStorage.removeItem(LS_KEY);
  localStorage.removeItem(FAILED_KEY);
});

/** In-memory IndexedDB with just the calls useOfflineQueue makes. Returns the rows. */
function installFakeIDB(): Map<number, Record<string, unknown>> {
  const rows = new Map<number, Record<string, unknown>>();
  let nextId = 1;
  const copy = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
  const request = <T>(run: () => T) => {
    const req: { result?: T; error?: unknown; onsuccess?: () => void; onerror?: () => void } = {};
    queueMicrotask(() => {
      try {
        req.result = run();
        req.onsuccess?.();
      } catch (e) {
        req.error = e;
        req.onerror?.();
      }
    });
    return req;
  };
  const store = {
    getAll: () => request(() => [...rows.values()].map(copy)),
    get: (id: number) => request(() => copy(rows.get(id))),
    add: (v: Record<string, unknown>) =>
      request(() => {
        const id = nextId++;
        rows.set(id, { ...copy(v), id });
        return id;
      }),
    put: (v: Record<string, unknown>) =>
      request(() => {
        rows.set(v.id as number, copy(v));
        return v.id;
      }),
    delete: (id: number) => request(() => void rows.delete(id)),
    clear: () => request(() => rows.clear()),
    index: () => ({ count: () => request(() => [...rows.values()].filter((r) => r.status === 'pending').length) }),
  };
  const db = {
    objectStoreNames: { contains: () => true },
    transaction: () => ({ objectStore: () => store, abort: () => {} }),
  };
  Object.defineProperty(window, 'indexedDB', {
    configurable: true,
    writable: true,
    value: {
      open: () => {
        const req: { result: unknown; onsuccess?: () => void } = { result: db };
        queueMicrotask(() => req.onsuccess?.());
        return req;
      },
    },
  });
  return rows;
}

describe('useOfflineQueue — localStorage fallback', () => {
  it('queues a mutation in localStorage when IDB is unavailable', async () => {
    const { result } = renderHook(() => useOfflineQueue());

    await act(async () => {
      await result.current.queueMutation({
        clientId: 'test-client-1',
        type: 'api',
        url: '/api/crews/abc/polls',
        method: 'POST',
        body: { question: 'Pizza?' },
      });
    });

    const queue = JSON.parse(localStorage.getItem(LS_KEY) || '[]');
    expect(queue).toHaveLength(1);
    expect(queue[0].clientId).toBe('test-client-1');
    expect(queue[0].status).toBe('pending');
  });

  it('removes a successfully replayed entry from localStorage (no re-send)', async () => {
    const { result } = renderHook(() => useOfflineQueue());

    // Enqueue
    await act(async () => {
      await result.current.queueMutation({
        clientId: 'test-client-success',
        type: 'api',
        url: '/api/crews/abc/members',
        method: 'POST',
        body: { userId: 'u1' },
      });
    });

    expect(JSON.parse(localStorage.getItem(LS_KEY) || '[]')).toHaveLength(1);

    // Drain with a succeeding apiFn
    const apiFn = vi.fn().mockResolvedValue({ ok: true });
    await act(async () => {
      await result.current.processQueue(apiFn);
    });

    // apiFn must have been called exactly once
    expect(apiFn).toHaveBeenCalledTimes(1);
    expect(apiFn).toHaveBeenCalledWith('/api/crews/abc/members', {
      method: 'POST',
      body: { userId: 'u1' },
      idempotencyKey: 'test-client-success',
    });

    // Entry must be gone — not re-queued for the next drain
    const queueAfter = JSON.parse(localStorage.getItem(LS_KEY) || '[]');
    expect(queueAfter).toHaveLength(0);
  });

  it('calls onSent after a successful replay, and a throwing hook does not undo it', async () => {
    const { result } = renderHook(() => useOfflineQueue());
    await act(async () => {
      await result.current.queueMutation({
        clientId: 'test-client-onsent',
        type: 'api',
        url: '/crews/abc/polls',
        method: 'POST',
        body: { question: 'Pizza?' },
      });
    });
    const onSent = vi.fn(() => {
      throw new Error('hook boom');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await act(async () => {
      await result.current.processQueue(vi.fn().mockResolvedValue({ ok: true }), undefined, onSent);
    });
    warn.mockRestore();
    expect(onSent).toHaveBeenCalledWith({ url: '/crews/abc/polls', method: 'POST' });
    expect(JSON.parse(localStorage.getItem(LS_KEY) || '[]')).toHaveLength(0);
  });

  it('draining twice does NOT re-send a successfully replayed entry', async () => {
    const { result } = renderHook(() => useOfflineQueue());

    await act(async () => {
      await result.current.queueMutation({
        clientId: 'test-client-no-dup',
        type: 'api',
        url: '/api/crews/abc/expenses',
        method: 'POST',
        body: { amount: 50 },
      });
    });

    const apiFn = vi.fn().mockResolvedValue({ ok: true });

    // First drain — should replay and remove
    await act(async () => {
      await result.current.processQueue(apiFn);
    });
    expect(apiFn).toHaveBeenCalledTimes(1);

    // Second drain — queue is empty, apiFn must NOT be called again
    await act(async () => {
      await result.current.processQueue(apiFn);
    });
    expect(apiFn).toHaveBeenCalledTimes(1); // still 1, not 2
  });

  it('removes a permanently-failed entry from localStorage (no infinite retry)', async () => {
    const { result } = renderHook(() => useOfflineQueue());

    await act(async () => {
      await result.current.queueMutation({
        clientId: 'test-client-perm-fail',
        type: 'api',
        url: '/api/crews/abc/polls',
        method: 'POST',
        body: { question: 'Tacos?' },
      });
    });

    // Simulate a 409 Conflict — permanent failure, no retry
    const conflictErr = Object.assign(new Error('Conflict'), { status: 409 });
    const apiFn = vi.fn().mockRejectedValue(conflictErr);

    await act(async () => {
      await result.current.processQueue(apiFn);
    });

    // Entry must be removed even though it failed permanently
    const queueAfter = JSON.parse(localStorage.getItem(LS_KEY) || '[]');
    expect(queueAfter).toHaveLength(0);
  });

  it('upserts by clientId — repeated queues of the same clientId collapse to one entry', async () => {
    const { result } = renderHook(() => useOfflineQueue());

    await act(async () => {
      await result.current.queueMutation({
        clientId: 'stable-pick-id',
        type: 'api',
        url: '/api/picks',
        method: 'POST',
        body: { priority: 'must' },
      });
      await result.current.queueMutation({
        clientId: 'stable-pick-id',
        type: 'api',
        url: '/api/picks',
        method: 'POST',
        body: { priority: 'want-to-see' },
      });
    });

    const queue = JSON.parse(localStorage.getItem(LS_KEY) || '[]');
    expect(queue).toHaveLength(1);
    // Latest body wins
    expect(queue[0].body?.priority).toBe('want-to-see');
  });
  it('a network error keeps the entry with the same clientId, retries and createdAt, flips offline and stops the pass', async () => {
    const { result } = renderHook(() => useOfflineQueue());
    await act(async () => {
      await result.current.queueMutation({ clientId: 'net-1', type: 'api', url: '/crews/abc/expenses', method: 'POST', body: { amount: 5 } });
      await result.current.queueMutation({ clientId: 'net-2', type: 'api', url: '/crews/abc/polls', method: 'POST', body: { question: 'x' } });
    });
    const before = JSON.parse(localStorage.getItem(LS_KEY) || '[]');

    const apiFn = vi.fn().mockRejectedValue(networkError());
    await act(async () => {
      await result.current.processQueue(apiFn);
    });

    expect(apiFn).toHaveBeenCalledTimes(1);
    expect(apiFn).toHaveBeenCalledWith('/crews/abc/expenses', expect.objectContaining({ idempotencyKey: 'net-1' }));
    expect(JSON.parse(localStorage.getItem(LS_KEY) || '[]')).toEqual(before);
    expect(ui.offlineMode).toBe(true);
    expect(ui.failedSync).toEqual([]);
  });

  it('a 429 stays queued after Retry-After without consuming a retry or surfacing', async () => {
    const { result } = renderHook(() => useOfflineQueue());
    await act(async () => {
      await result.current.queueMutation({ clientId: 'rl-1', type: 'api', url: '/crews/abc/polls', method: 'POST', body: {} });
    });
    const apiFn = vi.fn().mockRejectedValue(Object.assign(new Error('Slow down'), { status: 429, retryAfter: '1' }));
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    try {
      for (let i = 0; i < MAX_RETRIES + 1; i++) {
        await act(async () => {
          const pass = result.current.processQueue(apiFn);
          await vi.runAllTimersAsync();
          await pass;
        });
      }
    } finally {
      vi.useRealTimers();
    }
    expect(JSON.parse(localStorage.getItem(LS_KEY) || '[]')[0]).toMatchObject({ clientId: 'rl-1', retries: 0 });
    expect(ui.failedSync).toEqual([]);
  });

  it('a 5xx still retries with backoff and surfaces after MAX_RETRIES', async () => {
    const { result } = renderHook(() => useOfflineQueue());
    await act(async () => {
      await result.current.queueMutation({ clientId: 'srv-1', type: 'api', url: '/crews/abc/polls', method: 'POST', body: {} });
    });
    const apiFn = vi.fn().mockRejectedValue(Object.assign(new Error('Server error'), { status: 503 }));
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    try {
      for (let i = 1; i < MAX_RETRIES; i++) {
        await act(async () => {
          const pass = result.current.processQueue(apiFn);
          await vi.runAllTimersAsync();
          await pass;
        });
        expect(JSON.parse(localStorage.getItem(LS_KEY) || '[]')[0]).toMatchObject({ clientId: 'srv-1', retries: i });
      }
      await act(async () => {
        await result.current.processQueue(apiFn);
      });
    } finally {
      vi.useRealTimers();
    }
    expect(apiFn).toHaveBeenCalledTimes(MAX_RETRIES);
    expect(JSON.parse(localStorage.getItem(LS_KEY) || '[]')).toHaveLength(0);
    expect(ui.failedSync).toEqual([expect.objectContaining({ clientId: 'srv-1', error: 'Server error' })]);
  });

  it('a surfaced failure is in storage and comes back after hydrate', async () => {
    const { result } = renderHook(() => useOfflineQueue());
    await act(async () => {
      await result.current.queueMutation({ clientId: 'bad-1', type: 'api', url: '/crews/abc/polls', method: 'POST', body: {} });
    });
    await act(async () => {
      await result.current.processQueue(vi.fn().mockRejectedValue(Object.assign(new Error('Bad request'), { status: 400 })));
    });
    expect(ui.failedSync).toEqual([expect.objectContaining({ clientId: 'bad-1' })]);
    await vi.waitFor(() =>
      expect(JSON.parse(localStorage.getItem(FAILED_KEY) || '[]')).toEqual([expect.objectContaining({ clientId: 'bad-1' })]),
    );

    // A reload empties the in-memory store; mounting the queue hydrates it again.
    ui.dismissFailedSync('bad-1');
    expect(ui.failedSync).toEqual([]);
    renderHook(() => useOfflineQueue());
    await vi.waitFor(() => expect(ui.failedSync).toEqual([expect.objectContaining({ clientId: 'bad-1', error: 'Bad request' })]));
  });

  it('after a POST replay returns { id: real-1 }, a queued child URL that contains the parent clientId is sent with real-1', async () => {
    const { result } = renderHook(() => useOfflineQueue());
    await act(async () => {
      await result.current.queueMutation({ clientId: 'tmp-poll-1', type: 'api', url: '/crews/abc/polls', method: 'POST', body: {} });
      await result.current.queueMutation({ clientId: 'vote-1', type: 'api', url: '/crews/abc/polls/tmp-poll-1/vote', method: 'POST', body: {} });
    });
    // The child then hits a dead network, so it stays queued and its stored URL is checkable.
    const apiFn = vi.fn().mockResolvedValueOnce({ id: 'real-1' }).mockRejectedValueOnce(networkError());
    await act(async () => {
      await result.current.processQueue(apiFn);
    });
    expect(apiFn).toHaveBeenNthCalledWith(2, '/crews/abc/polls/real-1/vote', expect.objectContaining({ idempotencyKey: 'vote-1' }));
    expect(JSON.parse(localStorage.getItem(LS_KEY) || '[]')).toEqual([
      expect.objectContaining({ clientId: 'vote-1', url: '/crews/abc/polls/real-1/vote' }),
    ]);
  });
});

describe('useOfflineQueue — IndexedDB path', () => {
  it('after a POST replay returns { id: real-1 }, a queued child URL that contains the parent clientId is sent with real-1', async () => {
    const rows = installFakeIDB();
    // Fresh module: the IDB handle is cached at module level.
    vi.resetModules();
    const { useOfflineQueue: useQueue } = await import('./useOfflineQueue');
    const { result } = renderHook(() => useQueue());
    await act(async () => {
      await result.current.queueMutation({ clientId: 'tmp-poll-1', type: 'api', url: '/crews/abc/polls', method: 'POST', body: {} });
      await result.current.queueMutation({ clientId: 'vote-1', type: 'api', url: '/crews/abc/polls/tmp-poll-1/vote', method: 'POST', body: {} });
    });
    expect(rows.size).toBe(2);
    expect(localStorage.getItem(LS_KEY)).toBeNull();

    const apiFn = vi.fn().mockResolvedValueOnce({ id: 'real-1' }).mockRejectedValueOnce(networkError());
    await act(async () => {
      await result.current.processQueue(apiFn);
    });
    expect(apiFn).toHaveBeenNthCalledWith(2, '/crews/abc/polls/real-1/vote', expect.objectContaining({ idempotencyKey: 'vote-1' }));
    expect([...rows.values()]).toEqual([expect.objectContaining({ clientId: 'vote-1', url: '/crews/abc/polls/real-1/vote' })]);
  });
});
