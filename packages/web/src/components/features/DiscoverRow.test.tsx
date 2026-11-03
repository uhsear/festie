import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const auth = { user: { id: 'u1' } as { id: string } | null };
const fest: Record<string, unknown> = {};
const setDetailSet = vi.fn();

vi.mock('@festie/shared/stores', () => ({
  useAuthStore: (sel: (s: typeof auth) => unknown) => sel(auth),
  useFestivalStore: (sel: (s: Record<string, unknown>) => unknown) => sel(fest),
}));
vi.mock('@festie/shared/stores/uiStore', () => ({
  useUIStore: (sel: (s: { setDetailSet: typeof setDetailSet }) => unknown) => sel({ setDetailSet }),
}));
vi.mock('../../hooks/useSetStatus', () => ({ useNow: () => Date.parse('2026-05-29T12:00:00Z') }));

import DiscoverRow from './DiscoverRow';

const set = (id: string, artist: string, genres: string[]) => ({
  id,
  stageId: 'st1',
  dayIndex: 0,
  startTime: null,
  artists: [{ name: artist, genres }],
});

describe('DiscoverRow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.user = { id: 'u1' };
    Object.assign(fest, {
      currentFestival: { id: 'f1', name: 'Alpha' },
      currentProfile: { id: 'p1', picks: { a: 'must', b: 'must', c: 'want-to-see' } },
      sets: [
        set('a', 'A', ['house']),
        set('b', 'B', ['house']),
        set('c', 'C', ['house']),
        set('d', 'Dee', ['house']),
        set('e', 'Eve', ['jazz']),
      ],
      days: [{ id: 'd1', label: 'Fri', date: '2099-05-29', index: 0 }],
      stages: [{ id: 'st1', name: 'Main' }],
      searchQuery: '',
      activeStages: [],
      activeGenres: [],
    });
  });

  it('lists unpicked sets in the most picked genres and opens one', async () => {
    render(<DiscoverRow />);
    expect(screen.getByRole('heading', { name: 'More like your picks' })).toBeInTheDocument();
    expect(screen.getByText('From the genres you pick most: house')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Dee/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Eve/ })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /Dee/ }));
    expect(setDetailSet).toHaveBeenCalledWith(expect.objectContaining({ id: 'd' }));
  });

  it.each([
    ['a guest', () => (auth.user = null)],
    ['no profile', () => (fest.currentProfile = null)],
    ['a search', () => (fest.searchQuery = 'dee')],
    ['a stage filter', () => { fest.stages = [{ id: 'st1', name: 'Main' }, { id: 'st2', name: 'Other' }]; fest.activeStages = ['st1']; }],
    ['a genre filter', () => (fest.activeGenres = ['house'])],
    ['fewer than 3 picks', () => (fest.currentProfile = { id: 'p1', picks: { a: 'must' } })],
    ['the festival is over', () => (fest.days = [{ id: 'd1', label: 'Fri', date: '2020-05-29', index: 0 }])],
  ])('hides for %s', (_name, change) => {
    change();
    const { container } = render(<DiscoverRow />);
    expect(container).toBeEmptyDOMElement();
  });
});
