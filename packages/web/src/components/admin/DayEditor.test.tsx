import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import DayEditor from './DayEditor';

const day = {
  id: 'd1',
  label: 'Friday',
  date: '2026-11-06',
  sets: [
    { id: 's1', artist: 'Alpha', startTime: '20:00' },
    { id: 's2', artist: 'Beta', startTime: '21:00' },
  ],
};

function renderDay(engagement?: Record<string, { picks: number; reminders: number }>) {
  return render(
    <DayEditor
      day={day}
      stages={[]}
      engagement={engagement}
      isExpanded
      onToggleExpand={vi.fn()}
      onLabelChange={vi.fn()}
      onDateChange={vi.fn()}
      onRemoveDay={vi.fn()}
      onAddSet={vi.fn()}
      onRemoveSet={vi.fn()}
      onSetField={vi.fn()}
      onSetArtists={vi.fn()}
    />,
  );
}

const rowOf = (artist: string) => screen.getByDisplayValue(artist).closest('div.grid') as HTMLElement;

describe('DayEditor engagement', () => {
  it('passes each set its own counts', () => {
    renderDay({ s2: { picks: 214, reminders: 61 } });
    expect(within(rowOf('Beta')).getByText('Picked by 214 · 61 reminders')).toBeTruthy();
    expect(within(rowOf('Alpha')).getByText('No picks or reminders yet')).toBeTruthy();
  });

  it('shows no counts before engagement loads', () => {
    renderDay();
    expect(screen.queryByText(/Picked by|No picks/)).toBeNull();
  });
});

describe('DayEditor labels', () => {
  it('names the day and each set in its controls', () => {
    renderDay();
    expect(screen.getByRole('button', { name: 'Remove Friday' })).toBeTruthy();
    expect(screen.getByLabelText('Start time for Alpha')).toBeTruthy();
    expect(screen.getByLabelText('End time for Beta')).toBeTruthy();
    // The visible text below md is "Remove set", so the name starts with it (WCAG 2.5.3).
    expect(screen.getByRole('button', { name: 'Remove set: Alpha' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Collapse Friday' })).toBeTruthy();
    expect(screen.getByLabelText('Day label for Friday')).toBeTruthy();
    expect(screen.getByLabelText('Date for Friday')).toBeTruthy();
  });
});
