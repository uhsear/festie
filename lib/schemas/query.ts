// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import { z } from 'zod';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, MAX_PUBLIC_PAGE_SIZE } from '../pagination';
import { expenseAmount } from './expenses';

// ── Admin bulk schemas ──────────────────────────────────────────
export const adminBulkDeactivateSchema = z.object({
  userIds: z.array(z.string().min(1)).min(1),
});

export const adminBulkArchiveSchema = z.object({
  festivalIds: z.array(z.string().min(1)).min(1),
});

// ── Admin role schema ───────────────────────────────────────────
export const adminAddRoleSchema = z.object({
  role: z.string().min(1).max(50),
});

// ── Pagination query schema ────────────────────────────────────
export const paginationQuery = z.object({
  // Postgres rejects NUL in text parameters, which would surface as a 500.
  cursor: z.string().refine((v) => !v.includes('\u0000'), 'Invalid cursor').optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PUBLIC_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

// ── Admin audit query schema ──────────────────────────────────
const validDateString = z.string().refine((v) => !isNaN(new Date(v).getTime()), 'Must be a valid date string');
export const adminAuditQuery = z.object({
  actor_id: z.string().trim().max(100).optional(),
  // A comma list matches any item. A trailing `.*` on an item asks for a prefix match: `festival.*` matches `festival.created`.
  action: z
    .string()
    .trim()
    .max(200)
    .regex(/^[a-z0-9_.:-]+(\.\*)?(,[a-z0-9_.:-]+(\.\*)?){0,4}$/i)
    .optional(),
  resource_type: z.string().trim().max(100).optional(),
  cursor: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  from: validDateString.optional(),
  to: validDateString.optional(),
  scope: z.enum(['admin', 'user', 'all']).default('admin'),
  actor: z.string().trim().max(100).optional(),
  user: z.string().trim().max(100).optional(),
});

// ── Admin analytics query schema ──────────────────────────────
export const adminAnalyticsQuery = z.object({
  festivalId: z.string().trim().min(1).max(100).optional(),
});

// ── Admin sign-up ref counts query schema ─────────────────────
export const adminRefCountsQuery = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
});

// ── Admin user search query schema ────────────────────────────
export const adminUserSearchQuery = z.object({
  search: z.string().trim().max(200).optional(),
});

// ── Festival detail depth query schema ────────────────────────
export const festivalDepthQuery = z.object({
  depth: z.coerce.number().int().min(0).max(2).optional(),
});

// ── Festival delete query schema ──────────────────────────────
export const festivalDeleteQuery = z.object({
  hard: z.enum(['true', 'false']).optional(),
});

// ── Crew search query schema ──────────────────────────────────
export const crewUserSearchQuery = z.object({
  q: z.string().trim().max(100).optional(),
});

// ── Crew list query schema ────────────────────────────────────
export const crewListQuery = z.object({
  festivalId: z.string().max(100).optional(),
});

// ── Expense settle schema (extended with amount) ──────────────
export const expenseSettleFullSchema = z.object({
  toUserId: z.string().min(1),
  amount: expenseAmount,
});
