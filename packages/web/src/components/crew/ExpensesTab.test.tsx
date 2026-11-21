import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api } from '@festie/shared';
import { useCrewStore } from '@festie/shared/stores';
import ExpensesTab from './ExpensesTab';

vi.mock('../../lib/toastContext', () => ({
  useToast: () => ({ toast: vi.fn(), toastError: vi.fn(), toastUndo: vi.fn() }),
}));

const members = [
  { userId: 'me', username: 'me', name: 'Me' },
  { userId: 'sam', username: 'sam', name: 'Sam' },
];

const expense = (over: Record<string, unknown>) => ({
  id: 'e1',
  crew_id: 'crew-1',
  paid_by: 'sam',
  created_by: 'sam',
  paid_by_name: 'Sam',
  description: 'Groceries',
  amount: 40,
  split_with: ['me', 'sam'],
  split_amounts: null,
  category: 'food',
  planned: false,
  created_at: '2026-07-01T00:00:00Z',
  ...over,
});

const plan = {
  currency: 'USD',
  balances: [
    { userId: 'me', username: 'me', balance: -20 },
    { userId: 'sam', username: 'sam', balance: 20 },
  ],
  settlements: [
    {
      fromUserId: 'me',
      fromName: 'Me',
      toUserId: 'sam',
      toName: 'Sam',
      amountCents: 2000,
      amount: 20,
      payeeHandles: {},
    },
  ],
};

function mockApi(expenses: unknown[], settlementPlan: unknown = plan) {
  vi.spyOn(api, 'get').mockImplementation((async (path: string) =>
    path.endsWith('/settlement-plan') ? settlementPlan : expenses) as never);
}

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ExpensesTab crewId="crew-1" members={members} currentUserId="me" />
    </QueryClientProvider>,
  );
}

describe('ExpensesTab', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useCrewStore.setState({ activeCrew: { id: 'crew-1', owner: 'sam' } } as never);
  });

  it('shows the currency label and no filter tabs with no expenses', async () => {
    mockApi([], { currency: 'USD', balances: [], settlements: [] });
    setup();
    expect(await screen.findByText('Amounts in USD')).toBeInTheDocument();
    expect(screen.queryByRole('tablist', { name: 'Filter expenses' })).not.toBeInTheDocument();
  });

  it('shows an error state with Retry when the load fails and nothing is cached', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new Error('boom'));
    setup();
    expect(await screen.findByText("Couldn't load expenses")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('says the device is offline when the load fails on a network error', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(Object.assign(new Error('Failed to fetch'), { name: 'ApiClientError', status: 0, isNetworkError: true }));
    setup();
    expect(await screen.findByText("You're offline. Check your connection and try again.")).toBeInTheDocument();
  });

  it('shows total spent and who I owe', async () => {
    mockApi([expense({})]);
    setup();
    expect(await screen.findByText('Total spent')).toBeInTheDocument();
    expect(await screen.findByText('You owe Sam $20.00')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /paid Sam/ })).toBeInTheDocument();
  });

  it('records a payment only after confirming the dialog', async () => {
    mockApi([expense({})]);
    const settleExpense = vi.fn().mockResolvedValue('sent');
    useCrewStore.setState({ settleExpense } as never);
    setup();
    await userEvent.click(await screen.findByRole('button', { name: /paid Sam/ }));
    expect(await screen.findByRole('dialog', { name: 'Record payment' })).toBeInTheDocument();
    expect(settleExpense).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Yes, I paid' }));
    await waitFor(() => expect(settleExpense).toHaveBeenCalledWith('crew-1', { toUserId: 'sam', amount: 20 }));
  });

  it('removes my own expense after confirming', async () => {
    mockApi([expense({ paid_by: 'me', created_by: 'me', paid_by_name: 'Me' })]);
    const del = vi.spyOn(api, 'delete').mockResolvedValue({} as never);
    setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Remove expense' }));
    expect(del).not.toHaveBeenCalled();
    await userEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(del).toHaveBeenCalledWith('/crews/crew-1/expenses/e1'));
  });

  it('adds an expense through the form', async () => {
    mockApi([]);
    const post = vi.spyOn(api, 'post').mockResolvedValue({ id: 'e9' } as never);
    setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Add Expense' }));
    await userEvent.type(screen.getByLabelText('Description'), 'Gas');
    await userEvent.type(screen.getByLabelText('Amount'), '60');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/crews/crew-1/expenses', {
        description: 'Gas',
        amount: 60,
        splitWith: ['me', 'sam'],
        category: 'other',
        planned: false,
        paidBy: 'me',
      }),
    );
  });

  it('filters the ledger between actual and planned and tracks aria-selected', async () => {
    mockApi([expense({}), expense({ id: 'e2', description: 'Tent budget', planned: true, amount: 100 })]);
    setup();
    const tablist = await screen.findByRole('tablist', { name: 'Filter expenses' });
    expect(tablist.querySelectorAll('[role="tab"]')).toHaveLength(3);
    expect(screen.getByRole('tab', { name: 'actual' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByText('Groceries')).toBeInTheDocument();
    expect(screen.queryByText('Tent budget')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: 'planned' }));
    expect(screen.getByRole('tab', { name: 'planned' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'actual' })).toHaveAttribute('aria-selected', 'false');
    expect(await screen.findByText('Tent budget')).toBeInTheDocument();
    expect(screen.queryByText('Groceries')).not.toBeInTheDocument();
  });

  it('switches the settle-up tablist to the per-member balances', async () => {
    mockApi([expense({})]);
    setup();
    const everyone = await screen.findByRole('tab', { name: "Everyone's balance" });
    expect(screen.getByRole('tab', { name: 'Fewest payments' })).toHaveAttribute('aria-selected', 'true');
    await userEvent.click(everyone);
    expect(everyone).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByText('You owe Sam $20.00')).not.toBeInTheDocument();
    expect(screen.getByText('You owe $20.00')).toBeInTheDocument();
    expect(screen.getByText('sam is owed $20.00')).toBeInTheDocument();
  });

  it('moves between filter tabs with ArrowRight', async () => {
    mockApi([expense({})]);
    setup();
    const actual = await screen.findByRole('tab', { name: 'actual' });
    actual.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'planned' })).toHaveFocus();
    expect(screen.getByRole('tab', { name: 'planned' })).toHaveAttribute('aria-selected', 'true');
  });

  it('moves between settle-up tabs with ArrowRight', async () => {
    mockApi([expense({})]);
    setup();
    const fewest = await screen.findByRole('tab', { name: 'Fewest payments' });
    fewest.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: "Everyone's balance" })).toHaveFocus();
    expect(screen.getByRole('tab', { name: "Everyone's balance" })).toHaveAttribute('aria-selected', 'true');
  });

  it('says all settled up when the plan has no transfer for me', async () => {
    mockApi([expense({})], {
      currency: 'USD',
      balances: [{ userId: 'sam', username: 'sam', balance: 0.5 }],
      settlements: [],
    });
    setup();
    expect(await screen.findByText("You're all settled up.")).toBeInTheDocument();
  });
});
