import type { CrewSettlement } from '@festie/shared/types';
import { payOptionsFor, settlementSentence, balanceSentence } from '@festie/shared/utils';
import { HandCoins } from 'lucide-react';
import { cn } from '@/lib/utils';
import Button from '../ui/Button';
import SegmentedTablist from '@/components/ui/SegmentedTablist';

export interface Balance {
  userId: string;
  username: string;
  balance: number;
}

type SettleView = 'fewest' | 'everyone';

const SETTLE_VIEWS = [
  { value: 'fewest', label: 'Fewest payments' },
  { value: 'everyone', label: "Everyone's balance" },
] as const;

interface SettleUpCardProps {
  myPayments: CrewSettlement[];
  myReceipts: CrewSettlement[];
  nonZeroBalances: Balance[];
  settleView: SettleView;
  onSettleViewChange: (view: SettleView) => void;
  currentUserId: string;
  currency: string;
  settlePending: boolean;
  remindPending: boolean;
  /** Members already reminded this session; the server allows one reminder per person per day. */
  remindedUserIds?: ReadonlySet<string>;
  onPay: (settlement: CrewSettlement) => void;
  onRemind: (userId: string, name: string) => void;
}

/** One card: toggle between the netted "Fewest payments" plan and every member's balance. */
export default function SettleUpCard({
  myPayments,
  myReceipts,
  nonZeroBalances,
  settleView,
  onSettleViewChange,
  currentUserId,
  currency,
  settlePending,
  remindPending,
  remindedUserIds,
  onPay,
  onRemind,
}: SettleUpCardProps) {
  return (
  <div className="p-3 rounded-lg bg-bg-card border border-border space-y-3">
    <div className="flex items-center justify-between gap-2">
      <div className="text-xs text-text-muted uppercase tracking-wide">Settle up</div>
      <SegmentedTablist
        label="Settle-up view"
        panelId="settle-view-panel"
        options={SETTLE_VIEWS}
        value={settleView}
        onChange={onSettleViewChange}
        className="flex gap-1 rounded-lg bg-bg-secondary"
        tabClassName="px-2.5 py-1 rounded-md"
      />
    </div>

    <div id="settle-view-panel">
    {settleView === 'fewest' ? (
      myPayments.length === 0 && myReceipts.length === 0 ? (
        <div className="text-sm text-text-secondary">You're all settled up.</div>
      ) : (
        <div className="space-y-3">
          {/* You owe {name} — settle-able net transfers. */}
          {myPayments.map((s) => {
            // Step 1: the payee's payment links. Step 2 ("I've paid")
            // records the settlement after a confirm.
            const options = payOptionsFor(s, currency);
            return (
              <div key={`pay-${s.toUserId}`} className="space-y-2">
                <div className="text-sm text-text-primary">{settlementSentence(s, currentUserId, currency)}</div>
                {options.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {options.map((o) => (
                      <a
                        key={o.label}
                        href={o.link.web}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="min-h-11 px-3 py-1 rounded-full border border-border text-xs text-text-primary hover:border-border-light inline-flex items-center"
                      >
                        Pay with {o.label}
                      </a>
                    ))}
                  </div>
                ) : (
                  <div className="text-xs text-text-secondary">
                    {Object.values(s.payeeHandles).some(Boolean)
                      ? `${s.toName}'s payment apps don't support ${currency}. Pay them directly, then confirm here.`
                      : `${s.toName} hasn't added a payment handle. Pay them directly, then confirm here.`}
                  </div>
                )}
                <Button
                  variant="secondary"
                  onClick={() => onPay(s)}
                  disabled={settlePending}
                  className="!py-1 !px-3 text-xs min-h-11"
                >
                  <HandCoins className="w-3.5 h-3.5" aria-hidden="true" /> I've paid {s.toName}
                </Button>
              </div>
            );
          })}
          {/* {name} owes you — the other person settles; I can nudge them. */}
          {myReceipts.map((s) => (
            <div key={`get-${s.fromUserId}`} className="flex items-center justify-between gap-2">
              <span className="text-sm text-text-primary">{settlementSentence(s, currentUserId, currency)}</span>
              <Button
                variant="secondary"
                onClick={() => onRemind(s.fromUserId, s.fromName)}
                disabled={remindPending || !!remindedUserIds?.has(s.fromUserId)}
                className="!py-1 !px-3 text-xs min-h-11"
              >
                {remindedUserIds?.has(s.fromUserId) ? 'Reminded today' : `Remind ${s.fromName}`}
              </Button>
            </div>
          ))}
        </div>
      )
    ) : nonZeroBalances.length > 0 ? (
      <div className="space-y-2">
        {nonZeroBalances.map((b) => (
          <div key={b.userId} className="flex items-center justify-between gap-2">
            <span
              className={cn(
                'text-sm tabular-nums',
                b.balance > 0 ? 'text-accent-aqua' : 'text-[var(--color-text-danger)]',
              )}
            >
              {balanceSentence(b, currentUserId, currency)}
            </span>
          </div>
        ))}
      </div>
    ) : (
      <div className="text-sm text-text-secondary">Everyone's balance is zero.</div>
    )}
    </div>
  </div>
  );
}
