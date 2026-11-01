import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../crew/ReformCrewButton', () => ({ default: () => <div data-testid="reform-crew" /> }));

import { CrewWrapUpCard } from './CrewNow';

describe('CrewWrapUpCard', () => {
  it('shows a settled balance and offers the expenses', () => {
    render(<CrewWrapUpCard crewName="Night Owls" balance={0} onSettle={vi.fn()} crewId="c1" festivalId="f1" />);
    expect(screen.getByText("You're all settled up")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'See expenses' })).toBeInTheDocument();
    expect(screen.getByTestId('reform-crew')).toBeInTheDocument();
  });
});
