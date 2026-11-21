import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import Sheet from './Sheet';
import Button from './Button';

const meta = {
  title: 'UI/Sheet',
  component: Sheet,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div style={{ minHeight: 400 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Sheet>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    open: true,
    onOpenChange: fn(),
    title: 'Join a crew',
    description: 'Enter the code a crew member shared with you.',
    children: <p className="text-sm text-text-secondary">Codes are six characters long.</p>,
  },
};

export const NonModal: Story = {
  args: {
    open: true,
    onOpenChange: fn(),
    modal: false,
    title: 'Pending sync',
    description: 'Changes made offline are waiting to upload.',
    children: <p className="text-sm text-text-secondary">2 changes queued.</p>,
  },
};

export const Interactive: Story = {
  args: { open: false, onOpenChange: fn(), title: 'Interactive', children: null },
  render: () => {
    const [open, setOpen] = useState(false);
    return (
      <>
        <Button variant="primary" onClick={() => setOpen(true)}>
          Open sheet
        </Button>
        <Sheet open={open} onOpenChange={setOpen} title="Filters" description="Choose which sets to show.">
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Done
          </Button>
        </Sheet>
      </>
    );
  },
};
