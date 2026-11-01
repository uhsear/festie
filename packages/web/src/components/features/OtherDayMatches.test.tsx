import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FestivalSet, Stage } from '@festie/shared/types';
import OtherDayMatches from './OtherDayMatches';

const stages = [{ id: 's1', name: 'Main Stage' }] as Stage[];
const sets = [
  { id: 'a', artist: 'Alpha', stageId: 's1', startTime: '21:00', dayIndex: 1 },
  { id: 'b', artist: 'Beta', stageId: 's1', dayIndex: 2 },
] as FestivalSet[];

describe('OtherDayMatches', () => {
  it('renders one group per day with time or TBA', () => {
    render(
      <OtherDayMatches
        groups={[
          { dayIndex: 1, sets: [sets[0]] },
          { dayIndex: 2, sets: [sets[1]] },
        ]}
        dayLabels={{ 1: 'Saturday', 2: 'Sunday' }}
        stages={stages}
        onSelectDay={vi.fn()}
      />,
    );
    expect(screen.getByText('Also on Saturday')).toBeInTheDocument();
    expect(screen.getByText('Also on Sunday')).toBeInTheDocument();
    expect(screen.getByText('Alpha · Main Stage · 9:00 PM')).toBeInTheDocument();
    expect(screen.getByText('Beta · Main Stage · TBA')).toBeInTheDocument();
  });

  it('selects the day on row tap', async () => {
    const onSelectDay = vi.fn();
    render(
      <OtherDayMatches
        groups={[{ dayIndex: 1, sets: [sets[0]] }]}
        dayLabels={{ 1: 'Saturday' }}
        stages={stages}
        onSelectDay={onSelectDay}
      />,
    );
    await userEvent.click(screen.getByLabelText('Show Alpha on Saturday'));
    expect(onSelectDay).toHaveBeenCalledWith(1);
  });

  it('renders nothing for no groups', () => {
    const { container } = render(<OtherDayMatches groups={[]} dayLabels={{}} stages={stages} onSelectDay={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
