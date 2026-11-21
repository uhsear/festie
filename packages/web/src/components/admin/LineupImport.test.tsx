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
  daysAnnouncement: vi.fn(),
  announceDays: vi.fn(),
  exportCsv: vi.fn(),
}));
vi.mock('@festie/shared/services/lineupImport', () => ({ lineupImportApi: api }));
// The release panel loads its own data; null renders nothing here.
const releaseApi = vi.hoisted(() => ({ panel: vi.fn(), send: vi.fn() }));
vi.mock('@festie/shared/services/timeReleases', () => ({ timeReleaseApi: releaseApi }));
const matchArtists = vi.hoisted(() => vi.fn());
vi.mock('@festie/shared/services', async (orig) => ({ ...(await orig<typeof import('@festie/shared/services')>()), matchArtists }));

const counts = (over: Record<string, number> = {}) => ({
  new: 0,
  changed: 0,
  unchanged: 0,
  error: 0,
  skipped: 0,
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
  releaseApi.panel.mockResolvedValue(null);
  matchArtists.mockResolvedValue([]);
  api.history.mockResolvedValue({ festivalName: 'Fest', imports: [] });
  api.announcement.mockResolvedValue({
    festivalName: 'Fest',
    recipients: 0,
    followers: 0,
    priorAttendees: 0,
    matchedFestivalNames: [],
    emailRecipients: 0,
    emailCut: 0,
    emailOff: null,
  });
  api.daysAnnouncement.mockResolvedValue({
    festivalName: 'Fest',
    actsWithDay: 0,
    actsTotal: 0,
    recipients: 0,
    audience: 0,
    emailRecipients: 0,
    emailCut: 0,
    emailOff: null,
    reason: 'no_days',
  });
});

async function pasteSampleAndCheck() {
  render(<LineupImport festivalId="f1" festivalName="Fest" />);
  fireEvent.change(screen.getByLabelText(/paste cells from google sheets/i), { target: { value: LINEUP_SAMPLE_CSV } });
  await userEvent.click(screen.getByRole('button', { name: 'Next: match columns' }));
  await userEvent.click(screen.getByRole('button', { name: 'Check rows' }));
}

describe('LineupImport', () => {
  it('loads the release panel once for the panel and the history together', async () => {
    render(<LineupImport festivalId="f1" festivalName="Big Fest" />);
    await screen.findByText('No imports yet.');
    expect(releaseApi.panel).toHaveBeenCalledTimes(1);
  });

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
    expect(api.exportCsv).toHaveBeenCalledWith('f1', 'admin');
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect((click.mock.instances[0] as unknown as HTMLAnchorElement).download).toBe('big-fest-lineup.csv');
    click.mockRestore();
  });

  it('auto-maps the sample and previews 3 rows', async () => {
    api.preview.mockResolvedValue(plan([planRow()], { new: 3 }));
    await pasteSampleAndCheck();
    expect(api.preview).toHaveBeenCalledTimes(1);
    const [id, body] = api.preview.mock.calls[0]!;
    expect(id).toBe('f1');
    expect(body.rows).toHaveLength(3);
    expect(body.rows[1]).toMatchObject({ row: 3, artist: 'Kai b2b Mira', stage: 'Forest', day: 'Friday', startTime: '23:30' });
    expect(await screen.findByRole('button', { name: 'Approve' })).toBeEnabled();
  });

  it('leaves Update off for a file with no set_id column and offers a banner button for changed rows', async () => {
    api.preview.mockResolvedValue(plan([planRow({ status: 'changed' })], { changed: 2 }));
    await pasteSampleAndCheck();
    expect(api.preview.mock.calls[0]![1].updateExisting).toBe(false);
    expect(await screen.findByText('2 rows change existing sets or announced acts. Turn on Update to apply them.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Turn on Update' }));
    expect(api.preview).toHaveBeenCalledTimes(2);
    expect(api.preview.mock.calls[1]![1].updateExisting).toBe(true);
    expect(screen.getByLabelText('Update sets that match')).toBeChecked();
    expect(screen.queryByText(/Turn on Update to apply/)).toBeNull();
  });

  it('turns Update on by default when a set_id column is mapped', async () => {
    api.preview.mockResolvedValue(plan([planRow({ status: 'changed' })], { changed: 2 }));
    render(<LineupImport festivalId="f1" festivalName="Fest" />);
    fireEvent.change(screen.getByLabelText(/paste cells from google sheets/i), {
      target: { value: 'set_id,day,stage,artist,start,end\nset-1,Friday,Main Stage,Aurora Lights,21:00,22:00' },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Next: match columns' }));
    await userEvent.click(screen.getByRole('button', { name: 'Check rows' }));
    await screen.findByRole('button', { name: 'Approve' });
    expect(api.preview.mock.calls[0]![1].updateExisting).toBe(true);
    expect(screen.getByLabelText('Update sets that match')).toBeChecked();
    expect(screen.queryByText(/Turn on Update to apply/)).toBeNull();
  });

  it('keeps Update off after Back and Check rows when the admin turned it off', async () => {
    api.preview.mockResolvedValue(plan([planRow({ status: 'changed' })], { changed: 2 }));
    render(<LineupImport festivalId="f1" festivalName="Fest" />);
    fireEvent.change(screen.getByLabelText(/paste cells from google sheets/i), {
      target: { value: 'set_id,day,stage,artist,start,end\nset-1,Friday,Main Stage,Aurora Lights,21:00,22:00' },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Next: match columns' }));
    await userEvent.click(screen.getByRole('button', { name: 'Check rows' }));
    await userEvent.click(await screen.findByLabelText('Update sets that match'));
    expect(screen.getByLabelText('Update sets that match')).not.toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    await userEvent.click(screen.getByRole('button', { name: 'Check rows' }));
    await screen.findByRole('button', { name: 'Approve' });
    expect(api.preview.mock.calls.at(-1)![1].updateExisting).toBe(false);
    expect(screen.getByLabelText('Update sets that match')).not.toBeChecked();
  });

  it('shows a Skipped chip when the plan skips rows', async () => {
    api.preview.mockResolvedValue(plan([planRow({ status: 'unchanged', skipped: 'Skipped: the file says Saturday, the stored day is Friday.' })], { unchanged: 1, skipped: 1 }));
    await pasteSampleAndCheck();
    expect(await screen.findByText('Skipped 1')).toBeInTheDocument();
  });

  it('disables Approve when the plan has an error row', async () => {
    api.preview.mockResolvedValue(
      plan([planRow({ status: 'error', errors: [{ field: 'day', message: 'Unknown day "Fryday".' }] })], { error: 1 }),
    );
    await pasteSampleAndCheck();
    expect(await screen.findByText('Unknown day "Fryday".')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
    expect(screen.getByText('Fix or remove the 1 row with errors to continue.')).toBeInTheDocument();
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
    const body = api.preview.mock.calls[1]![1];
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
        skipped: 2,
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
    expect(screen.getByText(/Skipped 2 rows that name another day/)).toBeInTheDocument();
    expect(screen.queryByText(/Spotify linked/)).toBeNull();
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
    await userEvent.click(buttons[buttons.length - 1]!);
    expect(api.undo).toHaveBeenCalledWith('f1', 'imp-9', 'admin');
  });

  it('names the announced acts that match no set, and the poster name a new set keeps', async () => {
    api.preview.mockResolvedValue({
      ...plan([planRow({ displayName: 'Port Zero presents: INFEKT' })], { new: 1 }),
      unmatchedActs: [{ entryId: 'lu-1', name: 'Subtronics (live)', dayLabel: 'Friday' }],
    });
    await pasteSampleAndCheck();
    expect(await screen.findByText('Poster name kept: Port Zero presents: INFEKT')).toBeInTheDocument();
    expect(screen.getByText(/1 announced act matches no set on the days this import fills/)).toBeInTheDocument();
    expect(screen.getByText('Subtronics (live) (Friday)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled();
  });

  it('shows no unmatched-acts block when the server sends none', async () => {
    api.preview.mockResolvedValue(plan([planRow()], { new: 1 }));
    await pasteSampleAndCheck();
    await screen.findByRole('button', { name: 'Approve' });
    expect(screen.queryByText(/match no set/)).toBeNull();
  });

  it('describes the spreadsheet round trip on the first step', () => {
    render(<LineupImport festivalId="f1" festivalName="Fest" />);
    expect(screen.getByText(/Export, fill in stages and times in a sheet, then import/)).toBeInTheDocument();
  });

  it('the preview says how many names match known artists and lists the ones that fit two', async () => {
    api.preview.mockResolvedValue(plan([planRow({ artists: ['Aurora Lights'] }), planRow({ row: 3, artists: ['Kai', 'Mira'] })], { new: 2 }));
    matchArtists.mockResolvedValue([
      { name: 'Aurora Lights', outcome: 'linked', candidates: [] },
      { name: 'Kai', outcome: 'new', candidates: [] },
      { name: 'Mira', outcome: 'pick', candidates: [] },
    ]);
    await pasteSampleAndCheck();
    expect(await screen.findByText('2 names match artists already in Festie.')).toBeInTheDocument();
    expect(matchArtists).toHaveBeenCalledWith([{ name: 'Aurora Lights' }, { name: 'Kai' }, { name: 'Mira' }]);
    expect(screen.getByText(/Mira: more than one artist has this name\./)).toBeInTheDocument();
  });
});

describe('LineupImport P6', () => {
  const renderSource = (value: string) => {
    render(<LineupImport festivalId="f1" festivalName="Fest" />);
    fireEvent.change(screen.getByLabelText(/paste cells from google sheets/i), { target: { value } });
  };

  it('previews a pasted list of names as announced rows, with no column step', async () => {
    api.preview.mockResolvedValue(
      plan([planRow({ artists: ['Alok'], dayLabel: undefined, target: 'announced' })], { new: 2, announced: 2 }),
    );
    renderSource('Alok\n\nKai b2b Mira\n');
    await userEvent.click(screen.getByRole('button', { name: 'Check as a list of names' }));
    expect(api.preview).toHaveBeenCalledTimes(1);
    const body = api.preview.mock.calls[0]![1];
    expect(body.rows).toEqual([{ row: 1, artist: 'Alok' }, { row: 3, artist: 'Kai b2b Mira' }]);
    expect(body.updateExisting).toBe(false);
    expect(await screen.findByText('Announced')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('button', { name: 'Check as a list of names' })).toBeInTheDocument();
  });

  it('refuses a list of more than 500 names before it calls the server', async () => {
    renderSource(Array.from({ length: 501 }, (_, i) => `Act ${i}`).join('\n'));
    await userEvent.click(screen.getByRole('button', { name: 'Check as a list of names' }));
    expect(api.preview).not.toHaveBeenCalled();
    expect(useToast().toast).toHaveBeenCalledWith(expect.stringMatching(/501 names/), 'error');
  });

  it('turns Update on by default when the file has a set id column', async () => {
    api.preview.mockResolvedValue(plan([planRow()], { changed: 1 }));
    renderSource('set_id,artist,day,start\ns1,Alok,Friday,21:00\n');
    await userEvent.click(screen.getByRole('button', { name: 'Next: match columns' }));
    await userEvent.click(screen.getByRole('button', { name: 'Check rows' }));
    expect(api.preview.mock.calls[0]![1].updateExisting).toBe(true);
    expect((await screen.findByRole('checkbox', { name: 'Update sets that match' }))).toBeChecked();
  });

  it('shows a banner when changed rows would not be applied, and its button turns Update on', async () => {
    api.preview.mockResolvedValue(plan([planRow({ status: 'changed' })], { changed: 2 }));
    await pasteSampleAndCheck();
    expect(await screen.findByText('2 rows change existing sets or announced acts. Turn on Update to apply them.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Turn on Update' }));
    expect(api.preview.mock.calls[1]![1].updateExisting).toBe(true);
    expect(screen.queryByText(/Turn on Update to apply them/)).toBeNull();
  });

  it('sends moveDays when Move sets is ticked', async () => {
    api.preview.mockResolvedValue(plan([planRow()], { new: 1 }));
    await pasteSampleAndCheck();
    expect(api.preview.mock.calls[0]![1].moveDays).toBeUndefined();
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Move sets to the day in the file' }));
    expect(api.preview.mock.calls[1]![1].moveDays).toBe(true);
  });

  it('groups the rows and blocks Approve until a Needs choice row has an artist', async () => {
    const choiceRow = planRow({
      row: 3,
      status: 'error',
      artists: ['Nina Kraviz'],
      errors: [{ field: 'artist', code: 'needs_choice', message: 'Which "Nina Kraviz"? 2 artists have this name. Pick one.' }],
      resolutions: [
        {
          name: 'Nina Kraviz',
          outcome: 'needs_choice',
          candidates: [{ id: 'ar-uk', label: 'UK', hint: '' }, { id: 'ar-ru', label: 'Russia', hint: '' }],
        },
      ],
    });
    api.preview.mockResolvedValueOnce(plan([planRow({ resolutions: [{ name: 'Aurora Lights', outcome: 'new' }] }), choiceRow], { new: 1, error: 1, needsChoice: 1 }));
    api.preview.mockResolvedValueOnce(plan([planRow()], { new: 2 }));
    await pasteSampleAndCheck();
    expect(await screen.findByText('New artists (1)')).toBeInTheDocument();
    expect(screen.getByText('Needs choice (1)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();

    await userEvent.selectOptions(screen.getByLabelText('Row 3 artist Nina Kraviz'), 'ar-ru');
    const body = api.preview.mock.calls[1]![1];
    expect(body.rows.find((r: { row: number }) => r.row === 3).artistId).toBe('ar-ru');
    expect(await screen.findByRole('button', { name: 'Approve' })).toBeEnabled();
  });

  it('offers "Use" and "Create new" for a Did you mean suggestion', async () => {
    api.preview.mockResolvedValueOnce(
      plan([planRow({ warnings: ['Did you mean Subtronics?'], resolutions: [{ name: 'Subtronic', outcome: 'did_you_mean', suggestion: 'Subtronics' }] })], { new: 1 }),
    );
    api.preview.mockResolvedValueOnce(plan([planRow()], { new: 1 }));
    await pasteSampleAndCheck();
    await userEvent.click(await screen.findByRole('button', { name: 'Create new' }));
    expect(screen.queryByRole('button', { name: 'Use Subtronics' })).toBeNull();
  });

  it('lists skipped rows at the top of the result', async () => {
    const p = plan([planRow()], { new: 1 });
    api.preview.mockResolvedValue(p);
    api.commit.mockResolvedValue({
      committed: true,
      plan: p,
      result: {
        importId: 'i1', created: 1, updated: 0, unchanged: 0, skipped: 1, newStages: 0, newDays: 0, announced: 2, announcedUpdated: 0, spotifyMatched: 0,
        rows: [{ row: 5, status: 'skipped', setId: 's1', artist: 'DJ Alpha', message: 'Skipped: the file says Saturday, the stored day is Friday.' }],
        warnings: [],
      },
    });
    await pasteSampleAndCheck();
    await userEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    await userEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(await screen.findByText('Row 5, DJ Alpha: Skipped: the file says Saturday, the stored day is Friday.')).toBeInTheDocument();
    expect(screen.getByText(/Announced lineup: 2 added, 0 updated/)).toBeInTheDocument();
  });
});
