import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CrewExpense } from '@festie/shared/types';
import PaymentsList from './PaymentsList';

const payment = {
  id: 'p1',
  crew_id: 'c1',
  paid_by: 'me',
  paid_by_name: 'Me',
  description: 'Settle up',
  amount: 5,
  split_with: ['u2'],
  category: 'settlement',
  created_at: new Date().toISOString(),
} as CrewExpense;

describe('PaymentsList', () => {
  it('lets the payer undo their payment', async () => {
    const onUndo = vi.fn();
    render(
      <PaymentsList payments={[payment]} members={[]} currentUserId="me" currency="USD" nameOf={() => 'Kai'} undoPending={false} onUndo={onUndo} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Undo payment' }));
    expect(onUndo).toHaveBeenCalledWith(payment);
  });

  it('hides undo for other payers', () => {
    render(
      <PaymentsList payments={[payment]} members={[]} currentUserId="u2" currency="USD" nameOf={() => 'Kai'} undoPending={false} onUndo={vi.fn()} />,
    );
    expect(screen.queryByRole('button', { name: 'Undo payment' })).toBeNull();
  });
});
