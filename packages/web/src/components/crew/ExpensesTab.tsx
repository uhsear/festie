import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchCrewExpenses, fetchCrewSettlementPlan, createCrewExpense, deleteCrewExpense } from '@festie/shared/services';
import { useCrewStore } from '@festie/shared/stores';
import type {
  SettleCrewExpenseRequest,
  CreateCrewExpenseRequest,
  CrewExpense,
  CrewSettlementPlan,
  CrewSettlement,
} from '@festie/shared/types';
import {
  formatBalance,
  formatAmount,
  writeOutcomeOf,
  writeOutcomeMessage,
  createSettleUpFlow,
  confirmPaidMessage,
  settlementPayments,
  describePayment,
  formatCents,
  paymentsToConfirm,
  expenseTrailLine,
  expenseShareCents,
  actualExpenses as selectActualExpenses,
  plannedExpenses as selectPlannedExpenses,
  sumExpenseAmounts,
  visibleExpenses as selectVisibleExpenses,
  nonZeroBalances as selectNonZeroBalances,
  myBalance as selectMyBalance,
  myPayments as selectMyPayments,
  myReceipts as selectMyReceipts,
} from '@festie/shared/utils';
import { CREW_CURRENCIES, expenseCategoryFor } from '@festie/shared/constants';
import { useToast } from '../../lib/toastContext';
import { cn } from '@/lib/utils';
import Button from '../ui/Button';
import EmptyState from '../ui/EmptyState';
import StaleNote from './StaleNote';
import Skeleton, { SkeletonGroup } from '../ui/Skeleton';
import { loadErrorMessage } from './loadErrorMessage';
import ExpenseItem from './ExpenseItem';
import ExpenseForm from './ExpenseForm';
import SettleUpCard, { type Balance } from './SettleUpCard';
import PaymentsList from './PaymentsList';
import ConfirmDialog from '../ui/ConfirmDialog';
import { DollarSign, Plus } from 'lucide-react';
import { useAnimatedNumber } from '../../hooks/useAnimatedNumber';
import SegmentedTablist from '@/components/ui/SegmentedTablist';
import { inputBase } from '../../lib/styles';
import { invalidateCrewMoney } from '../../lib/queryPersist';

type RawExpense = CrewExpense;

interface CrewMemberLite {
  userId: string;
  username?: string;
  name?: string;
}

interface Props {
  crewId: string;
  members: CrewMemberLite[];
  currentUserId: string;
}

const EXPENSE_VIEWS = (['actual', 'planned', 'all'] as const).map((v) => ({ value: v, label: v }));
function balanceColor(value: number): string {
  if (value > 0.01) return 'text-accent-aqua';
  if (value < -0.01) return 'text-[var(--color-text-danger)]';
  return 'text-text-primary';
}

export default function ExpensesTab({ crewId, members, currentUserId }: Props) {
  const { toast, toastError } = useToast();
  const qc = useQueryClient();
  const settleExpense = useCrewStore((s) => s.settleExpense);
  const updateExpense = useCrewStore((s) => s.updateExpense);
  const confirmPayment = useCrewStore((s) => s.confirmPayment);
  const remindPayment = useCrewStore((s) => s.remindPayment);
  const setExpenseCurrency = useCrewStore((s) => s.setExpenseCurrency);
  const isOwner = useCrewStore((s) => s.activeCrew?.owner === currentUserId);
  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState<RawExpense | null>(null);
  // Settle-up records a payment only after the user confirms they paid; the
  // payee's links show first. Records the exact netted plan amount.
  const [paidTarget, setPaidTarget] = useState<CrewSettlement | null>(null);
  const [removeTarget, setRemoveTarget] = useState<RawExpense | null>(null);
  const [undoTarget, setUndoTarget] = useState<RawExpense | null>(null);

  // Planned-vs-actual filter for the list. 'actual' = the real ledger (what
  // feeds settle-up); 'planned' = the budget/forecast view; 'all' = both.
  const [view, setView] = useState<'all' | 'actual' | 'planned'>('actual');
  // Settle-up view. 'fewest' = the netted greedy min-cash-flow plan (fewest
  // transfers, never a stranger-to-pay); 'everyone' = every member's gross net balance.
  const [settleView, setSettleView] = useState<'fewest' | 'everyone'>('fewest');

  const {
    data: expenses = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery<RawExpense[]>({
    queryKey: ['expenses', crewId],
    queryFn: () => fetchCrewExpenses(crewId),
    enabled: !!crewId,
  });

  // Settlement plan = netted who-pays-whom (greedy min-cash-flow over the
  // integer-cent ledger) + raw balances + payee payment handles. Replaces the
  // old raw-balance + Math.min() settle heuristic.
  const { data: plan } = useQuery<CrewSettlementPlan>({
    queryKey: ['settlement-plan', crewId],
    queryFn: () => fetchCrewSettlementPlan(crewId),
    enabled: !!crewId,
  });
  const balances: Balance[] = plan?.balances ?? [];
  const settlements: CrewSettlement[] = plan?.settlements ?? [];
  const currency = plan?.currency ?? 'USD';

  const addExpense = useMutation({
    mutationFn: (payload: CreateCrewExpenseRequest) => createCrewExpense(crewId, payload),
    onSuccess: (result, payload) => {
      const outcome = writeOutcomeOf(result);
      if (outcome === 'queued') {
        // Saved to the offline queue, not the server: show the row now with a
        // "Not sent yet" marker. Balances are left alone until the server
        // computes them; the next online refetch replaces the placeholder.
        const placeholder: RawExpense = {
          id: (result as { id: string }).id,
          crew_id: crewId,
          paid_by: payload.paidBy ?? currentUserId,
          created_by: currentUserId,
          split_amounts: payload.shares ? Object.fromEntries(payload.shares.map((sh) => [sh.userId, sh.cents])) : null,
          paid_by_name: '',
          description: payload.description,
          amount: payload.amount,
          split_with: payload.splitWith,
          category: payload.category,
          planned: payload.planned === true,
          created_at: new Date().toISOString(),
          _optimistic: true,
        };
        qc.setQueryData<RawExpense[]>(['expenses', crewId], (old = []) => [placeholder, ...old]);
      } else {
        invalidateCrewMoney(qc, crewId);
      }
      toast(writeOutcomeMessage(outcome, 'Expense added'), outcome === 'queued' ? 'info' : 'success');
      setShowForm(false);
    },
    onError: (e) => toastError(e, "Couldn't add expense. Try again."),
  });

  const invalidateMoney = () => {
    invalidateCrewMoney(qc, crewId);
  };

  const editExpense = useMutation({
    mutationFn: ({ id, request }: { id: string; request: CreateCrewExpenseRequest }) =>
      updateExpense(crewId, id, request),
    onSuccess: (outcome, { id, request }) => {
      if (outcome === 'queued') {
        qc.setQueryData<RawExpense[]>(['expenses', crewId], (old = []) =>
          old.map((e) =>
            e.id === id
              ? {
                  ...e,
                  description: request.description,
                  amount: request.amount,
                  split_with: request.splitWith,
                  category: request.category,
                  planned: request.planned === true,
                  ...(request.paidBy !== undefined ? { paid_by: request.paidBy } : {}),
                  split_amounts: request.shares
                    ? Object.fromEntries(request.shares.map((sh) => [sh.userId, sh.cents]))
                    : null,
                  _optimistic: true,
                }
              : e,
          ),
        );
      } else {
        invalidateMoney();
      }
      setEditTarget(null);
      toast(writeOutcomeMessage(outcome, 'Expense updated'), outcome === 'queued' ? 'info' : 'success');
    },
    onError: (e) => toastError(e, "Couldn't save changes. Try again."),
  });

  const confirm = useMutation({
    mutationFn: ({ id, received }: { id: string; received: boolean; payer: string }) =>
      confirmPayment(crewId, id, received),
    onSuccess: (outcome, { received, payer }) => {
      if (outcome === 'sent') invalidateMoney();
      toast(
        writeOutcomeMessage(
          outcome,
          received ? `Thanks. ${payer} can see you got it.` : `${payer} has been told it hasn't arrived.`,
        ),
        outcome === 'queued' ? 'info' : 'success',
      );
    },
    onError: (e) => toastError(e, "Couldn't update the payment. Try again."),
  });

  const remind = useMutation({
    mutationFn: ({ userId }: { userId: string; name: string }) => remindPayment(crewId, userId),
    onSuccess: (outcome, { name }) =>
      toast(writeOutcomeMessage(outcome, `Reminder sent to ${name}.`), outcome === 'queued' ? 'info' : 'success'),
    onError: (e) => toastError(e, "Couldn't send the reminder. Try again."),
  });

  const changeCurrency = useMutation({
    mutationFn: (code: string) => setExpenseCurrency(crewId, code),
    onSuccess: (outcome, code) => {
      if (outcome === 'queued') {
        qc.setQueryData<CrewSettlementPlan>(['settlement-plan', crewId], (old) =>
          old ? { ...old, currency: code } : old,
        );
      } else {
        invalidateMoney();
      }
      toast(writeOutcomeMessage(outcome, `Amounts now in ${code}`), outcome === 'queued' ? 'info' : 'success');
    },
    onError: (e) => toastError(e, "Couldn't change the currency. Try again."),
  });

  const removeExpense = useMutation({
    mutationFn: (id: string) => deleteCrewExpense(crewId, id),
    onSuccess: (result, id) => {
      const outcome = writeOutcomeOf(result);
      if (outcome === 'queued') {
        qc.setQueryData<RawExpense[]>(['expenses', crewId], (old = []) => old.filter((e) => e.id !== id));
      } else {
        invalidateCrewMoney(qc, crewId);
      }
      const wasPayment = expenses.some((e) => e.id === id && e.category === 'settlement');
      setRemoveTarget(null);
      setUndoTarget(null);
      toast(
        writeOutcomeMessage(outcome, wasPayment ? 'Payment undone' : 'Expense removed'),
        outcome === 'queued' ? 'info' : 'success',
      );
    },
    onError: (e) => toastError(e, "Couldn't remove expense. Try again."),
  });

  const settle = useMutation({
    mutationFn: (payload: SettleCrewExpenseRequest) => settleExpense(crewId, payload),
    onSuccess: (outcome) => {
      if (outcome === 'sent') {
        invalidateCrewMoney(qc, crewId);
      }
      setPaidTarget(null);
      toast(writeOutcomeMessage(outcome, 'Payment recorded'), outcome === 'queued' ? 'info' : 'success');
    },
    onError: (e) => toastError(e, "Couldn't settle up. Try again."),
  });

  // My net position from the netted plan, one actionable line per crew member:
  //   myPayments — "You owe {toName} {amt}" (settle-able by me)
  //   myReceipts — "{fromName} owes you {amt}" (they settle; I can send a reminder)
  const myPayments = selectMyPayments(settlements, currentUserId);
  const myReceipts = selectMyReceipts(settlements, currentUserId);

  const myBalance = selectMyBalance(balances, currentUserId);
  // Actual spend feeds the ledger; planned is the forecast/budget total. Keep
  // them separate so a budget row never inflates "total spent".
  const actualExpenses = selectActualExpenses(expenses);
  const plannedExpenses = selectPlannedExpenses(expenses);
  const payments = settlementPayments(expenses);
  const nameOf = (userId: string) => {
    const m = members.find((x) => x.userId === userId);
    return m ? m.name || m.username : undefined;
  };
  const totalSpent = sumExpenseAmounts(actualExpenses);
  const totalPlanned = sumExpenseAmounts(plannedExpenses);
  // N1: tween the headline total when the live ledger changes instead of hard-cutting.
  const animatedTotalSpent = useAnimatedNumber(totalSpent, { decimals: 2 });
  const visibleExpenses = selectVisibleExpenses(expenses, view);
  const nonZeroBalances = selectNonZeroBalances(balances);
  const toConfirm = paymentsToConfirm(expenses, currentUserId);
  const memberIds = members.map((m) => m.userId);

  if (isLoading)
    return (
      <SkeletonGroup className="px-4 space-y-2">
        <Skeleton variant="card" />
        <Skeleton variant="card" />
      </SkeletonGroup>
    );
  if (isError && expenses.length === 0)
    return (
      <div className="px-4">
        <EmptyState
          icon={<DollarSign className="w-12 h-12" aria-hidden="true" />}
          title="Couldn't load expenses"
          description={loadErrorMessage(error, 'Something went wrong loading expenses.')}
          cta={{ label: 'Retry', onClick: () => refetch() }}
        />
      </div>
    );

  return (
    <div className="space-y-3 px-4">
      <StaleNote show={isError} onRetry={() => void refetch()} />
      {/* Currency label. A label only: changing it never converts amounts. */}
      <div className="p-3 rounded-lg bg-bg-card border border-border space-y-1">
        {isOwner && currency !== 'USD' ? (
          <>
            <label htmlFor="expense-currency" className="block text-xs text-text-muted uppercase tracking-wide">
              Currency
            </label>
            <select
              id="expense-currency"
              value={currency}
              disabled={changeCurrency.isPending}
              onChange={(e) => changeCurrency.mutate(e.target.value)}
              className={cn(inputBase, 'min-h-11')}
            >
              {[currency, ...CREW_CURRENCIES.filter((c) => c !== currency)].map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
            <p className="text-xs text-text-secondary">Changing the currency does not convert amounts.</p>
          </>
        ) : (
          <p className="text-sm text-text-secondary">Amounts in {currency}</p>
        )}
      </div>

      {/* Summary */}
      {expenses.length > 0 && (
        <div className="crew-stats-grid grid grid-cols-2 gap-2">
          <div className="p-3 rounded-lg bg-bg-card border border-border">
            <div className="text-xs text-text-muted uppercase tracking-wide">Total spent</div>
            <div className="text-lg font-bold text-text-primary tabular-nums">{formatAmount(animatedTotalSpent, currency)}</div>
          </div>
          <div className="p-3 rounded-lg bg-bg-card border border-border">
            <div className="text-xs text-text-muted uppercase tracking-wide">Your balance</div>
            <div className={cn('text-lg font-bold tabular-nums', balanceColor(myBalance))}>
              {formatBalance(myBalance, currency)}
            </div>
          </div>
          {totalPlanned > 0 && (
            <div className="p-3 rounded-lg bg-bg-card border border-border col-span-2">
              <div className="text-xs text-text-muted uppercase tracking-wide">Planned (budget)</div>
              <div className="text-lg font-bold text-accent-aqua tabular-nums">{formatAmount(totalPlanned, currency)}</div>
            </div>
          )}
        </div>
      )}

      {/* Planned-vs-actual filter. 'Actual' is the real ledger (settle-up); */}
      {/* 'Planned' is the budget/forecast view. */}
      {expenses.length > 0 && (
        <SegmentedTablist
          label="Filter expenses"
          panelId="expenses-list-panel"
          options={EXPENSE_VIEWS}
          value={view}
          onChange={setView}
          className="flex gap-1 rounded-lg bg-bg-card"
          tabClassName="flex-1 rounded-md capitalize"
        />
      )}

      {/* Payments the current user was paid, waiting on "Got it" / "Not received". */}
      {toConfirm.length > 0 && (
        <div className="p-3 rounded-lg bg-bg-card border border-border space-y-3">
          <div className="text-xs text-text-muted uppercase tracking-wide">Payments to confirm</div>
          {toConfirm.map((p) => {
            const payer = nameOf(p.paid_by) ?? p.paid_by_name ?? 'A crewmate';
            return (
              <div key={p.id} className="space-y-2">
                <div className="text-sm text-text-primary">
                  {payer} marked {formatAmount(p.amount, currency)} paid to you.
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="primary"
                    onClick={() => confirm.mutate({ id: p.id, received: true, payer })}
                    disabled={confirm.isPending}
                    className="!py-1 !px-3 text-xs min-h-11"
                  >
                    Got it
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => confirm.mutate({ id: p.id, received: false, payer })}
                    disabled={confirm.isPending}
                    className="!py-1 !px-3 text-xs min-h-11"
                  >
                    Not received
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Settle up — one card, toggle between the netted "Fewest payments" plan
          (fewest transfers, never a stranger-to-pay) and "Everyone's balance"
          (per-member balances). Fewest payments surfaces one actionable net line
          per crew member: "You owe {name}" (settle-able) / "{name} owes you"
          (with a reminder button). */}
      {(settlements.length > 0 || nonZeroBalances.length > 0) && (
        <SettleUpCard
          myPayments={myPayments}
          myReceipts={myReceipts}
          nonZeroBalances={nonZeroBalances}
          settleView={settleView}
          onSettleViewChange={setSettleView}
          currentUserId={currentUserId}
          currency={currency}
          settlePending={settle.isPending}
          remindPending={remind.isPending}
          onPay={setPaidTarget}
          onRemind={(userId, name) => remind.mutate({ userId, name })}
        />
      )}

      {/* Add / edit form, or the add button */}
      {editTarget ? (
        <ExpenseForm
          key={editTarget.id}
          members={members}
          currentUserId={currentUserId}
          currency={currency}
          initial={editTarget}
          canChangePayer={
            editTarget.paid_by === currentUserId || editTarget.created_by === currentUserId || isOwner
          }
          busy={editExpense.isPending}
          onSubmit={(request) => editExpense.mutate({ id: editTarget.id, request })}
          onCancel={() => setEditTarget(null)}
        />
      ) : !showForm ? (
        <Button variant="primary" onClick={() => setShowForm(true)} className="w-full min-h-11">
          <Plus className="w-4 h-4" aria-hidden="true" /> Add Expense
        </Button>
      ) : (
        <ExpenseForm
          key={crewId}
          members={members}
          currentUserId={currentUserId}
          currency={currency}
          busy={addExpense.isPending}
          onSubmit={(request) => addExpense.mutate(request)}
          onCancel={() => setShowForm(false)}
        />
      )}

      {/* Expense list (filtered by the planned-vs-actual view) */}
      <div id="expenses-list-panel">
      {expenses.length === 0 ? (
        <EmptyState
          illustration="emptyList"
          title="No expenses yet"
          description={`Add the first one, for example: Gas, ${formatAmount(60, currency)}, split 4 ways.`}
          cta={{ label: 'Add expense', onClick: () => setShowForm(true) }}
        />
      ) : visibleExpenses.length === 0 ? (
        <EmptyState
          icon={<DollarSign className="w-12 h-12" aria-hidden="true" />}
          title={view === 'planned' ? 'No planned expenses' : 'No actual expenses'}
          description={
            view === 'planned'
              ? 'Add a planned expense to start a budget for this trip.'
              : 'Nothing has been spent yet.'
          }
        />
      ) : (
        <div className="space-y-2">
          {visibleExpenses.map((e, i) => {
            const cat = expenseCategoryFor(e.category);
            const shareCents = expenseShareCents(e, currentUserId, memberIds);
            const mayRemove = e.paid_by === currentUserId || e.created_by === currentUserId || isOwner;
            return (
              <ExpenseItem
                key={e.id}
                index={i}
                id={e.id}
                description={e.description}
                amount={e.amount}
                paidByName={e.paid_by_name}
                paidByMe={e.paid_by === currentUserId}
                splitCount={e.split_with.length}
                category={cat}
                planned={e.planned}
                optimistic={e._optimistic}
                currency={currency}
                shareLine={
                  e.planned ? null : shareCents === null ? 'Not in your split' : `Your share ${formatCents(shareCents, currency)}`
                }
                trailLine={expenseTrailLine(e, members)}
                canEdit={!e._optimistic}
                onEdit={() => setEditTarget(e)}
                canRemove={!e._optimistic && mayRemove}
                onRemove={() => setRemoveTarget(e)}
                isRemoving={removeExpense.isPending}
              />
            );
          })}
        </div>
      )}
      </div>

      {view !== 'planned' && payments.length > 0 && (
        <PaymentsList
          payments={payments}
          members={members}
          currentUserId={currentUserId}
          currency={currency}
          nameOf={nameOf}
          undoPending={removeExpense.isPending}
          onUndo={setUndoTarget}
        />
      )}

      <ConfirmDialog
        open={undoTarget !== null}
        onOpenChange={(open) => {
          if (!open) setUndoTarget(null);
        }}
        title="Undo this payment?"
        description={
          undoTarget
            ? `${describePayment(undoTarget, currentUserId, nameOf, currency)}. Undo it only if it was recorded by mistake. Balances go back to what they were before.`
            : undefined
        }
        confirmLabel="Undo payment"
        destructive
        busy={removeExpense.isPending}
        onConfirm={() => {
          if (undoTarget) removeExpense.mutate(undoTarget.id);
        }}
      />
      <ConfirmDialog
        open={removeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRemoveTarget(null);
        }}
        title="Remove expense"
        description={
          removeTarget
            ? `Remove "${removeTarget.description}" (${formatAmount(removeTarget.amount, currency)})? Everyone's balance is recalculated without it.`
            : undefined
        }
        confirmLabel="Remove"
        destructive
        busy={removeExpense.isPending}
        onConfirm={() => {
          if (removeTarget) removeExpense.mutate(removeTarget.id);
        }}
      />
      <ConfirmDialog
        open={paidTarget !== null}
        onOpenChange={(open) => {
          if (!open) setPaidTarget(null);
        }}
        title="Record payment"
        description={paidTarget ? confirmPaidMessage(paidTarget, formatAmount(paidTarget.amount, currency)) : undefined}
        confirmLabel="Yes, I paid"
        busy={settle.isPending}
        onConfirm={() => {
          if (paidTarget) createSettleUpFlow(paidTarget, (req) => settle.mutateAsync(req), currency).confirmPaid().catch(() => {});
        }}
      />
    </div>
  );
}
