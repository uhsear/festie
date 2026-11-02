import React, { useState } from 'react';
import { X } from 'lucide-react';
import type { CreateCrewExpenseRequest, CrewExpense } from '@festie/shared/types';
import { EXPENSE_CATEGORIES } from '@festie/shared/constants';
import { evenShares, sharesError, formatCents, toCents } from '@festie/shared/utils';
import { ExpenseIcon } from '../../lib/expenseIcon';
import { cn } from '@/lib/utils';
import { inputBase } from '../../lib/styles';
import Button from '../ui/Button';
import Input from '../ui/Input';
import IconButton from '../ui/IconButton';

interface FormMember {
  userId: string;
  username?: string;
  name?: string;
}

interface Props {
  members: FormMember[];
  currentUserId: string;
  currency: string;
  /** Present when editing: every field is prefilled from this row. */
  initial?: CrewExpense;
  /** False when editing a row this user may not reassign (not the payer, the adder or the owner). */
  canChangePayer?: boolean;
  busy: boolean;
  onSubmit: (request: CreateCrewExpenseRequest) => void;
  onCancel: () => void;
}

const centsToText = (cents: number) => (cents / 100).toFixed(2);

export default function ExpenseForm({
  members,
  currentUserId,
  currency,
  initial,
  canChangePayer = true,
  busy,
  onSubmit,
  onCancel,
}: Props) {
  const [description, setDescription] = useState(initial?.description ?? '');
  const [amount, setAmount] = useState(initial ? String(initial.amount) : '');
  const [category, setCategory] = useState<string>(initial?.category ?? 'other');
  const [planned, setPlanned] = useState(initial?.planned === true);
  // Former members cannot be picked or removed in the form and the server rejects them, so drop them on prefill.
  const isMember = (id: string) => members.some((m) => m.userId === id);
  const [paidBy, setPaidBy] = useState(initial?.paid_by && isMember(initial.paid_by) ? initial.paid_by : currentUserId);
  const [splitWith, setSplitWith] = useState<string[]>(
    initial ? initial.split_with.filter(isMember) : members.map((m) => m.userId),
  );
  const initialShares = initial?.split_amounts;
  const [uneven, setUneven] = useState(!!initialShares && Object.keys(initialShares).length > 0);
  const [shareText, setShareText] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(initialShares ?? {}).map(([id, cents]) => [id, centsToText(cents)])),
  );

  const editing = !!initial;
  const payerLocked = editing && !canChangePayer;
  const nameOf = (m: FormMember) => m.name || m.username || 'Crewmate';
  const totalCents = toCents(amount);
  const shares = splitWith.map((userId) => ({ userId, cents: toCents(shareText[userId] ?? '') }));
  const error = uneven && totalCents > 0 ? sharesError(totalCents, shares, currency) : null;
  const assigned = shares.reduce((sum, s) => sum + s.cents, 0);

  function toggleMember(uid: string) {
    setSplitWith((prev) => (prev.includes(uid) ? prev.filter((id) => id !== uid) : [...prev, uid]));
  }

  function startUneven() {
    setShareText(Object.fromEntries(evenShares(totalCents, splitWith).map((s) => [s.userId, centsToText(s.cents)])));
    setUneven(true);
  }

  const canSubmit = !!description.trim() && totalCents > 0 && splitWith.length > 0 && !error;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    onSubmit({
      description: description.trim(),
      amount: Number(amount),
      splitWith,
      category,
      planned,
      ...(payerLocked ? {} : { paidBy }),
      ...(uneven ? { shares } : {}),
    });
  }

  const evenHint =
    splitWith.length > 0 && totalCents > 0
      ? `${formatCents(evenShares(totalCents, splitWith)[0]?.cents ?? 0, currency)} each × ${splitWith.length}`
      : null;

  return (
    <form onSubmit={submit} className="p-3 rounded-lg bg-bg-card border border-border space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-text-primary">{editing ? 'Edit expense' : 'New expense'}</h3>
        <IconButton label="Cancel" icon={<X className="w-5 h-5" />} onClick={onCancel} />
      </div>
      <Input
        label="Description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Dinner at the food truck"
        required
        maxLength={200}
      />
      <Input
        label="Amount"
        type="number"
        inputMode="decimal"
        step="0.01"
        min="0.01"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        placeholder="0.00"
        required
      />
      <div>
        <label htmlFor="expense-paid-by" className="block text-sm font-medium text-text-primary mb-2">
          Paid by
        </label>
        <select
          id="expense-paid-by"
          value={paidBy}
          onChange={(e) => setPaidBy(e.target.value)}
          disabled={payerLocked}
          aria-describedby={payerLocked ? 'expense-paid-by-hint' : undefined}
          className={cn(inputBase, 'min-h-11')}
        >
          <option value={currentUserId}>You</option>
          {members
            .filter((m) => m.userId !== currentUserId)
            .map((m) => (
              <option key={m.userId} value={m.userId}>
                {nameOf(m)}
              </option>
            ))}
        </select>
        {payerLocked && (
          <p id="expense-paid-by-hint" className="mt-1 text-xs text-text-muted">
            Only the payer, the person who added this, or the crew owner can change who paid.
          </p>
        )}
      </div>
      <div>
        <span id="expense-category-label" className="block text-sm font-medium text-text-primary mb-2">
          Category
        </span>
        <div
          className="crew-category-grid grid grid-cols-3 gap-2"
          role="group"
          aria-labelledby="expense-category-label"
        >
          {EXPENSE_CATEGORIES.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setCategory(c.id)}
              aria-pressed={category === c.id}
              className={cn(
                'min-h-11 px-2 py-2 rounded-lg border text-xs flex flex-col items-center gap-1',
                category === c.id
                  ? 'bg-accent-aqua/15 border-accent-aqua text-accent-aqua'
                  : 'bg-bg-card border-border text-text-secondary hover:border-border-light',
              )}
            >
              <ExpenseIcon icon={c.icon} className="w-5 h-5" />
              {c.label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <span id="expense-split-label" className="block text-sm font-medium text-text-primary mb-2">
          Split between
        </span>
        <div
          className="flex flex-wrap gap-2 max-h-32 overflow-y-auto"
          role="group"
          aria-labelledby="expense-split-label"
        >
          {members.map((m) => {
            const active = splitWith.includes(m.userId);
            return (
              <button
                key={m.userId}
                type="button"
                onClick={() => toggleMember(m.userId)}
                aria-pressed={active}
                className={cn(
                  'min-h-11 px-3 rounded-full border text-sm',
                  active
                    ? 'bg-accent-aqua/15 border-accent-aqua text-accent-aqua'
                    : 'bg-bg-card border-border text-text-secondary',
                )}
              >
                {nameOf(m)}
              </button>
            );
          })}
        </div>
        {!uneven && evenHint && <div className="text-xs text-text-muted mt-1 tabular-nums">{evenHint}</div>}
        {uneven ? (
          <div className="mt-2 space-y-2">
            {members
              .filter((m) => splitWith.includes(m.userId))
              .map((m) => (
                <Input
                  key={m.userId}
                  label={nameOf(m)}
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0.01"
                  value={shareText[m.userId] ?? ''}
                  onChange={(e) => setShareText((prev) => ({ ...prev, [m.userId]: e.target.value }))}
                  placeholder="0.00"
                />
              ))}
            <div className="text-xs text-text-muted tabular-nums">
              {assigned === totalCents
                ? `Adds up to ${formatCents(totalCents, currency)}`
                : `Left to assign: ${formatCents(totalCents - assigned, currency)}`}
            </div>
            {error && (
              <div role="alert" className="text-xs text-[var(--color-text-danger)]">
                {error}
              </div>
            )}
            <button
              type="button"
              onClick={() => setUneven(false)}
              className="min-h-11 text-sm text-accent-aqua underline underline-offset-2"
            >
              Split evenly
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={startUneven}
            className="min-h-11 text-sm text-accent-aqua underline underline-offset-2"
          >
            Split unevenly
          </button>
        )}
      </div>
      {/* Planned = budget/forecast row. Excluded from balances + settle-up. */}
      <label className="flex items-start gap-2 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={planned}
          onChange={(e) => setPlanned(e.target.checked)}
          className="mt-0.5 h-4 w-4 accent-accent-aqua"
        />
        <span className="text-sm text-text-primary">
          Planned expense <span className="text-text-muted">(budget only — won't affect who owes what)</span>
        </span>
      </label>
      <Button type="submit" variant="primary" isLoading={busy} className="w-full min-h-11" disabled={!canSubmit}>
        {editing ? 'Save changes' : 'Add'}
      </Button>
    </form>
  );
}
