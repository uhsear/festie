import { Router } from 'express';

import { simplifyDebts } from '../lib/db/stores/expenses.js';
import { appLink } from '../lib/notifications/links.js';

// "$12.40", "€12.40". Every crew currency has 2 decimal places, so cents / 100 is exact.
function formatMoney(cents: number, currency: string) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
}

const toCents = (amount: number | string) => Math.round(Number(amount) * 100);

// Display name, else username. Names only, never a user id.
function nameOf(members: any[], userId: string | undefined) {
  const member = members.find((m: any) => m.userId === userId);
  return member?.name || member?.username || 'a crewmate';
}

// Uneven shares as stored in `split_amounts`: { userId: cents }. Null = equal split.
function splitAmountsOf(shares?: { userId: string; cents: number }[]) {
  return shares ? Object.fromEntries(shares.map((s) => [s.userId, s.cents])) : null;
}

export default function createExpenseRoutes(deps: any) {
  const router = Router();
  const {
    stores,
    userAuth,
    sendSuccess,
    sendError,
    ErrorCodes,
    log,
    rateLimit,
    emitter,
    sanitizeIdentifier,
    schemas,
    validate,
    validateParams,
    notificationService,
    config,
  } = deps;

  // Best-effort money push to one member. Never blocks or fails the response.
  function pushMoney(userId: string, crewId: string, title: string, body: string, expenseId?: string) {
    if (!notificationService?.send) return;
    Promise.resolve()
      .then(() =>
        notificationService.send({
          userId,
          type: 'crew_update',
          title,
          body,
          data: { crewId, ...(expenseId ? { expenseId } : {}), deepLink: appLink(config, '/crew?tab=money') },
          threadId: `crew-money-${crewId}`,
        }),
      )
      .catch((err: any) => log.warn('money push failed', { error: err?.message, crewId }));
  }

  // Every split target and the payer must be current crew members, with no
  // duplicates — otherwise a non-member's share is counted but never owed,
  // leaving the ledger non-zero-sum. Returns the members, or null after
  // sending the 400.
  async function checkPeople(crewId: string, body: any, res: any) {
    const members = await stores.crews.getMembers(crewId);
    const memberIds = new Set(members.map((m: any) => m.userId));
    const { splitWith, paidBy } = body;
    if (new Set(splitWith).size !== splitWith.length) {
      sendError(res, 400, 'splitWith contains duplicate users', ErrorCodes.INVALID_INPUT);
      return null;
    }
    if (splitWith.some((id: string) => !memberIds.has(id))) {
      sendError(res, 400, 'splitWith includes users who are not crew members', ErrorCodes.INVALID_INPUT);
      return null;
    }
    if (paidBy !== undefined && !memberIds.has(paidBy)) {
      sendError(res, 400, 'The person who paid must be in the crew.', ErrorCodes.INVALID_INPUT);
      return null;
    }
    return members;
  }

  // GET /crew/:crewId/expenses
  router.get(
    '/crews/:crewId/expenses',
    userAuth,
    rateLimit(120, 'expense-list'),
    validateParams(schemas.crewIdParams),
    async (req: any, res: any) => {
      try {
        const crewId = sanitizeIdentifier(req.validatedParams.crewId);
        const member = await stores.crews.getMember(crewId, req.user.userId);
        if (!member) return sendError(res, 403, 'Not a crew member', ErrorCodes.FORBIDDEN);
        const expenses = await stores.expenses.getByCrew(crewId);
        return sendSuccess(res, expenses);
      } catch (err: any) {
        log.error('get expenses failed', { error: err.message });
        return sendError(res, 500, 'Failed to load expenses', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  // POST /crew/:crewId/expenses
  router.post(
    '/crews/:crewId/expenses',
    userAuth,
    rateLimit(30, 'expense-create'),
    validateParams(schemas.crewIdParams),
    validate(schemas.expenseCreate),
    async (req: any, res: any) => {
      try {
        const crewId = sanitizeIdentifier(req.validatedParams.crewId);
        const member = await stores.crews.getMember(crewId, req.user.userId);
        if (!member) return sendError(res, 403, 'Not a crew member', ErrorCodes.FORBIDDEN);

        const members = await checkPeople(crewId, req.validatedBody, res);
        if (!members) return;
        const { description, amount, splitWith, category, planned, shares } = req.validatedBody;
        const paidBy = req.validatedBody.paidBy ?? req.user.userId;
        const currency = await stores.expenses.getCurrency(crewId);

        const expense = await stores.expenses.create({
          crewId,
          paidBy,
          description: description.trim().slice(0, 200),
          amount: Math.round(amount * 100) / 100,
          splitWith,
          category: category || 'other',
          // Forecast/budget rows are excluded from the ledger (see getBalances).
          planned: planned === true,
          createdBy: req.user.userId,
          splitAmounts: splitAmountsOf(shares),
        });

        emitter.crewExpenseAdded({ crewId, expense });
        const paidByNote = paidBy === req.user.userId ? '' : ` (paid by ${nameOf(members, paidBy)})`;
        await stores.activity
          .log({
            crewId,
            userId: req.user.userId,
            type: 'expense-added',
            detail: `${expense.description} ${formatMoney(toCents(amount), currency)}${paidByNote}`,
          })
          .catch((err: any) => log.warn('expense-added activity log failed', { crewId, error: err.message }));
        res.status(201);
        return sendSuccess(res, expense);
      } catch (err: any) {
        log.error('create expense failed', { error: err.message });
        return sendError(res, 500, 'Failed to create expense', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  // PUT /crews/:crewId/expenses/currency — registered before /:expenseId so
  // Express does not match "currency" as an expense id.
  router.put(
    '/crews/:crewId/expenses/currency',
    userAuth,
    rateLimit(10, 'expense-currency'),
    validateParams(schemas.crewIdParams),
    validate(schemas.expenseCurrency),
    async (req: any, res: any) => {
      try {
        const crewId = sanitizeIdentifier(req.validatedParams.crewId);
        const member = await stores.crews.getMember(crewId, req.user.userId);
        if (!member) return sendError(res, 403, 'Not a crew member', ErrorCodes.FORBIDDEN);
        if (member.role !== 'owner') {
          return sendError(res, 403, 'Only the crew owner can change the currency.', ErrorCodes.FORBIDDEN);
        }
        const { currency } = req.validatedBody;
        await stores.expenses.setCurrency(crewId, currency);
        emitter.crewExpenseUpdated({ crewId });
        await stores.activity
          .log({ crewId, userId: req.user.userId, type: 'currency-changed', detail: `Currency set to ${currency}` })
          .catch((err: any) => log.warn('currency activity log failed', { error: err.message }));
        return sendSuccess(res, { currency });
      } catch (err: any) {
        log.error('set expense currency failed', { error: err.message });
        return sendError(res, 500, 'Failed to change the currency', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  // PUT /crews/:crewId/expenses/:expenseId — full replacement by any member.
  router.put(
    '/crews/:crewId/expenses/:expenseId',
    userAuth,
    rateLimit(30, 'expense-update'),
    validateParams(schemas.crewIdExpenseIdParams),
    validate(schemas.expenseUpdate),
    async (req: any, res: any) => {
      try {
        const crewId = sanitizeIdentifier(req.validatedParams.crewId);
        const expenseId = sanitizeIdentifier(req.validatedParams.expenseId);
        const member = await stores.crews.getMember(crewId, req.user.userId);
        if (!member) return sendError(res, 403, 'Not a crew member', ErrorCodes.FORBIDDEN);

        const existing = await stores.expenses.getById(expenseId);
        if (!existing || existing.crew_id !== crewId)
          return sendError(res, 404, 'Expense not found', ErrorCodes.NOT_FOUND);
        if (existing.category === 'settlement') {
          return sendError(
            res,
            400,
            "Payments can't be edited. Undo the payment and record it again.",
            ErrorCodes.INVALID_INPUT,
          );
        }
        const members = await checkPeople(crewId, req.validatedBody, res);
        if (!members) return;

        const { description, amount, splitWith, category, planned, paidBy, shares } = req.validatedBody;
        // Any member may edit, but moving the debt onto someone else needs the payer, the adder or the owner.
        const changesPayer = paidBy !== undefined && paidBy !== existing.paid_by;
        if (
          changesPayer &&
          ![existing.paid_by, existing.created_by].includes(req.user.userId) &&
          member.role !== 'owner'
        ) {
          return sendError(
            res,
            403,
            'Only the payer, the person who added this, or the crew owner can change who paid.',
            ErrorCodes.FORBIDDEN,
          );
        }
        const currency = await stores.expenses.getCurrency(crewId);
        const expense = await stores.expenses.update(expenseId, {
          paidBy: paidBy ?? existing.paid_by,
          description: description.trim().slice(0, 200),
          amount: Math.round(amount * 100) / 100,
          splitWith,
          splitAmounts: splitAmountsOf(shares),
          category: category || existing.category || 'other',
          planned: planned === true,
          updatedBy: req.user.userId,
        });
        if (!expense) return sendError(res, 404, 'Expense not found', ErrorCodes.NOT_FOUND);

        emitter.crewExpenseUpdated({ crewId, expense });
        const oldCents = toCents(existing.amount);
        const newCents = toCents(amount);
        const detail =
          oldCents === newCents
            ? expense.description
            : `${expense.description}: ${formatMoney(oldCents, currency)} → ${formatMoney(newCents, currency)}`;
        await stores.activity
          .log({ crewId, userId: req.user.userId, type: 'expense-edited', detail })
          .catch((err: any) => log.warn('expense edit activity log failed', { error: err.message }));
        return sendSuccess(res, expense);
      } catch (err: any) {
        log.error('update expense failed', { error: err.message });
        return sendError(res, 500, 'Failed to update expense', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  // DELETE /crew/:crewId/expenses/:expenseId
  router.delete(
    '/crews/:crewId/expenses/:expenseId',
    userAuth,
    rateLimit(30, 'expense-delete'),
    validateParams(schemas.crewIdExpenseIdParams),
    async (req: any, res: any) => {
      try {
        const crewId = sanitizeIdentifier(req.validatedParams.crewId);
        const expenseId = sanitizeIdentifier(req.validatedParams.expenseId);
        const member = await stores.crews.getMember(crewId, req.user.userId);
        if (!member) return sendError(res, 403, 'Not a crew member', ErrorCodes.FORBIDDEN);

        const expense = await stores.expenses.getById(expenseId);
        if (!expense || expense.crew_id !== crewId)
          return sendError(res, 404, 'Expense not found', ErrorCodes.NOT_FOUND);
        const isPayment = expense.category === 'settlement';
        // Payments stay payer-only; other rows: the payer, whoever added it, or the owner.
        if (isPayment && expense.paid_by !== req.user.userId)
          return sendError(res, 403, 'Only the payer can delete', ErrorCodes.FORBIDDEN);
        if (!isPayment && ![expense.paid_by, expense.created_by].includes(req.user.userId) && member.role !== 'owner') {
          return sendError(
            res,
            403,
            'Only the payer, the person who added it, or the crew owner can remove this.',
            ErrorCodes.FORBIDDEN,
          );
        }

        await stores.expenses.delete(expenseId);
        emitter.crewExpenseDeleted({ crewId, expenseId });
        if (isPayment) {
          await Promise.all([stores.crews.getMembers(crewId), stores.expenses.getCurrency(crewId)])
            .then(([members, currency]: [any[], string]) =>
              stores.activity.log({
                crewId,
                userId: req.user.userId,
                type: 'settlement-undone',
                detail: `${formatMoney(toCents(expense.amount), currency)} to ${nameOf(members, expense.split_with?.[0])}`,
              }),
            )
            .catch((err: any) => log.warn('settlement undo activity log failed', { error: err.message }));
        }
        return sendSuccess(res, { deleted: true });
      } catch (err: any) {
        log.error('delete expense failed', { error: err.message });
        return sendError(res, 500, 'Failed to delete expense', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  // GET /crew/:crewId/expenses/balances
  router.get(
    '/crews/:crewId/expenses/balances',
    userAuth,
    rateLimit(60, 'expense-balances'),
    validateParams(schemas.crewIdParams),
    async (req: any, res: any) => {
      try {
        const crewId = sanitizeIdentifier(req.validatedParams.crewId);
        const member = await stores.crews.getMember(crewId, req.user.userId);
        if (!member) return sendError(res, 403, 'Not a crew member', ErrorCodes.FORBIDDEN);
        const balances = await stores.expenses.getBalances(crewId);
        return sendSuccess(res, balances);
      } catch (err: any) {
        log.error('get balances failed', { error: err.message });
        return sendError(res, 500, 'Failed to load balances', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  // GET /crews/:crewId/expenses/settlement-plan
  // Returns the netted who-pays-whom plan (greedy min-cash-flow over the
  // integer-cent ledger) alongside the raw dollar balances. Each settlement
  // row carries the PAYEE's payment handles (and only the payee's) so the
  // client can render prefilled Venmo/Cash App/PayPal links without leaking
  // the whole roster's handles.
  router.get(
    '/crews/:crewId/expenses/settlement-plan',
    userAuth,
    rateLimit(60, 'expense-settlement-plan'),
    validateParams(schemas.crewIdParams),
    async (req: any, res: any) => {
      try {
        const crewId = sanitizeIdentifier(req.validatedParams.crewId);
        const member = await stores.crews.getMember(crewId, req.user.userId);
        if (!member) return sendError(res, 403, 'Not a crew member', ErrorCodes.FORBIDDEN);

        const balancesCents = await stores.expenses.getBalancesCents(crewId);
        const settlements = simplifyDebts(balancesCents);

        // Attach payee payment handles (only for users who actually receive a
        // transfer in this plan). Handles are optional/nullable.
        const payeeIds = [...new Set(settlements.map((s: any) => s.toUserId))];
        const userMap = payeeIds.length ? await stores.users.getByIds(payeeIds) : new Map();
        const settlementsWithHandles = settlements.map((s: any) => {
          const payee = userMap.get(s.toUserId);
          return {
            fromUserId: s.fromUserId,
            fromName: s.fromName,
            toUserId: s.toUserId,
            toName: s.toName,
            amountCents: s.amountCents,
            // Dollars convenience for clients that render currency directly.
            amount: s.amountCents / 100,
            payeeHandles: payee
              ? {
                  venmo: payee.venmoHandle || null,
                  cashapp: payee.cashappCashtag || null,
                  paypal: payee.paypalHandle || null,
                }
              : { venmo: null, cashapp: null, paypal: null },
          };
        });

        // Dollars balances mirror the existing /balances contract.
        const balances = balancesCents.map((b: any) => ({
          userId: b.userId,
          username: b.username,
          balance: b.balanceCents / 100,
        }));

        const currency = await stores.expenses.getCurrency(crewId);
        return sendSuccess(res, { balances, settlements: settlementsWithHandles, currency });
      } catch (err: any) {
        log.error('get settlement plan failed', { error: err.message });
        return sendError(res, 500, 'Failed to load settlement plan', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  router.post(
    '/crews/:crewId/expenses/settle',
    userAuth,
    rateLimit(20, 'expense-settle'),
    validateParams(schemas.crewIdParams),
    validate(schemas.expenseSettleFull),
    async (req: any, res: any) => {
      try {
        const crewId = sanitizeIdentifier(req.validatedParams.crewId);
        const member = await stores.crews.getMember(crewId, req.user.userId);
        if (!member) return sendError(res, 403, 'Not a crew member', ErrorCodes.FORBIDDEN);
        const { toUserId, amount } = req.validatedBody;
        // The settlement target must be a different current crew member.
        if (toUserId === req.user.userId) {
          return sendError(res, 400, 'Cannot settle with yourself', ErrorCodes.INVALID_INPUT);
        }
        const members = await stores.crews.getMembers(crewId);
        if (!members.some((m: any) => m.userId === toUserId)) {
          return sendError(res, 400, 'Settlement target is not a crew member', ErrorCodes.INVALID_INPUT);
        }
        const currency = await stores.expenses.getCurrency(crewId);
        const settlement = await stores.expenses.create({
          crewId,
          paidBy: req.user.userId,
          description: `Settlement payment`,
          amount: Math.round(amount * 100) / 100,
          splitWith: [toUserId],
          category: 'settlement',
          // Migration 079 treats settlements with no created_by as pre-079 history.
          createdBy: req.user.userId,
        });
        const money = formatMoney(toCents(amount), currency);
        const settled = {
          crewId,
          userId: req.user.userId,
          type: 'expense-settled',
          detail: `${money} to ${nameOf(members, toUserId)}`,
        };
        stores.activity
          .log(settled)
          .then((id: string) => emitter.crewActivityLogged({ crewId, item: { id, ...settled } }))
          .catch((err: any) => log.warn('settlement activity log failed', { error: err.message }));
        emitter.crewExpenseAdded({ crewId, expense: settlement });
        pushMoney(
          toUserId,
          crewId,
          'Payment marked as paid',
          `${req.user.username || 'A crewmate'} marked ${money} paid to you. Open Festie to confirm you got it.`,
          settlement.id,
        );
        res.status(201);
        return sendSuccess(res, settlement);
      } catch (err: any) {
        log.error('settle expense failed', { error: err.message });
        return sendError(res, 500, 'Failed to record settlement', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  // POST /crews/:crewId/expenses/:expenseId/confirm — the payee says whether a
  // payment arrived. "Not received" only flags the row; the ledger is unchanged.
  router.post(
    '/crews/:crewId/expenses/:expenseId/confirm',
    userAuth,
    rateLimit(30, 'expense-confirm'),
    validateParams(schemas.crewIdExpenseIdParams),
    validate(schemas.expenseConfirm),
    async (req: any, res: any) => {
      try {
        const crewId = sanitizeIdentifier(req.validatedParams.crewId);
        const expenseId = sanitizeIdentifier(req.validatedParams.expenseId);
        const member = await stores.crews.getMember(crewId, req.user.userId);
        if (!member) return sendError(res, 403, 'Not a crew member', ErrorCodes.FORBIDDEN);

        const existing = await stores.expenses.getById(expenseId);
        if (!existing || existing.crew_id !== crewId)
          return sendError(res, 404, 'Expense not found', ErrorCodes.NOT_FOUND);
        if (existing.category !== 'settlement')
          return sendError(res, 400, 'Only payments can be confirmed.', ErrorCodes.INVALID_INPUT);
        if (existing.split_with?.[0] !== req.user.userId)
          return sendError(res, 403, 'Only the person who was paid can confirm this.', ErrorCodes.FORBIDDEN);

        const { received } = req.validatedBody;
        const expense = await stores.expenses.setConfirmation(expenseId, received);
        if (!expense) return sendError(res, 404, 'Expense not found', ErrorCodes.NOT_FOUND);
        emitter.crewExpenseUpdated({ crewId, expense });

        const [members, currency] = await Promise.all([
          stores.crews.getMembers(crewId),
          stores.expenses.getCurrency(crewId),
        ]);
        const money = formatMoney(toCents(existing.amount), currency);
        await stores.activity
          .log({
            crewId,
            userId: req.user.userId,
            type: received ? 'payment-confirmed' : 'payment-disputed',
            detail: `${money} from ${nameOf(members, existing.paid_by)}`,
          })
          .catch((err: any) => log.warn('payment confirm activity log failed', { error: err.message }));
        if (!received) {
          pushMoney(
            existing.paid_by,
            crewId,
            'Payment not received',
            `${req.user.username || 'A crewmate'} says your ${money} payment hasn't arrived. Check with them.`,
            expenseId,
          );
        }
        return sendSuccess(res, expense);
      } catch (err: any) {
        log.error('confirm payment failed', { error: err.message });
        return sendError(res, 500, 'Failed to confirm payment', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  // POST /crews/:crewId/expenses/remind — the person who is owed nudges a
  // debtor once per UTC day. Private: no activity row.
  router.post(
    '/crews/:crewId/expenses/remind',
    userAuth,
    rateLimit(20, 'expense-remind'),
    validateParams(schemas.crewIdParams),
    validate(schemas.expenseRemind),
    async (req: any, res: any) => {
      try {
        const crewId = sanitizeIdentifier(req.validatedParams.crewId);
        const member = await stores.crews.getMember(crewId, req.user.userId);
        if (!member) return sendError(res, 403, 'Not a crew member', ErrorCodes.FORBIDDEN);

        const { userId } = req.validatedBody;
        const [balancesCents, members, currency] = await Promise.all([
          stores.expenses.getBalancesCents(crewId),
          stores.crews.getMembers(crewId),
          stores.expenses.getCurrency(crewId),
        ]);
        const name = nameOf(members, userId);
        const transfer = simplifyDebts(balancesCents).find(
          (s) => s.fromUserId === userId && s.toUserId === req.user.userId,
        );
        if (!transfer) {
          return sendError(res, 400, `${name} doesn't owe you anything right now.`, ErrorCodes.INVALID_INPUT);
        }
        if (!(await stores.expenses.recordReminder(crewId, req.user.userId, userId))) {
          return sendError(res, 409, `You already reminded ${name} today. Try again tomorrow.`, ErrorCodes.CONFLICT);
        }
        pushMoney(
          userId,
          crewId,
          'Settle-up reminder',
          `${req.user.username || 'A crewmate'} sent a reminder: you owe them ${formatMoney(transfer.amountCents, currency)}.`,
        );
        return sendSuccess(res, { reminded: true });
      } catch (err: any) {
        log.error('remind payment failed', { error: err.message });
        return sendError(res, 500, 'Failed to send the reminder', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );
  return router;
}
