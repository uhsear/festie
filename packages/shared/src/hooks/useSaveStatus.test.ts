import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useSaveStatus } from './useSaveStatus';
import { useFestivalDataStore } from '../stores/festivalDataStore';
import { useUIStore } from '../stores/uiStore';

vi.mock('../services/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

describe('useSaveStatus', () => {
  beforeEach(() => {
    useUIStore.setState({ offlineMode: false, pendingSync: 0, failedSync: [] });
    useFestivalDataStore.setState({ pickSync: {}, savesInFlight: 0, lastSavedAt: null });
  });

  it('renders nothing before any write', () => {
    const { result } = renderHook(() => useSaveStatus());
    expect(result.current).toBeNull();
  });

  it('counts only failed pick entries', () => {
    useFestivalDataStore.setState({ pickSync: { a: { state: 'queued', priority: 'must' } }, lastSavedAt: 1 });
    const { result, rerender } = renderHook(() => useSaveStatus());
    expect(result.current?.kind).toBe('saved');

    useFestivalDataStore.setState({ pickSync: { a: { state: 'failed', priority: 'must' } } });
    rerender();
    expect(result.current).toEqual({ kind: 'failed', label: 'Not saved' });
  });

  it('reads offline and pending sync from the UI store', () => {
    useUIStore.setState({ offlineMode: true, pendingSync: 1 });
    const { result } = renderHook(() => useSaveStatus());
    expect(result.current).toEqual({ kind: 'offline', label: 'Offline, will sync' });
  });
});
