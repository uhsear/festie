import type { Meta, StoryObj } from '@storybook/react-vite';
import ThemeSection from './ThemeSection';

const meta = {
  title: 'Account/ThemeSection',
  component: ThemeSection,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
} satisfies Meta<typeof ThemeSection>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
