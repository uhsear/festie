import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ArchivedFestivalRow from './ArchivedFestivalRow';
import type { ArchivedFestival } from '@festie/shared/services/festivalAdmin';

describe('ArchivedFestivalRow', () => {
  it('shows the festival and restores it', async () => {
    const onRestore = vi.fn();
    const item = { id: 'f1', name: 'Old Fest', location: 'Tampa', deletedAt: new Date().toISOString() } as ArchivedFestival;
    render(<ArchivedFestivalRow item={item} onRestore={onRestore} />);
    expect(screen.getByRole('heading', { name: 'Old Fest' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Restore' }));
    expect(onRestore).toHaveBeenCalledTimes(1);
  });
});
