import { api } from './api';
import { buildLineupCsv } from '../utils/lineupImport';
import type {
  DaysAnnouncementCount,
  LineupAnnouncementCount,
  LineupExportFestival,
  LineupImportCommitResult,
  LineupImportHistoryItem,
  LineupImportPlan,
  LineupImportRequest,
  LineupImportUndoResult,
} from '../utils/lineupImport';

import type { FestivalScope } from './festivalAdmin';

const base = (festivalId: string, scope: FestivalScope = 'admin') => `/${scope}/festivals/${encodeURIComponent(festivalId)}`;

export type LineupImportCommitResponse =
  | { committed: false; plan: LineupImportPlan }
  | { committed: true; result: LineupImportCommitResult; plan: LineupImportPlan };

export const lineupImportApi = {
  preview: (festivalId: string, body: LineupImportRequest, scope?: FestivalScope) =>
    api.post<LineupImportPlan>(`${base(festivalId, scope)}/import-lineup/preview`, body),
  // A 500-row import with Spotify search can outlast the 15 s default.
  commit: (festivalId: string, body: LineupImportRequest, scope?: FestivalScope) =>
    api.post<LineupImportCommitResponse>(`${base(festivalId, scope)}/import-lineup`, body, { timeoutMs: 120_000 }),
  history: (festivalId: string, scope?: FestivalScope) =>
    api.get<{ festivalName: string; imports: LineupImportHistoryItem[] }>(`${base(festivalId, scope)}/imports`),
  undo: (festivalId: string, importId: string, scope?: FestivalScope) =>
    api.post<LineupImportUndoResult>(`${base(festivalId, scope)}/imports/${encodeURIComponent(importId)}/undo`),
  announcement: (festivalId: string, scope?: FestivalScope) =>
    api.get<LineupAnnouncementCount>(`${base(festivalId, scope)}/lineup-announcement`),
  announce: (festivalId: string, scope?: FestivalScope) =>
    api.post<{ queued: true; recipients: number }>(`${base(festivalId, scope)}/lineup-announcement`),
  daysAnnouncement: (festivalId: string) => api.get<DaysAnnouncementCount>(`${base(festivalId)}/days-announcement`),
  announceDays: (festivalId: string) =>
    api.post<{ queued: true; recipients: number; emailRecipients: number }>(`${base(festivalId)}/days-announcement`),
  /** The lineup as CSV (set_id, day, stage, artist, start, end) that imports again unchanged. Reads the admin path so drafts export too. */
  exportCsv: async (festivalId: string, scope?: FestivalScope) =>
    buildLineupCsv(await api.get<LineupExportFestival>(base(festivalId, scope))),
};
