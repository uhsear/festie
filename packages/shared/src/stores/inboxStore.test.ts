import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../services/api', () => ({
  api: { get: vi.fn(), post: vi.fn() },
}));

import { api } from '../services/api';
import { useInboxStore, selectInboxUnread, type InboxItem } from './inboxStore';

const mockApi = api as unknown as { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };

const item = (id: string, createdAt: string): InboxItem => ({ id, type: 't', title: id, body: 'b', createdAt, data: {} });

describe('inboxStore', () => {
  beforeEach(() => {
    useInboxStore.setState({ items: [], seenAt: null, loaded: false, loading: false, error: null });
    mockApi.get.mockReset();
    mockApi.post.mockReset();
  });

  it('first load marks everything seen', async () => {
    mockApi.get.mockResolvedValue([item('b', '2026-01-02T00:00:00Z'), item('a', '2026-01-01T00:00:00Z')]);
    await useInboxStore.getState().load();
    const s = useInboxStore.getState();
    expect(mockApi.get).toHaveBeenCalledWith('/notifications/history?limit=50');
    expect(s.seenAt).toBe('2026-01-02T00:00:00Z');
    expect(selectInboxUnread(s)).toBe(0);
  });

  it('a later load with a newer item gives unread 1, and markAllSeen clears it', async () => {
    mockApi.get.mockResolvedValueOnce([item('a', '2026-01-01T00:00:00Z')]);
    await useInboxStore.getState().load();
    mockApi.get.mockResolvedValueOnce([item('b', '2026-01-03T00:00:00Z'), item('a', '2026-01-01T00:00:00Z')]);
    await useInboxStore.getState().load();
    expect(selectInboxUnread(useInboxStore.getState())).toBe(1);
    mockApi.post.mockResolvedValue({});
    await useInboxStore.getState().markAllSeen();
    expect(mockApi.post).toHaveBeenCalledWith('/notifications/read', {});
    expect(selectInboxUnread(useInboxStore.getState())).toBe(0);
  });

  it('a failed mark-read post still clears unread', async () => {
    useInboxStore.setState({ items: [item('b', '2026-01-03T00:00:00Z')], seenAt: '2026-01-01T00:00:00Z' });
    mockApi.post.mockRejectedValue(new Error('down'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await useInboxStore.getState().markAllSeen();
    expect(selectInboxUnread(useInboxStore.getState())).toBe(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('a failed load sets error and keeps items', async () => {
    useInboxStore.setState({ items: [item('a', '2026-01-01T00:00:00Z')] });
    mockApi.get.mockRejectedValue(new Error('boom'));
    await useInboxStore.getState().load();
    const s = useInboxStore.getState();
    expect(s.error).toBe('boom');
    expect(s.items).toHaveLength(1);
    expect(s.loading).toBe(false);
  });
});
