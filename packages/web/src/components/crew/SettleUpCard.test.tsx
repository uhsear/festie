import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CrewSettlement } from '@festie/shared/types';
import SettleUpCard from './SettleUpCard';

const owe: CrewSettlement = { fromUserId: 'me', fromName: 'Me', toUserId: 'u2', toName: 'Kai', amountCents: 500, amount: 5, payeeHandles: { venmo: null, cashapp: null, paypal: null } };
const owed: CrewSettlement = { fromUserId: 'u3', fromName: 'Mira', toUserId: 'me', toName: 'Me', amountCents: 300, amount: 3, payeeHandles: { venmo: null, cashapp: null, paypal: null } };

const setup = (over: Partial<Parameters<typeof SettleUpCard>[0]> = {}) => {
  const props = {
    myPayments: [owe],
    myReceipts: [owed],
    nonZeroBalances: [],
    settleView: 'fewest' as const,
    onSettleViewChange: vi.fn(),
    currentUserId: 'me',
    currency: 'USD',
    settlePending: false,
    remindPending: false,
    onPay: vi.fn(),
    onRemind: vi.fn(),
    ...over,
  };
  render(<SettleUpCard {...props} />);
  return props;
};

describe('SettleUpCard', () => {
  it('records a payment and sends a reminder', async () => {
    const props = setup();
    await userEvent.click(screen.getByRole('button', { name: /I've paid Kai/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Remind Mira' }));
    expect(props.onPay).toHaveBeenCalledWith(owe);
    expect(props.onRemind).toHaveBeenCalledWith('u3', 'Mira');
  });

  it('disables Remind and says Reminded today once that person was reminded', () => {
    setup({ remindedUserIds: new Set(['u3']) });
    expect(screen.getByRole('button', { name: 'Reminded today' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Remind Mira' })).toBeNull();
  });

  it('says so when nothing is owed', () => {
    setup({ myPayments: [], myReceipts: [] });
    expect(screen.getByText("You're all settled up.")).toBeInTheDocument();
  });

  it('shows a zero message in the everyone view', () => {
    setup({ settleView: 'everyone' });
    expect(screen.getByText("Everyone's balance is zero.")).toBeInTheDocument();
  });
});
