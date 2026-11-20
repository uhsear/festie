// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import { z } from 'zod';
import { festivalCreateSchema } from './festival';
import { identifier } from './primitives';

// ── Organizations (routes/organizations.ts, admin only) ─────────────
const orgRole = z.enum(['owner', 'editor', 'viewer']);

export const organizationCreateSchema = z.object({
  name: z.string().trim().min(2).max(80),
  kind: z.enum(['venue', 'promoter', 'other']).default('other'),
  website: z.string().url().max(2048).startsWith('https://', 'Website must be https').nullable().optional(),
});

export const organizationListQuery = z.object({
  status: z.enum(['pending', 'active', 'suspended']).optional(),
  ownerless: z.enum(['true', 'false']).optional(),
});

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

export const organizationIdParams = z.object({ id: identifier });
export const organizationMemberParams = z.object({ id: identifier, userId: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/, 'Invalid user ID') });
export const organizationPendingParams = z.object({ id: identifier, email: z.string().trim().toLowerCase().email().max(254) });

// ── Organizer festival create (routes/manage.ts) ────────────────────
// The client never picks the id: it is dropped here and the server generates one.
export const organizerFestivalCreateSchema = festivalCreateSchema.omit({ id: true }).extend({ organizationId: identifier });
