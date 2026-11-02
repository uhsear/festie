import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchAdminUsers, type AdminUserRow } from '../services/admin';

const SEARCH_DEBOUNCE_MS = 300;

export function useAdminUserList({ enabled = true, pageSize = 50 }: { enabled?: boolean; pageSize?: number } = {}) {
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [reloadTick, setReloadTick] = useState(0);
  const requestId = useRef(0);
  const firstLoad = useRef(true);

  useEffect(() => {
    if (!enabled) return;
    // Skip the debounce for the first load and for refresh(); only typing waits.
    const delay = firstLoad.current ? 0 : SEARCH_DEBOUNCE_MS;
    const timer = setTimeout(() => {
      firstLoad.current = false;
      const id = ++requestId.current;
      setLoading(true);
      // A new page 1 supersedes any Load more in flight.
      setLoadingMore(false);
      setError(null);
      fetchAdminUsers({ search, limit: pageSize })
        .then((page) => {
          if (id !== requestId.current) return;
          setUsers(page.users);
          setTotal(page.total);
          setNextCursor(page.nextCursor);
        })
        .catch((err: unknown) => {
          if (id !== requestId.current) return;
          setError(err instanceof Error ? err.message : 'Failed to load users');
        })
        .finally(() => {
          if (id === requestId.current) setLoading(false);
        });
    }, delay);
    return () => clearTimeout(timer);
  }, [enabled, search, pageSize, reloadTick]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore || loading) return;
    const id = ++requestId.current;
    setLoadingMore(true);
    try {
      const page = await fetchAdminUsers({ search, cursor: nextCursor, limit: pageSize });
      if (id !== requestId.current) return;
      setUsers((prev) => [...prev, ...page.users]);
      setTotal(page.total);
      setNextCursor(page.nextCursor);
    } catch (err) {
      if (id === requestId.current) setError(err instanceof Error ? err.message : 'Failed to load users');
    } finally {
      setLoadingMore(false);
    }
  }, [nextCursor, loadingMore, loading, search, pageSize]);

  const refresh = useCallback(() => {
    firstLoad.current = true;
    setReloadTick((t) => t + 1);
  }, []);

  const patchUser = useCallback((userId: string, partial: Partial<AdminUserRow>) => {
    setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, ...partial } : u)));
  }, []);

  const removeUser = useCallback((userId: string) => {
    setUsers((prev) => prev.filter((u) => u.id !== userId));
    setTotal((t) => Math.max(0, t - 1));
  }, []);

  return {
    users,
    total,
    hasMore: nextCursor !== null,
    loading,
    loadingMore,
    error,
    search,
    setSearch,
    loadMore,
    refresh,
    patchUser,
    removeUser,
  };
}
