import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

// The crew page lays every card on the 24px page gutter. A tab that adds its own
// `px-4` wrapper shifts its cards 12-16px off the tab bar and the cards above.
const TABS = [
  'MeetingPointsTab',
  'MembersTab',
  'ExpensesTab',
  'PollsTab',
  'PackingTab',
  'RidesTab',
  'ActivityTab',
];

describe('crew tab gutter', () => {
  it.each(TABS)('%s does not inset itself from the page gutter', (name) => {
    const src = readFileSync(new URL(`./${name}.tsx`, import.meta.url), 'utf8');
    expect(src).not.toMatch(/<(div|SkeletonGroup) className="(space-y-[\d.]+ )?px-4( space-y-[\d.]+)?"/);
  });
});
