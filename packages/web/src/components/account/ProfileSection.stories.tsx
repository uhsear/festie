import type { Meta, StoryObj } from '@storybook/react-vite';
import { ToastProvider } from '../../lib/toastContext';
import ProfileSection from './ProfileSection';

const meta = {
  title: 'Account/ProfileSection',
  component: ProfileSection,
  tags: ['autodocs'],
  args: { user: { name: 'Ada Lovelace', username: 'ada' } },
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <ToastProvider>
        <Story />
      </ToastProvider>
    ),
  ],
} satisfies Meta<typeof ProfileSection>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const NoDisplayName: Story = {
  args: { user: { username: 'ada' } },
};
