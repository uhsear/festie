// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import { z } from 'zod';

// ── Expense schemas ─────────────────────────────────────────────
// Keep in sync with CREW_CURRENCIES in packages/shared/src/constants/config.ts
// (the backend cannot import @festie/shared, see lib/time-zone.ts). USD is the
// only currency for new writes (FND-082); crews that already store another
// code keep it, and every read path still accepts any string.
export const CREW_CURRENCIES = ['USD'] as const;

const expenseShareSchema = z.object({
  userId: z.string().min(1).max(100),
  cents: z.number().int().positive().max(9_999_999_999),
});

// Column is NUMERIC(10,2) with CHECK (amount > 0): below 0.01 rounds to 0, above 99,999,999.99 overflows.
export const expenseAmount = z.number().min(0.01).max(99_999_999.99);

export const expenseCreateSchema = z
  .object({
    description: z.string().min(1).max(200),
    amount: expenseAmount,
    // User IDs are TEXT (e.g. "user-<uuid>"), not integers — clients send strings.
    // Typing these as numbers 400'd every real expense create/settle.
    splitWith: z.array(z.string().min(1)).min(1),
    category: z.string().max(50).optional(),
    // Budget = planned expenses. A planned row is a forecast and is EXCLUDED from
    // the balance ledger / settle-up (see getBalances). Defaults to actual (false).
    planned: z.boolean().optional(),
    // The member who paid. Defaults to the caller on the server.
    paidBy: z.string().min(1).max(100).optional(),
    // Uneven split in integer cents. Absent = equal split across splitWith.
    shares: z.array(expenseShareSchema).min(1).max(30).optional(),
  })
  .superRefine((d, ctx) => {
    // Payments come only from POST /expenses/settle; this blocks forged "A paid B" rows and edits into a payment.
    if (d.category === 'settlement') {
      ctx.addIssue({
        code: 'custom',
        path: ['category'],
        message: 'Record a payment with Settle up, not as an expense.',
      });
    }
    if (!d.shares) return;
    const shareIds = d.shares.map((s) => s.userId);
    const shareSet = new Set(shareIds);
    if (shareSet.size !== shareIds.length) {
      ctx.addIssue({ code: 'custom', path: ['shares'], message: 'Each person can appear once in the shares.' });
    }
    const splitSet = new Set(d.splitWith);
    if (shareSet.size !== splitSet.size || [...shareSet].some((id) => !splitSet.has(id))) {
      ctx.addIssue({ code: 'custom', path: ['shares'], message: 'Shares must list the same people as the split.' });
    }
    const sum = d.shares.reduce((acc, s) => acc + s.cents, 0);
    if (sum !== Math.round(d.amount * 100)) {
      ctx.addIssue({ code: 'custom', path: ['shares'], message: 'Shares must add up to the total.' });
    }
  });

export const expenseCurrencySchema = z.object({ currency: z.enum(CREW_CURRENCIES) });

export const expenseConfirmSchema = z.object({ received: z.boolean() });

// `userId` is the member who owes the caller.
export const expenseRemindSchema = z.object({ userId: z.string().min(1).max(100) });
