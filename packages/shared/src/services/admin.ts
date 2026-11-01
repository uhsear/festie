import { api, ApiClientError } from './api';

export interface AuditEntry {
  id: string;
  action: string;
  friendlyAction: string;
  actorType: string;
  actorId: string | null;
  actorUsername: string | null;
  targetType: string | null;
  targetId: string | null;
  targetLabel: string | null;
  details: Record<string, unknown> | null;
  status: string;
  createdAt: string;
}

export interface AuditPage {
  entries: AuditEntry[];
  nextCursor: string | null;
  total: number;
}

export interface AuditPageParams {
  scope?: 'admin' | 'user' | 'all';
  action?: string;
  actor?: string;
  from?: string;
  to?: string;
  cursor?: string | null;
  limit?: number;
}

export async function fetchAuditPage(params: AuditPageParams = {}): Promise<AuditPage> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
  }
  const qs = query.toString();
  const { data, meta } = await api.getEnvelope<AuditEntry[]>(`/admin/audit${qs ? `?${qs}` : ''}`);
  return {
    entries: Array.isArray(data) ? data : [],
    nextCursor: typeof meta.nextCursor === 'string' ? meta.nextCursor : null,
    total: typeof meta.total === 'number' ? meta.total : 0,
  };
}

export type LineupRowStatus = 'new' | 'update' | 'unchanged' | 'skipped' | 'error';

export interface LineupImportCounts {
  new: number;
  update: number;
  unchanged: number;
  error: number;
}

export interface LineupImportResult {
  dryRun: boolean;
  counts: LineupImportCounts;
  rows: Array<{
    line: number;
    artist: string;
    stageName: string | null;
    dayLabel: string | null;
    startTime: string | null;
    endTime: string | null;
    status: LineupRowStatus;
    message?: string;
  }>;
  missing: Array<{ id: string; artist: string; dayLabel: string }>;
  errors: string[];
  warnings: string[];
  imported: number;
  updated: number;
  spotifyMatched: number;
}

// Preview with the same updateExisting the commit will use, so 'update' counts match the commit.
export function previewLineupImport(
  festivalId: string,
  text: string,
  { updateExisting = false }: { updateExisting?: boolean } = {},
): Promise<LineupImportResult> {
  return api.post<LineupImportResult>(`/admin/festivals/${encodeURIComponent(festivalId)}/import-lineup`, {
    text,
    format: 'auto',
    dryRun: true,
    updateExisting,
  });
}

export function commitLineupImport(
  festivalId: string,
  text: string,
  { updateExisting }: { updateExisting: boolean },
): Promise<LineupImportResult> {
  return api.post<LineupImportResult>(`/admin/festivals/${encodeURIComponent(festivalId)}/import-lineup`, {
    text,
    format: 'auto',
    updateExisting,
  });
}

export const REAUTH_COPY = {
  title: "Confirm it's you",
  body: "Enter your password to continue. You won't be asked again for 15 minutes.",
  label: 'Password',
  button: 'Confirm',
} as const;

/**
 * Runs `run`. If the server asks for a recent password check, prompts once,
 * posts it to /auth/reauth and runs `run` again. `null` means the admin cancelled.
 */
export async function withReauth<T>(
  run: () => Promise<T>,
  askPassword: () => Promise<string | null>,
): Promise<T | null> {
  try {
    return await run();
  } catch (err) {
    if (!(err instanceof ApiClientError) || err.code !== 'REAUTH_REQUIRED') throw err;
  }
  const password = await askPassword();
  if (password === null) return null;
  await api.post('/auth/reauth', { password });
  return run();
}

export interface RemovalSummary {
  days: number;
  sets: number;
  picks: number;
  ratings: number;
}

export function removalFromError(err: unknown): RemovalSummary | null {
  if (!(err instanceof ApiClientError) || err.code !== 'CONFIRM_REMOVALS') return null;
  const r = err.details?.removal as Partial<RemovalSummary> | undefined;
  if (!r || typeof r !== 'object') return null;
  return { days: r.days ?? 0, sets: r.sets ?? 0, picks: r.picks ?? 0, ratings: r.ratings ?? 0 };
}

function joinList(parts: string[]): string {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

const plural = (n: number, one: string): string => `${n} ${n === 1 ? one : `${one}s`}`;

export function describeRemovals(r: RemovalSummary): string {
  const parts = [
    r.days > 0 && plural(r.days, 'day'),
    r.sets > 0 && plural(r.sets, 'set'),
    r.picks > 0 && plural(r.picks, 'pick'),
    r.ratings > 0 && plural(r.ratings, 'rating'),
  ].filter((p): p is string => typeof p === 'string');
  return `This save removes ${joinList(parts)}. People who picked these sets lose those picks. This cannot be undone.`;
}

export function formatImportCounts(counts: LineupImportCounts): string {
  const parts = [
    counts.new > 0 && `${counts.new} new`,
    counts.update > 0 && `${counts.update} will change`,
    counts.unchanged > 0 && `${counts.unchanged} unchanged`,
    counts.error > 0 && `${counts.error} need fixing`,
  ].filter((p): p is string => typeof p === 'string');
  return parts.length ? parts.join(' · ') : '0 new';
}
