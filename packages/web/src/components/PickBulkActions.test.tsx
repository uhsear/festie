import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const festivalState: Record<string, unknown> = {};
vi.mock('@festie/shared/stores', () => ({
  useFestivalStore: vi.fn((sel: (s: Record<string, unknown>) => unknown) => sel(festivalState)),
}));

const add = vi.fn();
vi.mock('@festie/shared/hooks', () => ({
  useFestival: () => ({ getStageName: (id: string) => (id === 'st1' ? 'Main Stage' : 'Sahara') }),
  useBulkAddPicks: () => ({ busyKey: null, add }),
}));

vi.mock('../lib/useUndoNotifier', () => ({ useUndoNotifier: () => ({}) }));

import PickBulkActions from './PickBulkActions';

const makeSet = (id: string, stageId: string, dayIndex: number, genres: string[]) => ({
  id,
  festivalId: 'f1',
  stageId,
  dayIndex,
  artist: id,
  artists: [{ id: `a-${id}`, name: id, genres }],
  createdAt: '',
  updatedAt: '',
});

describe('PickBulkActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(festivalState).forEach((k) => delete festivalState[k]);
    Object.assign(festivalState, {
      sets: [makeSet('s1', 'st1', 0, ['House']), makeSet('s2', 'st1', 1, ['house']), makeSet('s3', 'st2', 1, [])],
      stages: [
        { id: 'st1', name: 'Main Stage' },
        { id: 'st2', name: 'Sahara' },
      ],
      days: [{ date: '2026-06-10' }, { date: '2026-06-11' }],
      selectedDay: 1,
    });
  });

  it('says "all days" in the header', () => {
    render(<PickBulkActions />);
    expect(screen.getByText('Bulk add picks · all days')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bulk add picks for all days, expand' })).toBeInTheDocument();
  });

  it('groups sets from every day, whatever day is selected', () => {
    render(<PickBulkActions />);
    fireEvent.click(screen.getByRole('button', { name: /Bulk add picks for all days/ }));
    expect(screen.getByRole('button', { name: 'Add all 2 sets on Main Stage, all days' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add all 2 House sets, all days' })).toBeInTheDocument();
  });

  it('calls add with the group and the selected priority, with no "(selected)" text', () => {
    render(<PickBulkActions />);
    fireEvent.click(screen.getByRole('button', { name: /Bulk add picks for all days/ }));
    fireEvent.click(screen.getByRole('radio', { name: 'Want to See' }));
    expect(document.body.textContent).not.toMatch(/\(selected\)/);
    fireEvent.click(screen.getByRole('button', { name: 'Add all 2 sets on Main Stage, all days' }));
    expect(add).toHaveBeenCalledWith(
      { key: 'stage-st1', label: 'Main Stage', setIds: ['s1', 's2'] },
      'want-to-see',
    );
  });
});
