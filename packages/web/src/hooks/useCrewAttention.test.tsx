import type React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore, useCrewStore, useUIStore } from '@festie/shared/stores';
import { useCrewAttention } from './useCrewAttention';

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(['polls', 'c1'], [{ id: 'p1', closed: false, votes: [] }]);
  client.setQueryData(['expense-balances', 'c1'], []);
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useCrewAttention(), { wrapper });
}

describe('useCrewAttention', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: { id: 'u1', username: 'a' } } as never);
    useCrewStore.setState({ activeCrew: { id: 'c1' } } as never);
    useUIStore.setState({ crewBadgeSeen: {} });
  });

  it('counts an unvoted open poll, then clears after markCrewBadgeSeen', async () => {
    const { result } = setup();
    expect(result.current.count).toBe(1);
    useUIStore.getState().markCrewBadgeSeen('c1', { pollIds: ['p1'] });
    await waitFor(() => expect(result.current.count).toBe(0));
  });

  it('shows no badge without an active crew', () => {
    useCrewStore.setState({ activeCrew: null } as never);
    const { result } = setup();
    expect(result.current).toEqual({ count: 0, dot: false, label: null });
  });
});
