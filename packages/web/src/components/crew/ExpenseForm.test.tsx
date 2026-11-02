import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useCrewStore, useFestivalStore } from '@festie/shared/stores';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CrewExpense } from '@festie/shared/types';
import ExpenseForm from './ExpenseForm';

const members = [
  { userId: 'me', username: 'me', name: 'Me' },
  { userId: 'sam', username: 'sam', name: 'Sam' },
  { userId: 'alex', username: 'alex', name: 'Alex' },
];

function setup(props: Partial<React.ComponentProps<typeof ExpenseForm>> = {}) {
  const onSubmit = vi.fn();
  render(
    <ExpenseForm
      members={members}
      currentUserId="me"
      currency="USD"
      busy={false}
      onSubmit={onSubmit}
      onCancel={vi.fn()}
      {...props}
    />,
  );
  return { onSubmit, user: userEvent.setup() };
}

describe('ExpenseForm by days attending', () => {
  const day = (i: number) => ({ id: `d${i}`, dayIndex: i, date: `2026-07-0${i + 1}`, label: `Day ${i + 1}` });

  beforeEach(() => {
    useFestivalStore.setState({ days: [day(0), day(1), day(2)] } as never);
    useCrewStore.setState({
      crewDays: [
        { userId: 'sam', dayIndex: 0, answer: 'no' },
        { userId: 'sam', dayIndex: 1, answer: 'no' },
        { userId: 'alex', dayIndex: 0, answer: 'no' },
        { userId: 'alex', dayIndex: 1, answer: 'no' },
        { userId: 'alex', dayIndex: 2, answer: 'no' },
      ],
    });
  });
  afterEach(() => {
    useFestivalStore.setState({ days: [] } as never);
    useCrewStore.setState({ crewDays: [] });
  });

  it('fills shares by days, drops a zero-day member and says so', async () => {
    const { user, onSubmit } = setup();
    await user.type(screen.getByLabelText('Description'), 'Gas');
    await user.type(screen.getByLabelText('Amount'), '40');
    await user.click(screen.getByRole('button', { name: 'Split unevenly' }));
    await user.click(screen.getByRole('button', { name: 'By days attending' }));
    expect(screen.getByLabelText('Me')).toHaveValue(30);
    expect(screen.getByLabelText('Sam')).toHaveValue(10);
    expect(screen.queryByLabelText('Alex')).not.toBeInTheDocument();
    expect(screen.getByText('Alex not there any day, so not in this split.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        splitWith: ['me', 'sam'],
        shares: [
          { userId: 'me', cents: 3000 },
          { userId: 'sam', cents: 1000 },
        ],
      }),
    );
  });

  it('hides the button when nobody in the split has answered', async () => {
    useCrewStore.setState({ crewDays: [] });
    const { user } = setup();
    await user.type(screen.getByLabelText('Amount'), '40');
    await user.click(screen.getByRole('button', { name: 'Split unevenly' }));
    expect(screen.queryByRole('button', { name: 'By days attending' })).not.toBeInTheDocument();
  });
});

describe('ExpenseForm', () => {
  it('blocks an uneven split that does not add up and shows why', async () => {
    const { user } = setup();
    await user.type(screen.getByLabelText('Description'), 'Gas');
    await user.type(screen.getByLabelText('Amount'), '60');
    await user.click(screen.getByRole('button', { name: 'Split unevenly' }));
    const me = screen.getByLabelText('Me');
    await user.clear(me);
    await user.type(me, '19');
    await user.clear(screen.getByLabelText('Sam'));
    await user.type(screen.getByLabelText('Sam'), '20');
    await user.clear(screen.getByLabelText('Alex'));
    await user.type(screen.getByLabelText('Alex'), '20');
    expect(screen.getByRole('alert')).toHaveTextContent(
      'These shares add up to $59.00. They need to add up to $60.00.',
    );
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled();
  });

  it('submits paidBy, splitWith and shares in cents', async () => {
    const { user, onSubmit } = setup();
    await user.type(screen.getByLabelText('Description'), 'Gas');
    await user.type(screen.getByLabelText('Amount'), '60');
    await user.selectOptions(screen.getByLabelText('Paid by'), 'sam');
    await user.click(screen.getByRole('button', { name: 'Split unevenly' }));
    for (const [label, value] of [
      ['Me', '10'],
      ['Sam', '20'],
      ['Alex', '30'],
    ] as const) {
      await user.clear(screen.getByLabelText(label));
      await user.type(screen.getByLabelText(label), value);
    }
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        paidBy: 'sam',
        splitWith: ['me', 'sam', 'alex'],
        amount: 60,
        shares: [
          { userId: 'me', cents: 1000 },
          { userId: 'sam', cents: 2000 },
          { userId: 'alex', cents: 3000 },
        ],
      }),
    );
  });

  it('starts "Paid by" on You and omits shares for an even split', async () => {
    const { user, onSubmit } = setup();
    expect(screen.getByLabelText('Paid by')).toHaveValue('me');
    await user.type(screen.getByLabelText('Description'), 'Tent');
    await user.type(screen.getByLabelText('Amount'), '30');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(onSubmit.mock.calls[0]?.[0]).not.toHaveProperty('shares');
  });

  it('prefills an edit from split_amounts', () => {
    const initial: CrewExpense = {
      id: 'e1',
      crew_id: 'c1',
      paid_by: 'sam',
      paid_by_name: 'Sam',
      description: 'Gas',
      amount: 60,
      split_with: ['me', 'sam'],
      split_amounts: { me: 4000, sam: 2000 },
      category: 'transport',
      created_at: '2026-07-01T00:00:00.000Z',
    };
    setup({ initial });
    expect(screen.getByText('Edit expense')).toBeInTheDocument();
    expect(screen.getByLabelText('Paid by')).toHaveValue('sam');
    expect(screen.getByLabelText('Me')).toHaveValue(40);
    expect(screen.getByLabelText('Sam')).toHaveValue(20);
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();
  });

  it('drops a former member from an edit so it can be saved', async () => {
    const initial: CrewExpense = {
      id: 'e2',
      crew_id: 'c1',
      paid_by: 'gone',
      paid_by_name: 'Gone',
      description: 'Ice',
      amount: 30,
      split_with: ['me', 'sam', 'gone'],
      category: 'food',
      created_at: '2026-07-01T00:00:00.000Z',
    };
    const { user, onSubmit } = setup({ initial });
    expect(screen.getByLabelText('Paid by')).toHaveValue('me');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ paidBy: 'me', splitWith: ['me', 'sam'] }));
  });

  it('locks "Paid by" and leaves the payer out when this user may not change it', async () => {
    const initial: CrewExpense = {
      id: 'e3',
      crew_id: 'c1',
      paid_by: 'sam',
      paid_by_name: 'Sam',
      description: 'Ice',
      amount: 30,
      split_with: ['me', 'sam'],
      category: 'food',
      created_at: '2026-07-01T00:00:00.000Z',
    };
    const { user, onSubmit } = setup({ initial, canChangePayer: false });
    expect(screen.getByLabelText('Paid by')).toBeDisabled();
    expect(
      screen.getByText('Only the payer, the person who added this, or the crew owner can change who paid.'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty('paidBy');
  });
});
