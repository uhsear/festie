import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import FestivalEditForm from './FestivalEditForm';

const toast = vi.fn();
vi.mock('../../lib/toastContext', () => ({ useToast: () => ({ toast, toastError: vi.fn() }) }));

const noChanges = { total: 0, changedSetIds: new Set<string>(), newSetIds: new Set<string>() };

const baseProps = {
  editingId: 'f1',
  changes: noChanges,
  issues: [],
  saving: false,
  onSave: vi.fn(),
  onDiscard: vi.fn(),
  onCancel: vi.fn(),
};

const stages = [
  { id: 'main', name: 'Main stage', color: '#fff' },
  { id: 'tent', name: 'Tent', color: '#000' },
];

const lineup = (expanded = true) => ({
  name: 'Fest',
  stages,
  days: [
    {
      id: 'd1',
      label: 'Friday',
      date: '2026-08-21',
      sets: [
        { id: 's1', artist: 'Kai', stageId: 'main', startTime: '23:45', endTime: '00:30' },
        { id: 's2', artist: 'Mira', stageId: 'tent', startTime: '20:00', endTime: '21:00' },
        { id: 's3', artist: 'Noor', stageId: 'main', startTime: '21:00', endTime: '22:00' },
      ],
    },
  ],
  expanded,
});

const renderForm = (over: Record<string, unknown> = {}) => {
  const setFormData = vi.fn();
  const { expanded, ...formData } = lineup();
  render(
    <FestivalEditForm
      {...baseProps}
      formData={formData}
      setFormData={setFormData}
      initialExpandedDays={expanded ? new Set(['d1']) : undefined}
      {...over}
    />,
  );
  return setFormData;
};

describe('FestivalEditForm B2B separator', () => {
  it('rejoins every B2B set when the separator changes', () => {
    const setFormData = vi.fn();
    const artists = [
      { name: 'Kai', links: { spotify: 'https://s/kai' } },
      { name: 'Mira', links: {} },
    ];
    const formData = {
      name: 'Fest',
      b2bSeparator: 'b2b',
      days: [
        {
          id: 'd1',
          label: 'Friday',
          date: '2026-08-21',
          sets: [
            { id: 's1', artist: 'Kai b2b Mira', artists },
            { id: 's2', artist: 'Solo' },
          ],
        },
      ],
    };
    render(<FestivalEditForm {...baseProps} formData={formData} setFormData={setFormData} />);
    fireEvent.change(screen.getByLabelText('B2B separator'), { target: { value: 'vs' } });
    const next = setFormData.mock.calls.at(-1)![0];
    expect(next.b2bSeparator).toBe('vs');
    expect(next.days[0].sets[0]).toMatchObject({ artist: 'Kai vs Mira', artists });
    expect(next.days[0].sets[1]).toEqual({ id: 's2', artist: 'Solo' });
  });
});

describe('FestivalEditForm lineup tools', () => {
  it('filter hides non-matching rows', () => {
    renderForm();
    expect(screen.getAllByLabelText('Artist')).toHaveLength(3);
    fireEvent.change(screen.getByLabelText('Filter by artist or stage'), { target: { value: 'tent' } });
    const rows = screen.getAllByLabelText('Artist') as HTMLInputElement[];
    expect(rows.map((r) => r.value)).toEqual(['Mira']);
  });

  it('shifts the selected rows through setFormData', () => {
    const setFormData = renderForm();
    fireEvent.click(screen.getByLabelText('Select Mira'));
    fireEvent.click(screen.getByLabelText('Select Noor'));
    expect(screen.getByText('2 selected')).toBeTruthy();
    fireEvent.click(screen.getByText('Shift times'));
    const sets = setFormData.mock.calls.at(-1)![0].days[0].sets;
    expect(sets[0].startTime).toBe('23:45');
    expect(sets[1]).toMatchObject({ startTime: '20:30', endTime: '21:30' });
    expect(sets[2]).toMatchObject({ startTime: '21:30', endTime: '22:30' });
  });

  it('shows a stage issue message and marks the stage select invalid', () => {
    renderForm({
      issues: [
        {
          code: 'set_stage_invalid',
          message: 'Pick a stage for Mira.',
          target: { kind: 'set', setId: 's2', field: 'stageId' },
        },
      ],
    });
    const row = document.querySelector('[data-issue-key="set:s2"]') as HTMLElement;
    expect(within(row).getAllByText('Pick a stage for Mira.').length).toBe(1);
    expect(within(row).getByLabelText('Stage').getAttribute('aria-invalid')).toBe('true');
    expect(within(row).getByLabelText('Start time').getAttribute('aria-invalid')).toBeNull();
  });

  it('labels the save button by change count and disables it at zero', () => {
    const { rerender } = render(
      <FestivalEditForm
        {...baseProps}
        formData={{ name: 'Fest' }}
        setFormData={vi.fn()}
        changes={{ ...noChanges, total: 2 }}
      />,
    );
    expect((screen.getByText('Save 2 changes') as HTMLButtonElement).disabled).toBe(false);
    rerender(<FestivalEditForm {...baseProps} formData={{ name: 'Fest' }} setFormData={vi.fn()} />);
    expect((screen.getByText('Save 0 changes') as HTMLButtonElement).disabled).toBe(true);
  });

  it('puts a new artist row first', () => {
    const setFormData = renderForm();
    fireEvent.click(screen.getByText('+ Add Artist'));
    const sets = setFormData.mock.calls.at(-1)![0].days[0].sets;
    expect(sets).toHaveLength(4);
    expect(sets[0].artist).toBe('');
    expect(sets[1].id).toBe('s1');
  });
});
