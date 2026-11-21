import type { Meta, StoryObj } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '../../lib/toastContext';
import PasswordSection from './PasswordSection';

// useIdentities reads this cache key; seeding it keeps the story off the network.
function withIdentities(hasPassword: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['auth', 'identities'], { hasPassword, identities: [] });
  return client;
}

const meta = {
  title: 'Account/PasswordSection',
  component: PasswordSection,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <QueryClientProvider client={withIdentities(true)}>
        <ToastProvider>
          <Story />
        </ToastProvider>
      </QueryClientProvider>
    ),
  ],
} satisfies Meta<typeof PasswordSection>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
