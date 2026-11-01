import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LineupImport from './LineupImport';

vi.mock('../../lib/toastContext', () => ({
  useToast: () => ({ toast: vi.fn(), toastError: vi.fn() }),
}));

const { previewLineupImport, commitLineupImport } = vi.hoisted(() => ({
  previewLineupImport: vi.fn(),
  commitLineupImport: vi.fn(),
}));
vi.mock('@festie/shared/services/admin', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  previewLineupImport,
  commitLineupImport,
}));

const row = (over: Record<string, unknown>) => ({
  line: 2,
  artist: 'A',
  stageName: 'Main',
  dayLabel: 'Fri',
  startTime: '20:00',
  endTime: '21:00',
  status: 'new',
  ...over,
});

const result = (rows: ReturnType<typeof row>[], counts: Record<string, number>) => ({
  dryRun: true,
  counts: { new: 0, update: 0, unchanged: 0, error: 0, ...counts },
  rows,
  missing: [],
  errors: [],
  warnings: [],
  imported: 0,
  updated: 0,
  spotifyMatched: 0,
});

beforeEach(() => vi.clearAllMocks());

async function preview() {
  render(<LineupImport festivalId="f1" />);
  await userEvent.type(screen.getByPlaceholderText(/paste csv/i), 'x');
  await userEvent.click(screen.getByRole('button', { name: 'Preview' }));
}

describe('LineupImport', () => {
  it('disables Import when the preview has an error row', async () => {
    previewLineupImport.mockResolvedValue(
      result([row({}), row({ line: 3, status: 'error', message: 'Unknown stage' })], { new: 1, error: 1 }),
    );
    await preview();
    expect(await screen.findByText(/Unknown stage/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Import 1 new/ })).toBeDisabled();
    expect(screen.getByText('Fix the rows marked in red, then preview again.')).toBeInTheDocument();
  });

  it('enables Import when every row is clean', async () => {
    previewLineupImport.mockResolvedValue(result([row({})], { new: 1 }));
    await preview();
    expect(await screen.findByRole('button', { name: 'Import 1 new' })).toBeEnabled();
  });

  it('previews again with updateExisting when the checkbox changes', async () => {
    previewLineupImport.mockResolvedValueOnce(result([row({ status: 'skipped' })], {}));
    previewLineupImport.mockResolvedValueOnce(result([row({ status: 'update' })], { update: 1 }));
    await preview();
    await userEvent.click(await screen.findByRole('checkbox', { name: /update sets that match/i }));
    expect(previewLineupImport).toHaveBeenLastCalledWith('f1', 'x', { updateExisting: true });
    expect(await screen.findByRole('button', { name: 'Import 0 new, update 1' })).toBeEnabled();
  });
});
