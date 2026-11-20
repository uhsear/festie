import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import type { CrewTabKey } from '@festie/shared/utils';
import CrewTabBar from './CrewTabBar';

// The tabs point at the panel the crew page renders; give them a target.
function Panel({ tab }: { tab: CrewTabKey }) {
  return (
    <div id="crew-tab-panel" role="tabpanel" aria-labelledby={`crew-tab-${tab}`} className="p-3 text-sm text-text-secondary">
      Tab content
    </div>
  );
}

const meta = {
  title: 'Crew/CrewTabBar',
  component: CrewTabBar,
  tags: ['autodocs'],
  args: { activeTab: 'find', onTabChange: fn() },
  parameters: { layout: 'padded' },
} satisfies Meta<typeof CrewTabBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <>
      <CrewTabBar {...args} />
      <Panel tab={args.activeTab} />
    </>
  ),
};

export const WithBadges: Story = {
  args: { activeTab: 'plan', badges: { members: 3, money: true } },
  render: Default.render,
};

export const Interactive: Story = {
  render: (args) => {
    const [tab, setTab] = useState<CrewTabKey>('find');
    return (
      <>
        <CrewTabBar {...args} activeTab={tab} onTabChange={setTab} />
        <Panel tab={tab} />
      </>
    );
  },
};
