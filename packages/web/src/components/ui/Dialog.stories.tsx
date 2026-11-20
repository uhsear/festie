import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import Dialog from './Dialog';
import Button from './Button';

const meta = {
  title: 'UI/Dialog',
  component: Dialog,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div style={{ minHeight: 400 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Dialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    open: true,
    onOpenChange: fn(),
    title: 'Share your plan',
    description: 'Anyone with the link can see which sets you picked.',
    children: <p className="text-sm text-text-secondary">Link sharing can be turned off at any time.</p>,
  },
};

export const HiddenDescription: Story = {
  args: {
    open: true,
    onOpenChange: fn(),
    title: 'Crew code',
    description: 'The invite code for this crew.',
    hideDescription: true,
    children: <p className="font-mono text-lg text-text-primary">FEST-2026</p>,
  },
};

export const CloseDisabled: Story = {
  args: {
    open: true,
    onOpenChange: fn(),
    title: 'Saving',
    closeDisabled: true,
    children: <p className="text-sm text-text-secondary">Keep this open until the save finishes.</p>,
  },
};

export const Interactive: Story = {
  args: { open: false, onOpenChange: fn(), title: 'Interactive', children: null },
  render: () => {
    const [open, setOpen] = useState(false);
    return (
      <>
        <Button variant="primary" onClick={() => setOpen(true)}>
          Open dialog
        </Button>
        <Dialog open={open} onOpenChange={setOpen} title="Leave crew?" description="You can rejoin with the invite code.">
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Stay
          </Button>
        </Dialog>
      </>
    );
  },
};
