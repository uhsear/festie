import { api } from './api';
import type { ManageFestival, OrgRole, OrgStatus } from './organizer';

// The admin side of organizations (routes/organizations.ts): create, members, verify, suspend, the review queue
// and the attendee alerts that an organizer's save held.

export type OrgKind = 'venue' | 'promoter' | 'other';

export interface AdminOrganization {
  id: string;
  name: string;
  kind: OrgKind;
  website: string | null;
  status: OrgStatus;
  verifiedAt: string | null;
  createdAt: string;
  memberCount?: number;
  pendingCount?: number;
  festivalCount?: number;
  ownerCount?: number;
}

export interface OrgMember {
  userId: string;
  username: string;
  email: string | null;
  active: boolean;
  role: OrgRole;
  addedBy: string | null;
  createdAt: string;
}

export interface OrgPendingMember {
  email: string;
  role: OrgRole;
  addedBy: string | null;
  createdAt: string;
}

/** What an organization used: the festivals it holds, this month's announcements and its stored images. */
export interface OrganizationUsage {
  festivals: number;
  drafts: number;
  announcementsThisMonth: number;
  uploadedBytes: number;
}

export interface AdminOrganizationDetail extends AdminOrganization {
  members: OrgMember[];
  pending: OrgPendingMember[];
  festivals: ManageFestival[];
  usage: OrganizationUsage;
}

export interface ReviewRequest {
  festivalId: string;
  name: string;
  organizationId: string | null;
  organizationName: string | null;
  verified: boolean | null;
  requestedAt: string;
}

export interface HeldAlertGroup {
  festivalId: string;
  name: string;
  organizationId: string | null;
  organizationName: string | null;
  /** Held schedule changes, and the people they would tell. */
  changes: number;
  people: number;
  updatedAt: string;
}

/** One change an organization member made to a live festival, for the admin's list of recent organizer edits. */
export interface RecentOrganizerEdit {
  id: string;
  createdAt: string;
  action: string;
  festivalId: string;
  name: string;
  organizationId: string | null;
  organizationName: string | null;
  details: Record<string, unknown> | null;
}

export interface ReviewQueue {
  requests: ReviewRequest[];
  held: HeldAlertGroup[];
  recentEdits: RecentOrganizerEdit[];
}

const enc = encodeURIComponent;
const orgPath = (id: string) => `/admin/organizations/${enc(id)}`;

export const fetchOrganizations = () => api.get<AdminOrganization[]>('/admin/organizations');

export const fetchOrganization = (id: string) => api.get<AdminOrganizationDetail>(orgPath(id));

export const createOrganization = (body: { name: string; kind: OrgKind; website?: string | null }) =>
  api.post<AdminOrganization>('/admin/organizations', body);

export const setOrganizationStatus = (id: string, status: 'active' | 'suspended', reason?: string) =>
  api.put<AdminOrganization>(`${orgPath(id)}/status`, reason ? { status, reason } : { status });

/** Moves a festival into the organization. Needs a recent password: run it through withReauth. */
export const transferFestival = (id: string, festivalId: string) =>
  api.post<{ festivalId: string; from: string | null; to: string }>(`${orgPath(id)}/festivals`, { festivalId });

/** Hands a festival of the organization back to the platform, so only admins can edit it again. */
export const handBackFestival = (id: string, festivalId: string) =>
  api.delete<{ festivalId: string; from: string; to: null }>(`${orgPath(id)}/festivals/${enc(festivalId)}`);

export const setOrganizationVerified = (id: string, verified: boolean) =>
  api.put<AdminOrganization>(`${orgPath(id)}/verified`, { verified });

// Member changes need a recent password: run them through withReauth.
export const addOrganizationMember = (id: string, body: { email: string; role: OrgRole }) =>
  api.post<{ kind: 'member' | 'pending' }>(`${orgPath(id)}/members`, body);

export const removeOrganizationMember = (id: string, userId: string) =>
  api.delete<unknown>(`${orgPath(id)}/members/${enc(userId)}`);

export const removePendingMember = (id: string, email: string) =>
  api.delete<unknown>(`${orgPath(id)}/pending-members/${enc(email)}`);

export const fetchReviewQueue = () => api.get<ReviewQueue>('/admin/organizations/review-queue');

export const releaseHeldAlerts = (festivalId: string) =>
  api.post<{ released: number; people: number }>(`/admin/organizations/held-alerts/${enc(festivalId)}/release`);

export const discardHeldAlerts = (festivalId: string) =>
  api.delete<{ discarded: number }>(`/admin/organizations/held-alerts/${enc(festivalId)}`);

export const declinePublishRequest = (festivalId: string, note: string) =>
  api.post<{ declined: true }>(`/admin/festivals/${enc(festivalId)}/publish/decline`, { note });
