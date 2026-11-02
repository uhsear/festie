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
