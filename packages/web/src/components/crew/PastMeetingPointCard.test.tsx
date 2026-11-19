import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CrewMeetingPoint } from '@festie/shared/types';
import PastMeetingPointCard from './PastMeetingPointCard';

const point = { id: 'm1', crew_id: 'c1', created_by: 'u1', label: 'Gate', location: 'North', type: 'during', meet_at: null, stage_reference: null } as CrewMeetingPoint;

describe('PastMeetingPointCard', () => {
  it('shows the point and opens directions', async () => {
    const onDirections = vi.fn();
    render(<PastMeetingPointCard point={point} onDirections={onDirections} />);
    expect(screen.getByText('Gate')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Directions to Gate' }));
    expect(onDirections).toHaveBeenCalledWith(point);
  });
});
