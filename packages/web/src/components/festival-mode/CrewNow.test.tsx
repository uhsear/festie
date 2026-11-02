import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CrewWhereabout } from '@festie/shared/utils';
import { CrewNowSection } from './CrewNow';

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
