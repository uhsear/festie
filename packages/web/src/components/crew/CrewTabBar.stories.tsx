import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import type { CrewTabKey } from '@festie/shared/utils';
import CrewTabBar from './CrewTabBar';

const meta = {
  title: 'Crew/CrewTabBar',
  component: CrewTabBar,
  tags: ['autodocs'],
  args: { activeTab: 'find', onTabChange: fn() },
  parameters: { layout: 'padded' },
  // The tabs point at the panel the crew page renders; give them a target.
  decorators: [
    (Story, { args }) => (
      <>
        <Story />
        <div id="crew-tab-panel" role="tabpanel" aria-labelledby={`crew-tab-${args.activeTab}`} className="p-3 text-sm text-text-secondary">
          Tab content
        </div>
      </>
    ),
  ],
} satisfies Meta<typeof CrewTabBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithBadges: Story = {
  args: { activeTab: 'plan', badges: { members: 3, money: true } },
};

export const Interactive: Story = {
  render: (args) => {
    const [tab, setTab] = useState<CrewTabKey>('find');
    return <CrewTabBar {...args} activeTab={tab} onTabChange={setTab} />;
  },
};
