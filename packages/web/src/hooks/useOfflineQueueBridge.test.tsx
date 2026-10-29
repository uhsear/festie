import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

type OnSent = (sent: { url: string; method: string }) => void;
const processQueue = vi.fn<(adapter: unknown, socket: unknown, onSent?: OnSent) => Promise<void>>();

vi.mock('./useOfflineQueue', () => ({
  useOfflineQueue: () => ({ queueMutation: vi.fn(), processQueue }),
}));
vi.mock('@festie/shared/services', () => ({ api: {} }));

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
