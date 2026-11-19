import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CrewMeetingPoint } from '@festie/shared/types';
import MeetingPointCard from './MeetingPointCard';

const point = { id: 'm1', crew_id: 'c1', created_by: 'me', label: 'Gate', location: 'North', type: 'during', meet_at: null, stage_reference: 'Main Stage', coming: ['u2'] } as CrewMeetingPoint;

const setup = (currentUserId: string) => {
  const props = { onToggleComing: vi.fn(), onDirections: vi.fn(), onEdit: vi.fn(), onRemove: vi.fn() };
  render(
    <MeetingPointCard point={point} currentUserId={currentUserId} isOwner={false} festivalDays={[]} festivalTimeZone={undefined} nowMs={Date.now()} {...props} />,
  );
  return props;
};

describe('MeetingPointCard', () => {
  it('shows the stage and who is coming', () => {
    setup('me');
    expect(screen.getByText('Near Main Stage')).toBeInTheDocument();
    expect(screen.getByText('1 coming')).toBeInTheDocument();
  });

  it('lets the creator edit and remove', async () => {
    const props = setup('me');
    await userEvent.click(screen.getByRole('button', { name: 'Edit meeting point' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove meeting point Gate' }));
    await userEvent.click(screen.getByRole('button', { name: "I'll be there: Gate" }));
    expect(props.onEdit).toHaveBeenCalledWith(point);
    expect(props.onRemove).toHaveBeenCalledWith('m1', '"Gate"');
    expect(props.onToggleComing).toHaveBeenCalledWith(point);
  });

  it('hides edit and remove from other members', () => {
    setup('u9');
    expect(screen.queryByRole('button', { name: 'Edit meeting point' })).toBeNull();
  });
});
