import { api, ApiClientError } from './api';
import type { Festival } from '../types/domain';
import type { ChecklistItem, DeleteImpact, FestivalIssue } from '../utils/festivalAdmin';
import type { ScheduleNotice } from '../utils/notificationSettings';

export interface AdminFestivalSummary {
  id: string;
  name: string;
  location?: string;
  stageCount: number;
  dayCount: number;
  startDate: string;
  endDate: string;
  seriesId?: string | null;
  published: boolean;
  updatedAt: string;
}

export interface ArchivedFestival {
  id: string;
  name: string;
  location?: string;
  deletedAt: string;
  publishedAt: string | null;
}

// stages and days are loosely typed, as the editors treat them today.
export type AdminFestivalDetail = Festival & {
  stages: Record<string, unknown>[];
  days: Record<string, unknown>[];
  publishedAt: string | null;
  updatedByUsername: string | null;
  checklist: ChecklistItem[];
  /** Only a member's festival reads: the state of the review request (plan-v3 5.6). */
  publishRequestedAt?: string | null;
  publishReviewNote?: string | null;
};

/** `admin` is the platform admin API. `manage` is the organizer API, which forwards the same festival routes. */
export type FestivalScope = 'admin' | 'manage';

const festivalPath = (id: string, scope: FestivalScope = 'admin') => `/${scope}/festivals/${encodeURIComponent(id)}`;

export const fetchAdminFestivals = () => api.get<AdminFestivalSummary[]>('/admin/festivals');

export const fetchArchivedFestivals = () => api.get<ArchivedFestival[]>('/admin/festivals/archived');

export const fetchAdminFestival = (id: string, scope: FestivalScope = 'admin') =>
  api.get<AdminFestivalDetail>(festivalPath(id, scope));

export const fetchDeleteImpact = (id: string, scope: FestivalScope = 'admin') =>
  api.get<DeleteImpact>(`${festivalPath(id, scope)}/impact`);

export const publishFestival = (id: string, scope: FestivalScope = 'admin') =>
  api.post<{ publishedAt: string; checklist: ChecklistItem[] }>(`${festivalPath(id, scope)}/publish`);

export const restoreFestival = (id: string) =>
  api.post<{ id: string; published: boolean }>(`${festivalPath(id)}/restore`);

export const fetchAdminEnv = () => api.get<{ label: string | null }>('/admin/env');

export function issuesFromError(err: unknown): FestivalIssue[] {
  if (!(err instanceof ApiClientError)) return [];
  const issues = err.details?.issues;
  return Array.isArray(issues) ? (issues as FestivalIssue[]) : [];
}

export function checklistFromError(err: unknown): ChecklistItem[] | null {
  if (!(err instanceof ApiClientError) || err.code !== 'PUBLISH_BLOCKED') return null;
  const checklist = err.details?.checklist;
  return Array.isArray(checklist) ? (checklist as ChecklistItem[]) : null;
}

export interface FestivalSaveResult {
  scheduleNotice?: ScheduleNotice;
  venueGuessed?: boolean;
  /** True for a save sent with `dryRun`: nothing was written. */
  dryRun?: boolean;
  /** A verified organization's moved-set alert runs left this hour (dry run only). */
  runsLeft?: number;
}

export const updateAdminFestival = (id: string, body: unknown, scope: FestivalScope = 'admin') =>
  api.put<FestivalSaveResult | undefined>(festivalPath(id, scope), body);

export const createAdminFestival = (body: unknown) =>
  api.post<{ id?: string; venueGuessed?: boolean }>('/admin/festivals', body);

export const deleteAdminFestival = (id: string, scope: FestivalScope = 'admin') =>
  api.delete<void>(festivalPath(id, scope));
