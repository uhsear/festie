import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...rest }: { to: string; children: React.ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('./MembersTab', () => ({ default: () => null }));
vi.mock('./MeetingPointsTab', () => ({ default: () => <div data-testid="meeting-points" /> }));
vi.mock('./PollsTab', () => ({ default: () => <button type="button">Create poll</button> }));
vi.mock('./PackingTab', () => ({ default: () => null }));
vi.mock('./RidesTab', () => ({ default: () => null }));
vi.mock('./ExpensesTab', () => ({ default: () => null }));
vi.mock('./ActivityTab', () => ({ default: () => null }));

import CrewTabContent from './CrewTabContent';

const props = {
  crewId: 'c1',
  currentUserId: 'u1',
  isOwner: true,
  isAdmin: false,
  adminAddBusy: false,
  members: [],
  onForceAdd: vi.fn(),
  onTransferOwnership: vi.fn(),
};

describe('CrewTabContent Plan tab', () => {
  it('shows the two page links as quiet navigation rows, leaving Create poll the one filled action', () => {
    render(<CrewTabContent {...props} tab="plan" />);
    for (const name of ["View your crew's plan", 'Compare crew schedules']) {
      const link = screen.getByRole('link', { name });
      expect(link).toHaveClass('bg-bg-card', 'border', 'min-h-11');
      expect(link.className).not.toMatch(/bg-accent-aqua(?!\/)/);
    }
  });

  it('gives both rows the same shape so their edges line up', () => {
    render(<CrewTabContent {...props} tab="plan" />);
    expect(screen.getByRole('link', { name: "View your crew's plan" }).className).toBe(
      screen.getByRole('link', { name: 'Compare crew schedules' }).className,
    );
  });
});

describe('CrewTabContent Find tab', () => {
  it('renders the lead rows above the meeting points', () => {
    render(<CrewTabContent {...props} tab="find" findLead={<div data-testid="lead" />} />);
    const lead = screen.getByTestId('lead');
    expect(lead.compareDocumentPosition(screen.getByTestId('meeting-points')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
