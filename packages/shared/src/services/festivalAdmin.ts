import { api, ApiClientError } from './api';
import type { Festival } from '../types/domain';
import type { ChecklistItem, DeleteImpact, FestivalIssue } from '../utils/festivalAdmin';

export interface AdminFestivalSummary {
  id: string;
  name: string;
  location?: string;
  stageCount: number;
  dayCount: number;
  startDate: string;
  endDate: string;
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
};

const festivalPath = (id: string) => `/admin/festivals/${encodeURIComponent(id)}`;

export const fetchAdminFestivals = () => api.get<AdminFestivalSummary[]>('/admin/festivals');

export const fetchArchivedFestivals = () => api.get<ArchivedFestival[]>('/admin/festivals/archived');

export const fetchAdminFestival = (id: string) => api.get<AdminFestivalDetail>(festivalPath(id));

export const fetchDeleteImpact = (id: string) => api.get<DeleteImpact>(`${festivalPath(id)}/impact`);

export const publishFestival = (id: string) =>
  api.post<{ publishedAt: string; checklist: ChecklistItem[] }>(`${festivalPath(id)}/publish`);

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
