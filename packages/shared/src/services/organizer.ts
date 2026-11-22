import { api } from './api';
import { buildFestivalPageUrl } from '../utils/links';
import type { ChecklistItem } from '../utils/festivalAdmin';

// The organizer API behind /manage (routes/manage.ts). A member sees only the festivals of their own organizations.

export type OrgRole = 'owner' | 'editor' | 'viewer';
export type OrgStatus = 'pending' | 'active' | 'suspended';

export interface ManageOrganization {
  id: string;
  name: string;
  role: OrgRole;
  status: OrgStatus;
  verified: boolean;
}

export interface ManageMe {
  emailConfirmed: boolean;
  organizations: ManageOrganization[];
}

export interface ManageFestival {
  id: string;
  name: string;
  location: string;
  organizationId: string;
  slug: string | null;
  published: boolean;
  deleted: boolean;
  publishRequestedAt: string | null;
  publishReviewNote: string | null;
  updatedAt: string;
}

const festivalPath = (id: string) => `/manage/festivals/${encodeURIComponent(id)}`;

export const fetchManageMe = () => api.get<ManageMe>('/manage/me');

export const fetchManageFestivals = () => api.get<ManageFestival[]>('/manage/festivals');

export const createManageFestival = (body: unknown) =>
  api.post<{ id?: string; venueGuessed?: boolean }>('/manage/festivals', body);

export const submitForReview = (id: string) =>
  api.post<{ requestedAt: string; checklist: ChecklistItem[] }>(`${festivalPath(id)}/publish-request`);

export const withdrawReview = (id: string) => api.delete<{ withdrawn: true }>(`${festivalPath(id)}/publish-request`);

export type OrganizerFestivalState = 'draft' | 'review' | 'changes' | 'live';

export interface OrganizerFestivalStatus {
  state: OrganizerFestivalState;
  chip: string;
  /** The one-line status text of plan-v3 5.6. */
  text: string;
}

interface StatusInput {
  published?: boolean;
  publishedAt?: string | null;
  publishRequestedAt?: string | null;
  publishReviewNote?: string | null;
  slug?: string | null;
}

const shortDate = (iso: string) => {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? '' : new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

/** Draft, waiting for review, changes requested or live. A decline clears the request and keeps the note. */
export function organizerFestivalStatus(f: StatusInput, origin?: string): OrganizerFestivalStatus {
  if (f.published || f.publishedAt) {
    const link = f.slug ? buildFestivalPageUrl(f.slug, origin) : null;
    return { state: 'live', chip: 'Live', text: link ? `Live at ${link.replace(/^https?:\/\//, '')}.` : 'Live.' };
  }
  if (f.publishRequestedAt) {
    const sent = shortDate(f.publishRequestedAt);
    return { state: 'review', chip: 'Waiting for review', text: `Waiting for review.${sent ? ` Sent ${sent}.` : ''}` };
  }
  if (f.publishReviewNote) {
    return { state: 'changes', chip: 'Changes requested', text: `Festie asked for changes: ${f.publishReviewNote}` };
  }
  return { state: 'draft', chip: 'Draft', text: 'Only your team and Festie can see it.' };
}

/** The public link of a live festival, or null for a festival without a slug. */
export const organizerPublicLink = (slug: string | null | undefined, origin?: string) =>
  slug ? buildFestivalPageUrl(slug, origin) : null;

/** The message of a 409 FESTIVAL_CHANGED for a member: who saved first, and when (plan-v3 5.9). */
export function describeStaleSave(details: { updatedBy?: unknown; updatedAt?: unknown } | undefined): string {
  const name = typeof details?.updatedBy === 'string' && details.updatedBy ? details.updatedBy : 'Someone';
  const ms = typeof details?.updatedAt === 'string' ? Date.parse(details.updatedAt) : NaN;
  const at = Number.isNaN(ms) ? '' : ` at ${new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
  return `${name} saved this festival${at}. Your changes are still in the form. Reload, then make your change again.`;
}

/** Whether a member of this role may use the owner-only actions. */
export const isOrgOwner = (role: OrgRole | null | undefined) => role === 'owner';
/** Viewers read; editors and owners edit. */
export const canEditOrgFestival = (role: OrgRole | null | undefined) => role === 'owner' || role === 'editor';

// ── The organization: profile, team and storage (plan-v3 5.7, 6.6) ──────────────────────────────

export interface TeamMember {
  userId: string;
  /** The person's display name, or null when they set none. An owner also gets `email`. */
  name: string | null;
  email?: string;
  role: OrgRole;
  active: boolean;
  /** A teammate's display name, or "Festie support" for anyone outside the team. */
  addedBy: string;
  createdAt: string;
}

export interface TeamInvitation {
  email: string;
  role: OrgRole;
  addedBy: string;
  createdAt: string;
  /** An invitation lapses 90 days after it was added. An expired one cannot be claimed. */
  expiresAt: string;
  expired: boolean;
}

export interface ManageOrganizationDetail {
  id: string;
  name: string;
  displayName: string | null;
  contactEmail: string | null;
  website: string | null;
  kind: 'venue' | 'promoter' | 'other';
  status: OrgStatus;
  verified: boolean;
  role: OrgRole | 'admin';
  members: TeamMember[];
  /** Only an owner receives invitations. */
  pending: TeamInvitation[];
  upload: { usedBytes: number; capBytes: number };
}

export interface OrganizationProfilePatch {
  name?: string;
  displayName?: string | null;
  contactEmail?: string | null;
  website?: string | null;
}

const orgPath = (id: string) => `/manage/organizations/${encodeURIComponent(id)}`;

export const fetchManageOrganization = (id: string) => api.get<ManageOrganizationDetail>(orgPath(id));

export const updateManageOrganization = (id: string, patch: OrganizationProfilePatch) =>
  api.put<ManageOrganizationDetail>(orgPath(id), patch);

// A member change needs a recent password: run it through withReauth.
export const addManageMember = (id: string, body: { email: string; role: OrgRole }) =>
  api.post<{ kind: 'member' | 'pending'; role: OrgRole; emailed: boolean }>(`${orgPath(id)}/members`, body);

export const changeManageMemberRole = (id: string, userId: string, role: OrgRole) =>
  api.put<{ userId: string; from: OrgRole; role: OrgRole }>(`${orgPath(id)}/members/${encodeURIComponent(userId)}`, { role });

export const removeManageMember = (id: string, userId: string) =>
  api.delete<{ userId: string; role: OrgRole }>(`${orgPath(id)}/members/${encodeURIComponent(userId)}`);

export const removeManageInvitation = (id: string, email: string) =>
  api.delete<{ email: string }>(`${orgPath(id)}/pending-members/${encodeURIComponent(email)}`);

// ── Trust tier: activity and interest counts (plan-v3 phase 3) ──────────────────────────────────

export interface ManageActivityEntry {
  id: string;
  action: string;
  targetType: string;
  targetId: string;
  createdAt: string;
  /** A teammate's display name with the organization, or "Festie support". */
  actor: string;
  /** Present for a teammate's action only. */
  details: Record<string, unknown> | null;
}

export const fetchManageActivity = (id: string, cursor?: string | null) =>
  api.get<ManageActivityEntry[]>(`${orgPath(id)}/audit${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`);

export interface ManageEngagement {
  /** False while fewer than `minJoined` people joined the festival. */
  available: boolean;
  minJoined: number;
  minCount: number;
  /** Per set id; a count below `minCount` is null. */
  sets: Record<string, { picks: number | null; reminders: number | null }>;
}

export const fetchManageEngagement = (festivalId: string) => api.get<ManageEngagement>(`${festivalPath(festivalId)}/engagement`);

/** A count the server may hide: "fewer than 5" for null (owner decision 4). */
export const describeEngagementCount = (count: number | null, minCount = 5): string =>
  count === null ? `fewer than ${minCount}` : String(count);

/** The line above a verified organization's save when it would alert people: the count it must confirm. */
export const describeAlertConfirm = (people: number | undefined, runsLeft?: number): string => {
  const who = people === undefined ? 'a small group of people' : people === 1 ? '1 person' : `${people} people`;
  const cap = runsLeft === 0 ? ' This festival has used its alerts for this hour, so Festie will send them after a check.' : '';
  return `This save tells ${who} that a set they picked moved or was removed.${cap}`;
};

/** "12 MB of 200 MB used" for the Members screen. */
export function describeUpload(upload: { usedBytes: number; capBytes: number }): string {
  const mb = (bytes: number) => (bytes < 1024 * 1024 ? '0' : String(Math.round((bytes / (1024 * 1024)) * 10) / 10));
  return `${mb(upload.usedBytes)} MB of ${Math.round(upload.capBytes / (1024 * 1024))} MB used for site-plan images.`;
}

// ── Two editors at once (plan-v3 5.9) ───────────────────────────────────────────────────────────

/** The storage key of the edits a member had in the form when someone else saved first. */
export const editBackupKey = (festivalId: string) => `festie:manage-edits:${festivalId}`;

export interface EditBackup {
  savedAt: string;
  form: unknown;
}

type BackupStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Keeps the form across a reload. Storage that is full or blocked loses the backup and nothing else. */
export function saveEditBackup(storage: BackupStorage, festivalId: string, form: unknown, now: Date = new Date()): boolean {
  try {
    storage.setItem(editBackupKey(festivalId), JSON.stringify({ savedAt: now.toISOString(), form } satisfies EditBackup));
    return true;
  } catch {
    return false;
  }
}

export function loadEditBackup(storage: BackupStorage, festivalId: string): EditBackup | null {
  try {
    const raw = storage.getItem(editBackupKey(festivalId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<EditBackup>;
    return typeof parsed.savedAt === 'string' && parsed.form && typeof parsed.form === 'object' ? (parsed as EditBackup) : null;
  } catch {
    return null;
  }
}

export function clearEditBackup(storage: BackupStorage, festivalId: string): void {
  try {
    storage.removeItem(editBackupKey(festivalId));
  } catch {
    /* storage is blocked: there is nothing to clear */
  }
}
