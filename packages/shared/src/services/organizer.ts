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
