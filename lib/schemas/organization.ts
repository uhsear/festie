// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import { z } from 'zod';
import { festivalCreateSchema } from './festival';
import { identifier } from './primitives';

// ── Organizations (routes/organizations.ts, admin only) ─────────────
const orgRole = z.enum(['owner', 'editor', 'viewer']);

// An organization name goes into mail to addresses that may have no account, so it must not carry a link or a line
// break: letters, digits, spaces and a few marks only, and no "word.word" that reads as a web address.
const SAFE_NAME_CHARACTERS = /^[\p{L}\p{M}\p{N} '’&,.()+!-]+$/u;
const LOOKS_LIKE_ADDRESS = /\p{L}\.\p{L}{2,}/u;
export const isSafeOrganizationName = (name: string) => SAFE_NAME_CHARACTERS.test(name) && !LOOKS_LIKE_ADDRESS.test(name);
const safeName = z
  .string()
  .trim()
  .min(2)
  .max(80)
  .refine(isSafeOrganizationName, 'Use letters, numbers and spaces. A web address, a line break and symbols such as / : @ are not allowed.');

export const organizationCreateSchema = z.object({
  name: safeName,
  kind: z.enum(['venue', 'promoter', 'other']).default('other'),
  website: z.string().url().max(2048).startsWith('https://', 'Website must be https').nullable().optional(),
});

export const organizationListQuery = z.object({
  status: z.enum(['pending', 'active', 'suspended']).optional(),
  ownerless: z.enum(['true', 'false']).optional(),
});

// An owner edits the profile of its own organization. A key that is absent stays as it is; null clears a field
// that may be empty. The kind and the status are Festie's to set.
export const organizationProfileSchema = z
  .object({
    name: safeName,
    displayName: safeName.nullable(),
    contactEmail: z.string().trim().toLowerCase().email().max(254).nullable(),
    website: z.string().url().max(2048).startsWith('https://', 'Website must be https').nullable(),
  })
  .partial()
  .strict()
  .refine((profile) => Object.keys(profile).length > 0, 'Change at least one field.');

// Only an admin moves an organization between active and suspended. A new organization starts pending.
export const organizationStatusSchema = z.object({ status: z.enum(['active', 'suspended']) });
export const organizationVerifiedSchema = z.object({ verified: z.boolean() });

export const organizationMemberAddSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  role: orgRole,
});
export const organizationMemberRoleSchema = z.object({ role: orgRole });

// An admin declines a publish request with a note the owners read, so it is required and bounded.
export const publishDeclineSchema = z.object({ note: z.string().trim().min(1).max(500) }).strict();
export const heldAlertParams = z.object({ festivalId: identifier });

// An owner reads the audit rows of its organization, newest first.
export const organizerAuditQuery = z.object({
  cursor: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const organizationIdParams = z.object({ id: identifier });
export const organizationMemberParams = z.object({ id: identifier, userId: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/, 'Invalid user ID') });
export const organizationPendingParams = z.object({ id: identifier, email: z.string().trim().toLowerCase().email().max(254) });

// ── Organizer festival create (routes/manage.ts) ────────────────────
// The client never picks the id: it is dropped here and the server generates one.
export const organizerFestivalCreateSchema = festivalCreateSchema.omit({ id: true }).extend({ organizationId: identifier });
