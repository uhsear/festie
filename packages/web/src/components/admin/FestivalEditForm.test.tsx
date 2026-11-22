import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { Artist } from '@festie/shared/types';
import FestivalEditForm from './FestivalEditForm';

// The release panel loads its own data; null renders nothing here.
vi.mock('@festie/shared/services/timeReleases', () => ({ timeReleaseApi: { panel: vi.fn().mockResolvedValue(null), send: vi.fn() } }));
const toast = vi.fn();
vi.mock('../../lib/toastContext', () => ({ useToast: () => ({ toast, toastError: vi.fn() }) }));

const noChanges = { total: 0, changedSetIds: new Set<string>(), newSetIds: new Set<string>() };

const baseProps = {
  editingId: 'f1',
  notifyPickers: true,
  onNotifyPickersChange: vi.fn(),
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
    const artists: Artist[] = [
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
    expect(within(row).getByLabelText(/^Stage for /).getAttribute('aria-invalid')).toBe('true');
    expect(within(row).getByLabelText(/^Start time for /).getAttribute('aria-invalid')).toBeNull();
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
    expect((screen.getByText('Save') as HTMLButtonElement).disabled).toBe(true);
  });

  it('reports the notify checkbox', () => {
    const onNotifyPickersChange = vi.fn();
    renderForm({ onNotifyPickersChange });
    fireEvent.click(screen.getByLabelText('Tell people whose picks changed'));
    expect(onNotifyPickersChange).toHaveBeenCalledWith(false);
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

describe('FestivalEditForm engagement', () => {
  it('says when pick counts failed to load', () => {
    render(<FestivalEditForm {...baseProps} formData={lineup()} setFormData={vi.fn()} engagementError />);
    expect(screen.getByText("Couldn't load pick counts.")).toBeTruthy();
  });
});

describe('FestivalEditForm series picker', () => {
  const festivals = [
    { id: 'fk-2026', name: 'Forbidden Kingdom 2026', seriesId: 'forbidden-kingdom' },
    { id: 'f1', name: 'Forbidden Kingdom 2027', seriesId: 'forbidden-kingdom' },
    { id: 'nc-2026', name: 'North Coast 2026', seriesId: null },
  ];
  const renderSeries = (formData: Record<string, unknown>) => {
    const setFormData = vi.fn();
    render(
      <FestivalEditForm {...baseProps} formData={formData} setFormData={setFormData} festivals={festivals} />,
    );
    return setFormData;
  };

  it('picks an existing series id from the list', () => {
    const setFormData = renderSeries({ name: 'Forbidden Kingdom 2027' });
    fireEvent.change(screen.getByLabelText('Series'), { target: { value: 'forbidden-kingdom' } });
    expect(setFormData.mock.calls.at(-1)![0].seriesId).toBe('forbidden-kingdom');
  });

  it('cleans a typed new series id to the server pattern', () => {
    const setFormData = renderSeries({ name: 'Wasteland Weekend 2027' });
    fireEvent.change(screen.getByLabelText('Series'), { target: { value: '__new__' } });
    fireEvent.change(screen.getByLabelText('New series id'), { target: { value: 'Café_Fest.2027' } });
    expect(setFormData.mock.calls.at(-1)![0].seriesId).toBe('cafe-fest-2027');
  });

  it('lists the other editions and clears the series', () => {
    const setFormData = renderSeries({ name: 'Forbidden Kingdom 2027', seriesId: 'forbidden-kingdom' });
    expect(screen.getByText('Also in this series: Forbidden Kingdom 2026')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Series'), { target: { value: '' } });
    expect(setFormData.mock.calls.at(-1)![0].seriesId).toBeNull();
  });

  it('New series pre-fills the id suggested from the name', () => {
    const setFormData = renderSeries({ name: 'Wasteland Weekend 2027' });
    fireEvent.change(screen.getByLabelText('Series'), { target: { value: '__new__' } });
    expect(setFormData.mock.calls.at(-1)![0].seriesId).toBe('wasteland-weekend');
    expect(screen.getByLabelText('New series id')).toBeTruthy();
  });

  it('warns when the name suggests a known series but no other festival uses the id', () => {
    renderSeries({ name: 'Forbidden Kingdom 2028', seriesId: 'forbidden-kingdm' });
    expect(screen.getByText('No other festival uses this id. Check the spelling.')).toBeTruthy();
  });

  it('does not warn for a first edition of a new series', () => {
    renderSeries({ name: 'Wasteland Weekend 2027', seriesId: 'wasteland-weekend' });
    expect(screen.queryByText('No other festival uses this id. Check the spelling.')).toBeNull();
  });
});

describe('FestivalEditForm announced names', () => {
  it('shows the block only when the festival carries a lineup, and a paste calls setFormData with it', () => {
    const { expanded: _expanded, ...base } = lineup();
    void _expanded;
    const setFormData = vi.fn();
    const { unmount } = render(<FestivalEditForm {...baseProps} formData={base} setFormData={setFormData} />);
    expect(screen.queryByText('Announced names')).toBeNull();
    unmount();

    render(<FestivalEditForm {...baseProps} formData={{ ...base, lineup: [] }} setFormData={setFormData} />);
    expect(screen.getByText('Announced names')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Paste names' }));
    fireEvent.change(within(screen.getByRole('dialog')).getByLabelText('Names'), { target: { value: 'Kai\nMira' } });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Add' }));
    const next = setFormData.mock.calls.at(-1)![0];
    expect(next.lineup.map((e: { artists: { name: string }[] }) => e.artists[0]!.name)).toEqual(['Kai', 'Mira']);
    expect(next.name).toBe('Fest');
  });
});
