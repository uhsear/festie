import { useQuery } from '@tanstack/react-query';
import { fetchAdminFestivals } from '@festie/shared/services/festivalAdmin';
import { fetchAdminCrews } from '@festie/shared/services/admin';

export const adminKeys = {
  dashboard: ['admin', 'dashboard'] as const,
  festivals: ['admin', 'festivals'] as const,
  festival: (id: string) => ['admin', 'festival', id] as const,
  crews: ['admin', 'crews'] as const,
  audit: (filters: unknown, cursor: unknown) => ['admin', 'audit', filters, cursor] as const,
  analytics: (festivalId?: string | null) => ['admin', 'analytics', festivalId ?? 'all'] as const,
  pickInsight: (festivalId: string) => ['admin', 'pick-insight', festivalId] as const,
};

/** Admin reads stay fresh for a minute and are never retried or persisted. */
export const ADMIN_QUERY_OPTIONS = { staleTime: 60_000, retry: false } as const;

export function useAdminFestivals() {
  return useQuery({ queryKey: adminKeys.festivals, queryFn: fetchAdminFestivals, ...ADMIN_QUERY_OPTIONS });
}

export function useAdminCrews(enabled = true) {
  return useQuery({ queryKey: adminKeys.crews, queryFn: fetchAdminCrews, enabled, ...ADMIN_QUERY_OPTIONS });
}
