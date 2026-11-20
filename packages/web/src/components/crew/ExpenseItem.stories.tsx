import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { EXPENSE_CATEGORIES } from '@festie/shared/constants';
import ExpenseItem from './ExpenseItem';

const meta = {
  title: 'Crew/ExpenseItem',
  component: ExpenseItem,
  tags: ['autodocs'],
  args: {
    id: 'expense-1',
    index: 0,
    description: 'Campsite firewood',
    amount: '24.50',
    paidByName: 'Alex',
    paidByMe: false,
    splitCount: 4,
    category: EXPENSE_CATEGORIES[0],
    shareLine: 'Your share $6.13',
    canRemove: false,
    onRemove: fn(),
    isRemoving: false,
  },
  parameters: { layout: 'padded' },
} satisfies Meta<typeof ExpenseItem>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const PaidByMeEditable: Story = {
  args: { paidByMe: true, canEdit: true, canRemove: true, onEdit: fn(), shareLine: 'Your share $6.13' },
};

export const Planned: Story = {
  args: { planned: true, shareLine: null },
};

export const Optimistic: Story = {
  args: { optimistic: true, paidByMe: true },
};

export const Removing: Story = {
  args: { paidByMe: true, canRemove: true, isRemoving: true },
};
