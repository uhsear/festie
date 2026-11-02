import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LINEUP_SAMPLE_CSV } from '@festie/shared/utils/lineupImport';
import LineupImport from './LineupImport';

vi.mock('../../lib/toastContext', () => {
  const value = { toast: vi.fn(), toastError: vi.fn() };
  return { useToast: () => value };
});
const { useToast } = await import('../../lib/toastContext');

const api = vi.hoisted(() => ({
  preview: vi.fn(),
  commit: vi.fn(),
  history: vi.fn(),
  undo: vi.fn(),
  announcement: vi.fn(),
  announce: vi.fn(),
  exportCsv: vi.fn(),
}));
vi.mock('@festie/shared/services/lineupImport', () => ({ lineupImportApi: api }));

const counts = (over: Record<string, number> = {}) => ({
  new: 0,
  changed: 0,
  unchanged: 0,
  error: 0,
  newStages: 0,
  newDays: 0,
  missingFromFile: 0,
  ...over,
});

const planRow = (over: Record<string, unknown> = {}) => ({
  row: 2,
  status: 'new',
  artists: ['Aurora Lights'],
  dayLabel: 'Friday',
  stageName: 'Main Stage',
  startTime: '21:00',
  endTime: '22:30',
  changes: [],
  errors: [],
  warnings: [],
  ...over,
});

const plan = (rows: unknown[], c: Record<string, number>, problems: string[] = []) => ({
  festivalName: 'Fest',
  counts: counts(c),
  rows,
  newStages: [],
  newDays: [],
  missingFromFile: [],
  problems,
  stages: ['Main Stage'],
  days: ['Friday'],
});

beforeEach(() => {
  vi.clearAllMocks();
  api.history.mockResolvedValue({ festivalName: 'Fest', imports: [] });
  api.announcement.mockResolvedValue({ festivalName: 'Fest', recipients: 0 });
});

async function pasteSampleAndCheck() {
  render(<LineupImport festivalId="f1" festivalName="Fest" />);
  fireEvent.change(screen.getByLabelText(/paste cells from google sheets/i), { target: { value: LINEUP_SAMPLE_CSV } });
  await userEvent.click(screen.getByRole('button', { name: 'Next: match columns' }));
  await userEvent.click(screen.getByRole('button', { name: 'Check rows' }));
}

describe('LineupImport', () => {
  it('keeps the preview and asks for a re-check when the commit comes back uncommitted', async () => {
    const p = plan([planRow()], { new: 3 });
    api.preview.mockResolvedValue(p);
    api.commit.mockResolvedValue({ committed: false, plan: plan([planRow({ status: 'changed' })], { changed: 1 }) });
    await pasteSampleAndCheck();
    await userEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    await userEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(useToast().toast).toHaveBeenCalledWith('The lineup changed since your preview. Check the rows again.', 'error');
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(screen.queryByText(/Import done/)).toBeNull();
  });

  it('exports the lineup CSV', async () => {
    api.exportCsv.mockResolvedValue('set_id,day,stage,artist,start,end');
    const createObjectURL = vi.fn(() => 'blob:x');
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<LineupImport festivalId="f1" festivalName="Big Fest" />);
    await userEvent.click(screen.getByRole('button', { name: 'Export lineup CSV' }));
    expect(api.exportCsv).toHaveBeenCalledWith('f1');
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect((click.mock.instances[0] as unknown as HTMLAnchorElement).download).toBe('big-fest-lineup.csv');
    click.mockRestore();
  });

  it('auto-maps the sample and previews 3 rows', async () => {
    api.preview.mockResolvedValue(plan([planRow()], { new: 3 }));
    await pasteSampleAndCheck();
    expect(api.preview).toHaveBeenCalledTimes(1);
    const [id, body] = api.preview.mock.calls[0];
    expect(id).toBe('f1');
    expect(body.rows).toHaveLength(3);
    expect(body.rows[1]).toMatchObject({ row: 3, artist: 'Kai b2b Mira', stage: 'Forest', day: 'Friday', startTime: '23:30' });
    expect(await screen.findByRole('button', { name: 'Approve' })).toBeEnabled();
  });

  it('disables Approve when the plan has an error row', async () => {
    api.preview.mockResolvedValue(
      plan([planRow({ status: 'error', errors: [{ field: 'day', message: 'Unknown day "Fryday".' }] })], { error: 1 }),
    );
    await pasteSampleAndCheck();
    expect(await screen.findByText('Unknown day "Fryday".')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
    expect(screen.getByText('Fix or remove the 1 rows with errors to continue.')).toBeInTheDocument();
  });

  it('sends the edited value when Check again is chosen', async () => {
    api.preview.mockResolvedValueOnce(
      plan([planRow({ row: 2, status: 'error', errors: [{ field: 'day', message: 'Unknown day' }] })], { error: 1 }),
    );
    api.preview.mockResolvedValueOnce(plan([planRow()], { new: 1 }));
    await pasteSampleAndCheck();
    const input = await screen.findByLabelText('Row 2 day');
    await userEvent.clear(input);
    await userEvent.type(input, 'Saturday');
    await userEvent.click(screen.getByRole('button', { name: 'Check again' }));
    const body = api.preview.mock.calls[1][1];
    expect(body.rows.find((r: { row: number }) => r.row === 2).day).toBe('Saturday');
    expect(await screen.findByRole('button', { name: 'Approve' })).toBeEnabled();
  });

  it('shows counts and warnings after a committed import', async () => {
    const p = plan([planRow()], { new: 3 });
    api.preview.mockResolvedValue(p);
    api.commit.mockResolvedValue({
      committed: true,
      plan: p,
      result: {
        importId: 'i1',
        created: 3,
        updated: 0,
        unchanged: 0,
        skipped: 0,
        newStages: 1,
        newDays: 1,
        spotifyMatched: 2,
        rows: [],
        warnings: ['Row 7: link dropped'],
      },
    });
    await pasteSampleAndCheck();
    await userEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    expect(await screen.findByText(/Approve import\?/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(await screen.findByText(/Import done. Added 3 sets/)).toBeInTheDocument();
    expect(screen.getByText(/Spotify linked 2 artists/)).toBeInTheDocument();
    expect(screen.getByText('Row 7: link dropped')).toBeInTheDocument();
  });

  it('undoes the newest import from history', async () => {
    api.history.mockResolvedValue({
      festivalName: 'Fest',
      imports: [
        {
          id: 'imp-9',
          createdAt: '2026-11-01T10:00:00Z',
          createdBy: 'asir',
          counts: { created: 3, updated: 0, newStages: 0, newDays: 0 },
          undoneAt: null,
          canUndo: true,
        },
      ],
    });
    api.undo.mockResolvedValue({ removed: 3, restored: 0, removedStages: 0, removedDays: 0, kept: [] });
    render(<LineupImport festivalId="f1" festivalName="Fest" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Undo import' }));
    const buttons = await screen.findAllByRole('button', { name: 'Undo import' });
    await userEvent.click(buttons[buttons.length - 1]);
    expect(api.undo).toHaveBeenCalledWith('f1', 'imp-9');
  });
});
