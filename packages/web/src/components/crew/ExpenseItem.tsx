import React from 'react';
import { Trash2 } from 'lucide-react';
import { formatAmount } from '@festie/shared/utils';
import type { EXPENSE_CATEGORIES } from '@festie/shared/constants';
import IconButton from '../ui/IconButton';
import SyncMarker from './SyncMarker';
import { ExpenseIcon } from '../../lib/expenseIcon';

type CategoryDef = (typeof EXPENSE_CATEGORIES)[number];

export interface ExpenseItemProps {
  id: string;
  index: number;
  description: string;
  amount: string | number;
  paidByName: string;
  paidByMe: boolean;
  splitCount: number;
  category: CategoryDef;
  /** Planned/budget row — forecast only, excluded from settle-up. */
  planned?: boolean;
  /** Offline-queued create: not on the server yet (id is the queue clientId). */
  optimistic?: boolean;
  onRemove: (id: string) => void;
  isRemoving: boolean;
}

export default function ExpenseItem({
  id,
  index,
  description,
  amount,
  paidByName,
  paidByMe,
  splitCount,
  category,
  planned,
  optimistic,
  onRemove,
  isRemoving,
}: ExpenseItemProps) {
  return (
    <div
      className="stagger-item p-3 rounded-lg bg-bg-card border border-glass-border flex items-start gap-3 motion-reduce:!animate-none"
      style={{ '--i': Math.min(index, 6) } as React.CSSProperties}
    >
      <span className="text-text-secondary leading-none mt-0.5">
        <ExpenseIcon icon={category.icon} />
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <div className="font-semibold text-text-primary truncate">{description}</div>
          {planned && (
            <span className="shrink-0 px-1.5 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide bg-accent-aqua/15 text-accent-aqua border border-accent-aqua/40">
              Planned
            </span>
          )}
        </div>
        <div className="text-xs text-text-secondary">
          <span className="tabular-nums">{formatAmount(amount)}</span> {'·'}{' '}
          {planned ? 'planned' : `${paidByMe ? 'You' : paidByName} paid`}
          {splitCount > 0 && ` · split ${splitCount} ${splitCount === 1 ? 'way' : 'ways'}`}
        </div>
        <SyncMarker item={{ id, _optimistic: optimistic }} />
      </div>
      {/* A queued create has no server id yet, so it cannot be deleted. */}
      {paidByMe && !optimistic && (
        <IconButton
          label="Remove expense"
          variant="danger"
          icon={<Trash2 className="w-4 h-4" />}
          onClick={() => onRemove(id)}
          disabled={isRemoving}
        />
      )}
    </div>
  );
}
