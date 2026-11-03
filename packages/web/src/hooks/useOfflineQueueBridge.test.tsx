import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

type OnSent = (sent: { url: string; method: string }) => void;
const processQueue = vi.fn<(adapter: unknown, socket: unknown, onSent?: OnSent) => Promise<void>>();

vi.mock('./useOfflineQueue', () => ({
  useOfflineQueue: () => ({ queueMutation: vi.fn(), processQueue }),
}));
const api = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
}));
vi.mock('@festie/shared/services', () => ({ api }));

import { useOfflineQueueBridge, queryKeysForSentUrl } from './useOfflineQueueBridge';

describe('queryKeysForSentUrl', () => {
  it('maps crew expense writes to the expense lists of that crew', () => {
    expect(queryKeysForSentUrl('/crews/c1/expenses')).toEqual([
      ['expenses', 'c1'],
      ['expense-balances', 'c1'],
      ['settlement-plan', 'c1'],
    ]);
  });

  it('maps polls and meeting points, ignores everything else', () => {
    expect(queryKeysForSentUrl('/crews/c1/polls/p9/vote')).toEqual([['polls', 'c1']]);
    expect(queryKeysForSentUrl('/api/v1/crews/c1/meeting-points?x=1')).toEqual([['meeting-points', 'c1']]);
    expect(queryKeysForSentUrl('/profiles/p1/picks')).toEqual([]);
    expect(queryKeysForSentUrl('/crews/c1/sos')).toEqual([]);
  });
});

describe('useOfflineQueueBridge post-send invalidation', () => {
  beforeEach(() => {
    processQueue.mockReset().mockResolvedValue(undefined);
  });

  it('invalidates the affected crew lists when a queued write is sent', async () => {
    const queryClient = new QueryClient();
    const spy = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    renderHook(() => useOfflineQueueBridge(), { wrapper });

    await window.__festieQueue!.processQueue();
    const onSent = processQueue.mock.calls.at(-1)![2]!;
    onSent({ url: '/crews/c1/expenses', method: 'POST' });

    expect(spy).toHaveBeenCalledWith({ queryKey: ['expenses', 'c1'] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['expense-balances', 'c1'] });

    spy.mockClear();
    onSent({ url: '/profiles/p1/picks', method: 'PUT' });
    expect(spy).not.toHaveBeenCalled();
  });
});

type Adapter = (url: string, init: { method?: string; body?: unknown; idempotencyKey?: string }) => Promise<unknown>;

describe('useOfflineQueueBridge replay adapter', () => {
  beforeEach(() => {
    processQueue.mockReset().mockResolvedValue(undefined);
    for (const fn of Object.values(api)) fn.mockReset().mockResolvedValue({ id: 'real-1' });
  });

  async function getAdapter(): Promise<Adapter> {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
    );
    renderHook(() => useOfflineQueueBridge(), { wrapper });
    await window.__festieQueue!.processQueue();
    return processQueue.mock.calls.at(-1)![0] as Adapter;
  }

  const expected = { _bypassOfflineQueue: true, headers: { 'Idempotency-Key': 'k1' } };

  it('sends POST and PUT/PATCH with the bypass flag and the Idempotency-Key, and returns the api result', async () => {
    const adapter = await getAdapter();
    await expect(adapter('/crews/c1/expenses', { method: 'POST', body: { a: 1 }, idempotencyKey: 'k1' })).resolves.toEqual({
      id: 'real-1',
    });
    expect(api.post).toHaveBeenCalledWith('/crews/c1/expenses', { a: 1 }, expected);
    await adapter('/crews/c1/polls/p1', { method: 'put', body: { b: 2 }, idempotencyKey: 'k1' });
    expect(api.put).toHaveBeenCalledWith('/crews/c1/polls/p1', { b: 2 }, expected);
    await adapter('/crews/c1/polls/p1', { method: 'PATCH', body: { c: 3 }, idempotencyKey: 'k1' });
    expect(api.patch).toHaveBeenCalledWith('/crews/c1/polls/p1', { c: 3 }, expected);
  });

  it('sends DELETE with the bypass flag and the Idempotency-Key', async () => {
    const adapter = await getAdapter();
    await adapter('/crews/c1/meeting-points/m1', { method: 'DELETE', idempotencyKey: 'k1' });
    expect(api.delete).toHaveBeenCalledWith('/crews/c1/meeting-points/m1', expected);
  });

  it('still bypasses the offline queue when no key is given', async () => {
    const adapter = await getAdapter();
    await adapter('/crews/c1/expenses', { body: { a: 1 } });
    expect(api.post).toHaveBeenCalledWith('/crews/c1/expenses', { a: 1 }, { _bypassOfflineQueue: true });
  });
});
