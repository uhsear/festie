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

  it('an empty first load sets seenAt to the epoch, so a later item is unread', async () => {
    mockApi.get.mockResolvedValueOnce([]);
    await useInboxStore.getState().load();
    expect(useInboxStore.getState().seenAt).toBe('1970-01-01T00:00:00.000Z');
    mockApi.get.mockResolvedValueOnce([item('a', '2026-01-01T00:00:00Z')]);
    await useInboxStore.getState().load();
    expect(selectInboxUnread(useInboxStore.getState())).toBe(1);
  });

  it('a second load during a running load waits for its items', async () => {
    let resolve!: (v: InboxItem[]) => void;
    mockApi.get.mockReturnValueOnce(new Promise<InboxItem[]>((r) => { resolve = r; }));
    const first = useInboxStore.getState().load();
    let secondDone = false;
    const second = useInboxStore.getState().load().then(() => { secondDone = true; });
    await Promise.resolve();
    expect(secondDone).toBe(false);
    resolve([item('a', '2026-01-01T00:00:00Z')]);
    await second;
    expect(useInboxStore.getState().items).toHaveLength(1);
    await first;
    expect(mockApi.get).toHaveBeenCalledTimes(1);
  });

  it('a failed load keeps the earlier items and loaded', async () => {
    mockApi.get.mockResolvedValueOnce([item('a', '2026-01-01T00:00:00Z')]);
    await useInboxStore.getState().load();
    mockApi.get.mockRejectedValueOnce(new Error('boom'));
    await useInboxStore.getState().load();
    const s = useInboxStore.getState();
    expect(s.items).toHaveLength(1);
    expect(s.loaded).toBe(true);
    expect(s.error).toBe('boom');
  });
});
