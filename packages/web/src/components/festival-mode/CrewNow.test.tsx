import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CrewWhereabout } from '@festie/shared/utils';

vi.mock('../crew/ReformCrewButton', () => ({ default: () => <div data-testid="reform-crew" /> }));

import { CrewNowSection, CrewWrapUpCard } from './CrewNow';

const makeRows = (n: number): CrewWhereabout[] =>
  Array.from({ length: n }, (_, i) => ({
    userId: `u${i}`,
    name: `Member ${i}`,
    statusLabel: null,
    statusAt: null,
    live: null,
    liveAt: null,
    sos: false,
  }));

describe('CrewNowSection', () => {
  it('expands and collapses the crew list', async () => {
    render(<CrewNowSection crewName="Crew" rows={makeRows(8)} onOpenCrew={() => {}} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
    const btn = screen.getByRole('button', { name: 'Show 3 more' });
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(btn);
    expect(screen.getAllByRole('listitem')).toHaveLength(8);
    expect(screen.getByRole('button', { name: 'Show fewer' })).toBeInTheDocument();
  });

  it('shows no toggle with 5 rows', () => {
    render(<CrewNowSection crewName="Crew" rows={makeRows(5)} onOpenCrew={() => {}} />);
    expect(screen.queryByRole('button', { name: /Show/ })).toBeNull();
  });
});

describe('CrewWrapUpCard', () => {
  it('shows a settled balance and offers the expenses', () => {
    render(<CrewWrapUpCard crewName="Night Owls" balance={0} onSettle={vi.fn()} crewId="c1" festivalId="f1" />);
    expect(screen.getByText("You're all settled up")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'See expenses' })).toBeInTheDocument();
    expect(screen.getByTestId('reform-crew')).toBeInTheDocument();
  });
});
