import type { CrewExpense } from '@festie/shared/types';
import { describePayment, paymentStatusLine } from '@festie/shared/utils';
import Button from '../ui/Button';

interface PaymentsListProps {
  payments: CrewExpense[];
  members: { userId: string; username?: string; name?: string }[];
  currentUserId: string;
  currency: string;
  nameOf: (userId: string) => string | undefined;
  undoPending: boolean;
  onUndo: (payment: CrewExpense) => void;
}

export default function PaymentsList({
  payments,
  members,
  currentUserId,
  currency,
  nameOf,
  undoPending,
  onUndo,
}: PaymentsListProps) {
  return (
  <div className="space-y-2">
    <div>
      <h3 className="text-xs text-text-muted uppercase tracking-wide">Payments</h3>
      <p className="text-xs text-text-secondary">Settle-up payments. Not counted in Total spent.</p>
    </div>
    {payments.map((p) => (
      <div
        key={p.id}
        className="p-3 rounded-xl bg-bg-card border border-glass-border flex items-center justify-between gap-3"
      >
        <div className="min-w-0">
          <div className="text-sm text-text-primary">{describePayment(p, currentUserId, nameOf, currency)}</div>
          {paymentStatusLine(p, members, currentUserId) && (
            <div className="text-xs text-text-secondary">{paymentStatusLine(p, members, currentUserId)}</div>
          )}
        </div>
        {p.paid_by === currentUserId && !p._optimistic && (
          <Button
            variant="ghost"
            onClick={() => onUndo(p)}
            disabled={undoPending}
            className="!py-1 !px-3 text-xs min-h-11"
          >
            Undo payment
          </Button>
        )}
      </div>
    ))}
  </div>
  );
}
