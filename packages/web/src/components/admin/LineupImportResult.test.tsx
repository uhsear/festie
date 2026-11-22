import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LineupImportResult from './LineupImportResult';
import type { LineupImportCommitResult } from '@festie/shared/utils/lineupImport';

const result: LineupImportCommitResult = {
  importId: 'i1',
  created: 3,
  updated: 1,
  unchanged: 0,
  skipped: 1,
  newStages: 2,
  newDays: 1,
  spotifyMatched: 0,
  rows: [{ row: 4, status: 'skipped', artist: 'Kai', message: 'other day' }],
  warnings: ['Heads up'],
};

describe('LineupImportResult', () => {
  it('summarises the import and lists skipped rows', () => {
    render(<LineupImportResult result={result} festivalName="Fest" onReset={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent('Added 3 sets, updated 1, created 2 stages and 1 day.');
    expect(screen.getByRole('status')).toHaveTextContent('Skipped 1 row that name another day.');
    expect(screen.getByText('Row 4, Kai: other day')).toBeInTheDocument();
    expect(screen.getByText('Heads up')).toBeInTheDocument();
  });

  it('uses singular forms for one of each', () => {
    render(
      <LineupImportResult result={{ ...result, created: 1, newStages: 1, newDays: 1 }} festivalName="Fest" onReset={vi.fn()} />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Added 1 set, updated 1, created 1 stage and 1 day.');
  });

  it('runs reset and done', async () => {
    const onReset = vi.fn();
    const onDone = vi.fn();
    render(<LineupImportResult result={result} festivalName="Fest" onReset={onReset} onDone={onDone} />);
    await userEvent.click(screen.getByRole('button', { name: 'Import another file' }));
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
