import { api, ApiClientError } from './api';
import { buildFestivalPreview, type FestivalPreviewInput } from '../utils/admin';

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

export interface AdminUserRow {
  id: string;
  username: string;
  email: string | null;
  emailVerified: boolean;
  avatarUrl?: string | null;
  createdAt: string;
  profileCount: number;
  totalPicks: number;
  roles: string[];
}

export interface AdminUserDetail {
  user: {
    id: string;
    username: string;
    displayName: string | null;
    email: string | null;
    emailVerified: boolean;
    createdAt: string;
    lastActiveAt: string | null;
    roles: string[];
    publicSchedule: boolean;
  };
  festivals: Array<{
    festivalId: string;
    festivalName: string | null;
    profileName: string | null;
    picks: number;
    joinedAt: string;
  }>;
  crews: Array<{
    id: string;
    name: string;
    festivalId: string;
    festivalName: string | null;
    role: string;
    joinedAt: string;
    memberCount: number;
  }>;
  activity: AuditEntry[];
}

export interface AdminCrewRow {
  id: string;
  name: string;
  festivalId: string | null;
  createdBy: string | null;
  inviteCode: string | null;
  maxMembers: number;
  homeBaseLocation: string | null;
  homeBaseTime: string | null;
  createdAt: string;
  festivalName: string | null;
  creatorUsername: string | null;
  memberCount: number;
}

export interface AdminCrewMember {
  crewId: string;
  userId: string;
  role: 'owner' | 'member' | string;
  joinedAt: string;
  username: string;
  name: string | null;
}

export interface BulkResult {
  userId?: string;
  festivalId?: string;
  status: 'logged_out' | 'archived' | 'error';
  message?: string;
}

const enc = encodeURIComponent;

export async function fetchAdminUsers({
  search,
  cursor,
  limit,
}: { search?: string; cursor?: string | null; limit?: number } = {}): Promise<{
  users: AdminUserRow[];
  nextCursor: string | null;
  total: number;
}> {
  const query = new URLSearchParams();
  if (search) query.set('search', search);
  if (cursor) query.set('cursor', cursor);
  if (limit !== undefined) query.set('limit', String(limit));
  const qs = query.toString();
  const { data, meta } = await api.getEnvelope<AdminUserRow[]>(`/admin/users${qs ? `?${qs}` : ''}`);
  const pagination = (meta.pagination ?? {}) as { nextCursor?: unknown; total?: unknown };
  return {
    users: Array.isArray(data) ? data : [],
    nextCursor: typeof pagination.nextCursor === 'string' ? pagination.nextCursor : null,
    total: typeof pagination.total === 'number' ? pagination.total : 0,
  };
}

export function fetchAdminUserDetail(userId: string): Promise<AdminUserDetail> {
  return api.get<AdminUserDetail>(`/admin/users/${enc(userId)}`);
}

export function createResetLink(userId: string): Promise<{ resetUrl: string; username: string; expiresAt: string }> {
  return api.post(`/admin/users/${enc(userId)}/reset-link`);
}

export function setAdminRole(
  userId: string,
  grant: boolean,
): Promise<{ userId: string; username: string; roles: string[] }> {
  return grant
    ? api.post(`/admin/users/${enc(userId)}/roles`, { role: 'admin' })
    : api.delete(`/admin/users/${enc(userId)}/roles/admin`);
}

export function bulkForceLogout(userIds: string[]): Promise<{ results: BulkResult[] }> {
  return api.post('/admin/bulk/deactivate', { userIds });
}

export function bulkArchiveFestivals(festivalIds: string[]): Promise<{ results: BulkResult[] }> {
  return api.post('/admin/bulk/archive-festivals', { festivalIds });
}

export function fetchAdminCrews(): Promise<AdminCrewRow[]> {
  return api.get<AdminCrewRow[]>('/admin/crews');
}

export function fetchCrewMembers(crewId: string): Promise<AdminCrewMember[]> {
  return api.get<AdminCrewMember[]>(`/admin/crews/${enc(crewId)}/members`);
}

export function removeCrewMember(crewId: string, userId: string): Promise<unknown> {
  return api.delete(`/admin/crews/${enc(crewId)}/members/${enc(userId)}`);
}

export function addCrewMember(crewId: string, userId: string): Promise<unknown> {
  return api.post(`/crews/${enc(crewId)}/members`, { userId });
}

export async function fetchFestivalPreview(festivalId: string) {
  const detail = await api.get<FestivalPreviewInput>(`/festivals/${enc(festivalId)}`);
  return buildFestivalPreview(detail);
}
