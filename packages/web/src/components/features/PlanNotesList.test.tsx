import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { PlanListItem } from '@festie/shared/utils';
import type { FestivalSet } from '@festie/shared/types';
import PlanNotesList from './PlanNotesList';

vi.mock('@festie/shared/stores', () => ({
  useFestivalStore: vi.fn((sel: (s: Record<string, unknown>) => unknown) =>
    sel({ currentFestival: { b2bSeparator: undefined } }),
  ),
}));

vi.mock('@festie/shared/hooks', () => ({
  useFestival: vi.fn(() => ({ getStageName: () => 'Main Stage' })),
}));

vi.mock('@festie/shared/utils', () => ({
  artistDisplayName: (set: { artist?: string }) => set.artist ?? 'Unknown',
  formatTime: (t: string) => t,
  reminderLeadLabel: (m: number) => `${m} min before`,
}));

const days = [{ date: '2026-06-10', label: 'Friday' }];
const setA = { id: 'a', artist: 'Fisher', stageId: 'st1', startTime: '21:00' } as FestivalSet;
const setB = { id: 'b', artist: 'Four Tet', stageId: 'st1' } as FestivalSet;
const items: PlanListItem[] = [
  { set: setA, dayIndex: 0, note: 'Bring water', reminderMinutes: 30, priority: 'must' },
  { set: setB, dayIndex: null, note: 'Second line', reminderMinutes: 10, priority: null },
];

describe('PlanNotesList', () => {
  it('renders day headings, the lead label and the stage line for reminders', () => {
    render(<PlanNotesList kind="reminders" items={items} days={days} onOpenSet={vi.fn()} />);
    expect(screen.getByRole('region', { name: 'Friday' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Unscheduled' })).toBeInTheDocument();
    expect(screen.getByText('30 min before')).toBeInTheDocument();
    expect(screen.getByText('21:00 · Main Stage')).toBeInTheDocument();
    expect(screen.queryByText('Bring water')).toBeNull();
  });

  it('renders the note text for notes and opens the set on click', () => {
    const onOpenSet = vi.fn();
    render(<PlanNotesList kind="notes" items={items} days={days} onOpenSet={onOpenSet} />);
    const note = screen.getByText('Bring water');
    expect(note).toHaveClass('line-clamp-3');
    fireEvent.click(note);
    expect(onOpenSet).toHaveBeenCalledWith(setA);
  });

  it('shows the right empty copy per kind', () => {
    const { rerender } = render(<PlanNotesList kind="reminders" items={[]} days={days} onOpenSet={vi.fn()} />);
    expect(screen.getByText('No reminders yet')).toBeInTheDocument();
    expect(screen.getByText('Open a set and use Remind me before it starts.')).toBeInTheDocument();
    rerender(<PlanNotesList kind="notes" items={[]} days={days} onOpenSet={vi.fn()} />);
    expect(screen.getByText('No notes yet')).toBeInTheDocument();
    expect(screen.getByText('Open a set and add a note. It shows here.')).toBeInTheDocument();
  });
});
