import { useQuery } from '@tanstack/react-query';
import { fetchAdminFestivals } from '@festie/shared/services/festivalAdmin';
import { fetchAdminCrews } from '@festie/shared/services/admin';
import { fetchManageFestivals, fetchManageOrganization } from '@festie/shared/services/organizer';
import { fetchOrganizations, fetchOrganization, fetchReviewQueue } from '@festie/shared/services/adminOrganizations';
import { fetchArtistSuggestions } from '@festie/shared/services/adminArtistSuggestions';
import { fetchArtistReview } from '@festie/shared/services/adminArtistReview';

export const adminKeys = {
  dashboard: ['admin', 'dashboard'] as const,
  festivals: ['admin', 'festivals'] as const,
  festival: (id: string) => ['admin', 'festival', id] as const,
  manageFestivals: ['admin', 'manage-festivals'] as const,
  organizations: ['admin', 'organizations'] as const,
  manageOrganization: (id: string) => ['manage', 'organization', id] as const,
  organization: (id: string) => ['admin', 'organization', id] as const,
  reviewQueue: ['admin', 'review-queue'] as const,
  artistSuggestions: ['admin', 'artist-suggestions'] as const,
  artistReview: ['admin', 'artist-review'] as const,
  crews: ['admin', 'crews'] as const,
  audit: (filters: unknown, cursor: unknown) => ['admin', 'audit', filters, cursor] as const,
  analytics: (festivalId?: string | null) => ['admin', 'analytics', festivalId ?? 'all'] as const,
  growth: ['admin', 'growth'] as const,
  pickInsight: (festivalId: string) => ['admin', 'pick-insight', festivalId] as const,
};

/** Admin reads stay fresh for a minute and are never retried or persisted. */
export const ADMIN_QUERY_OPTIONS = { staleTime: 60_000, retry: false } as const;

export function useAdminFestivals(enabled = true) {
  return useQuery({ queryKey: adminKeys.festivals, queryFn: fetchAdminFestivals, enabled, ...ADMIN_QUERY_OPTIONS });
}

/** The festivals of the signed-in organizer's organizations (GET /manage/festivals). */
export function useManageFestivals(enabled = true) {
  return useQuery({ queryKey: adminKeys.manageFestivals, queryFn: fetchManageFestivals, enabled, ...ADMIN_QUERY_OPTIONS });
}

/** One organization as its own member sees it: profile, team and storage (GET /manage/organizations/:id). */
export function useManageOrganization(id: string | null) {
  return useQuery({
    queryKey: adminKeys.manageOrganization(id ?? ''),
    queryFn: () => fetchManageOrganization(id!),
    enabled: !!id,
    ...ADMIN_QUERY_OPTIONS,
  });
}

export function useOrganizations() {
  return useQuery({ queryKey: adminKeys.organizations, queryFn: fetchOrganizations, ...ADMIN_QUERY_OPTIONS });
}

export function useOrganization(id: string | null) {
  return useQuery({
    queryKey: adminKeys.organization(id ?? ''),
    queryFn: () => fetchOrganization(id!),
    enabled: !!id,
    ...ADMIN_QUERY_OPTIONS,
  });
}

export function useReviewQueue(enabled = true) {
  return useQuery({ queryKey: adminKeys.reviewQueue, queryFn: fetchReviewQueue, enabled, ...ADMIN_QUERY_OPTIONS });
}

/** The pending organizer suggestions for artists (GET /admin/artists/suggestions). */
export function useArtistSuggestions() {
  return useQuery({ queryKey: adminKeys.artistSuggestions, queryFn: () => fetchArtistSuggestions('pending'), ...ADMIN_QUERY_OPTIONS });
}

/** One page of the pending artist review queue (GET /admin/artists/review). */
export function useArtistReview(offset: number, limit: number) {
  return useQuery({
    queryKey: [...adminKeys.artistReview, offset, limit] as const,
    queryFn: () => fetchArtistReview('pending', limit, offset),
    ...ADMIN_QUERY_OPTIONS,
  });
}

export function useAdminCrews(enabled = true) {
  return useQuery({ queryKey: adminKeys.crews, queryFn: fetchAdminCrews, enabled, ...ADMIN_QUERY_OPTIONS });
}
