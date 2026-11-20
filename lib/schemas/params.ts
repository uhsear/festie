// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import { z } from 'zod';
import { identifier } from './primitives';

// ── Route param schemas ────────────────────────────────────────
export const crewIdParams = z.object({
  crewId: z.string().min(1, 'Crew ID required').max(100),
});

export const crewIdExpenseIdParams = z.object({
  crewId: z.string().min(1, 'Crew ID required').max(100),
  expenseId: z.string().min(1, 'Expense ID required').max(100),
});

export const crewIdPollIdParams = z.object({
  crewId: z.string().min(1, 'Crew ID required').max(100),
  pollId: z.string().min(1, 'Poll ID required').max(100),
});

export const crewIdMpIdParams = z.object({
  crewId: z.string().min(1, 'Crew ID required').max(100),
  mpId: z.string().min(1, 'Meeting point ID required').max(100),
});

export const crewIdUserIdParams = z.object({
  crewId: z.string().min(1, 'Crew ID required').max(100),
  userId: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/, 'Invalid user ID'),
});

export const crewIdItemIdParams = z.object({
  crewId: z.string().min(1, 'Crew ID required').max(100),
  itemId: z.string().min(1, 'Item ID required').max(100),
});

export const setIdParams = z.object({
  setId: z.string().min(1, 'Set ID required').max(100),
});

export const crewIdFestivalIdParams = z.object({
  crewId: z.string().min(1, 'Crew ID required').max(100),
  festivalId: z.string().min(1, 'Festival ID required').max(100),
});

export const festivalIdParams = z.object({
  festivalId: z.string().min(1, 'Festival ID required').max(100),
});

export const genericIdParams = z.object({
  id: z.string().min(1, 'ID required').max(100),
});

export const idUserIdParams = z.object({
  id: z.string().min(1, 'ID required').max(100),
  userId: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/, 'Invalid user ID'),
});

export const idRoleParams = z.object({
  id: z.string().min(1, 'ID required').max(100),
  role: z.string().trim().toLowerCase().pipe(z.enum(['admin', 'user'])),
});

export const alsoPickedParams = z.object({
  festivalId: identifier,
  setId: identifier,
});

export const profileIdParams = z.object({
  id: z.string().min(1, 'Profile ID required').max(100),
});
