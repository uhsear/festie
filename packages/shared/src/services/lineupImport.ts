import { api } from './api';
import { buildLineupCsv } from '../utils/lineupImport';
import type {
  LineupExportFestival,
  LineupImportCommitResult,
  LineupImportHistoryItem,
  LineupImportPlan,
  LineupImportRequest,
  LineupImportUndoResult,
} from '../utils/lineupImport';

const base = (festivalId: string) => `/admin/festivals/${encodeURIComponent(festivalId)}`;

export type LineupImportCommitResponse =
  | { committed: false; plan: LineupImportPlan }
  | { committed: true; result: LineupImportCommitResult; plan: LineupImportPlan };

export const lineupImportApi = {
  preview: (festivalId: string, body: LineupImportRequest) =>
    api.post<LineupImportPlan>(`${base(festivalId)}/import-lineup/preview`, body),
  // A 500-row import with Spotify search can outlast the 15 s default.
  commit: (festivalId: string, body: LineupImportRequest) =>
    api.post<LineupImportCommitResponse>(`${base(festivalId)}/import-lineup`, body, { timeoutMs: 120_000 }),
  history: (festivalId: string) =>
    api.get<{ festivalName: string; imports: LineupImportHistoryItem[] }>(`${base(festivalId)}/imports`),
  undo: (festivalId: string, importId: string) =>
    api.post<LineupImportUndoResult>(`${base(festivalId)}/imports/${encodeURIComponent(importId)}/undo`),
  announcement: (festivalId: string) =>
    api.get<{ festivalName: string; recipients: number }>(`${base(festivalId)}/lineup-announcement`),
  announce: (festivalId: string) =>
    api.post<{ queued: true; recipients: number }>(`${base(festivalId)}/lineup-announcement`),
  /** The lineup as CSV (set_id, day, stage, artist, start, end) that imports again unchanged. Reads the admin path so drafts export too. */
  exportCsv: async (festivalId: string) =>
    buildLineupCsv(await api.get<LineupExportFestival>(base(festivalId))),
};
